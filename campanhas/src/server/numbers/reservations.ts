import "server-only";
import { logEvent } from "../logger";
import { env } from "../env";
import type { CampaignStatus, ReservationStatus } from "@/generated/prisma/client";
import { formatNumber } from "@/lib/format";
import { multiplyCents } from "@/lib/money";
import { transaction, db, type Tx } from "../db";
import { triggerCodeOf } from "../db-errors";
import { AppError } from "../errors";
import { randomToken, sha256Hex } from "../crypto";
import { findCampaignBySlug, lastNumber, invalidateStatusCache } from "../campaigns/queries";

export type ReservationView = {
  reservationId: string;
  campaignId: string;
  campaignSlug: string;
  status: ReservationStatus;
  numbers: number[];
  numberDigits: number;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  expiresAt: Date;
  /** Reserva utilizável para checkout (ativa, dentro do prazo e completa). */
  usable: boolean;
};

/** Normaliza a seleção: inteiros, sem duplicados, em ordem crescente. */
export function normalizeSelection(numbers: unknown): number[] {
  if (!Array.isArray(numbers)) throw new AppError("VALIDATION", "Selecione ao menos um número.");
  const set = new Set<number>();
  for (const n of numbers) {
    if (typeof n !== "number" || !Number.isSafeInteger(n)) {
      throw new AppError("VALIDATION", "Seleção de números inválida.");
    }
    set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function mapTriggerError(e: unknown): never {
  const code = triggerCodeOf(e);
  if (code === "NUMBER_CAMPAIGN_NOT_ACTIVE" || code === "NUMBER_CAMPAIGN_FROZEN") {
    throw new AppError("CAMPAIGN_NOT_ACTIVE", "As vendas desta campanha não estão abertas.", { cause: e });
  }
  throw e;
}

/**
 * Libera, dentro da transação, reservas de carrinho já vencidas que envolvem
 * os números pedidos. Seguro porque reserva de carrinho não tem cobrança.
 * A condição `reserved_until < now()` é reavaliada linha a linha pelo
 * PostgreSQL caso outra transação tenha acabado de renovar o número.
 */
async function releaseExpiredCartHolds(tx: Tx, campaignId: string, numbers: number[]): Promise<void> {
  await tx.$executeRaw`
    WITH expired AS (
      SELECT DISTINCT reservation_id FROM campaign_numbers
      WHERE campaign_id = ${campaignId}::uuid AND number = ANY(${numbers}::int[])
        AND status = 'RESERVED' AND reserved_until < now()
    ), released AS (
      UPDATE campaign_numbers
      SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL, version = version + 1
      WHERE reservation_id IN (SELECT reservation_id FROM expired)
        AND status = 'RESERVED' AND reserved_until < now()
      RETURNING reservation_id
    )
    UPDATE reservations SET status = 'EXPIRED'
    WHERE id IN (SELECT reservation_id FROM expired) AND status = 'ACTIVE' AND expires_at < now()`;
}

async function releaseReservationTx(tx: Tx, tokenHash: string, to: "RELEASED" | "EXPIRED"): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string; status: ReservationStatus }[]>`
    SELECT id, status FROM reservations WHERE token_hash = ${tokenHash} FOR NO KEY UPDATE`;
  const r = rows[0];
  if (!r || r.status !== "ACTIVE") return false;
  await tx.$executeRaw`
    UPDATE campaign_numbers
    SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL, version = version + 1
    WHERE reservation_id = ${r.id}::uuid AND status = 'RESERVED'`;
  await tx.$executeRaw`
    UPDATE reservations SET status = ${to}::reservation_status WHERE id = ${r.id}::uuid`;
  return true;
}

/**
 * Reserva números de forma atômica (tudo ou nada).
 *
 * Garantia de concorrência: o UPDATE condicional (`status = 'AVAILABLE'`)
 * trava cada linha; transações concorrentes sobre o mesmo número esperam e,
 * após o commit da primeira, reavaliam a condição e não alteram nada. Se
 * algum número não puder ser reservado, a transação inteira é desfeita.
 */
export async function reserveNumbers(input: {
  campaignSlug: string;
  numbers: unknown;
  replaceToken?: string | null;
  ipHash?: string | null;
}): Promise<ReservationView & { token: string }> {
  const numbers = normalizeSelection(input.numbers);
  const campaign = await findCampaignBySlug(input.campaignSlug);
  if (!campaign) throw new AppError("NOT_FOUND", "Campanha não encontrada.");

  if (numbers.length < campaign.minNumbersPerOrder) {
    throw new AppError("LIMIT_EXCEEDED", `Selecione ao menos ${campaign.minNumbersPerOrder} número(s).`);
  }
  if (numbers.length > campaign.maxNumbersPerOrder) {
    throw new AppError("LIMIT_EXCEEDED", `O limite é de ${campaign.maxNumbersPerOrder} números por pedido.`, {
      details: { max: campaign.maxNumbersPerOrder },
    });
  }
  const last = lastNumber(campaign);
  if (numbers.some((n) => n < campaign.firstNumber || n > last)) {
    throw new AppError("VALIDATION", "Há números fora da faixa desta campanha.");
  }

  const token = randomToken();
  const tokenHash = sha256Hex(token);

  try {
    const view = await transaction(async (tx) => {
      const [c] = await tx.$queryRaw<
        { status: CampaignStatus; sales_open: boolean; reservation_minutes: number; price_cents: number }[]
      >`
        SELECT status, reservation_minutes, price_cents,
          (status = 'ACTIVE'
            AND (sales_start_at IS NULL OR sales_start_at <= now())
            AND (sales_end_at IS NULL OR sales_end_at > now())) AS sales_open
        FROM campaigns WHERE id = ${campaign.id}::uuid FOR SHARE`;
      if (!c || !c.sales_open) {
        throw new AppError("CAMPAIGN_NOT_ACTIVE", "As vendas desta campanha não estão abertas.");
      }

      if (input.replaceToken) {
        await releaseReservationTx(tx, sha256Hex(input.replaceToken), "RELEASED");
      }
      await releaseExpiredCartHolds(tx, campaign.id, numbers);

      // Anti-retenção: um mesmo IP não segura boa parte da campanha (reservas
      // ativas + pedidos aguardando pagamento). O teto é generoso porque
      // operadoras móveis compartilham um IP entre muitos clientes (CGNAT).
      if (input.ipHash) {
        const cap = env().MAX_HELD_NUMBERS_PER_IP;
        // Serializa reservas do mesmo IP nesta campanha: requisições paralelas
        // não conseguem passar do teto juntas.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hold:${campaign.id}:${input.ipHash}`}, 0))`;
        const [held] = await tx.$queryRaw<{ n: number }[]>`
          SELECT (
            (SELECT coalesce(sum(quantity), 0) FROM reservations
              WHERE campaign_id = ${campaign.id}::uuid AND ip_hash = ${input.ipHash} AND status = 'ACTIVE' AND expires_at > now())
          + (SELECT coalesce(sum(quantity), 0) FROM orders
              WHERE campaign_id = ${campaign.id}::uuid AND ip_hash = ${input.ipHash} AND status = 'PENDING_PAYMENT')
          )::int AS n`;
        if ((held?.n ?? 0) + numbers.length > cap) {
          await logEvent("WARN", "SECURITY", "Limite de números retidos por IP atingido", {
            campaign: campaign.slug,
            held: held?.n ?? 0,
            requested: numbers.length,
            cap,
          });
          throw new AppError(
            "LIMIT_EXCEEDED",
            "Há muitos números reservados a partir da sua conexão. Conclua ou cancele uma reserva antes de escolher mais.",
          );
        }
      }

      const [res] = await tx.$queryRaw<{ id: string; expires_at: Date }[]>`
        INSERT INTO reservations (campaign_id, token_hash, status, quantity, expires_at, ip_hash)
        VALUES (${campaign.id}::uuid, ${tokenHash}, 'ACTIVE', ${numbers.length},
                now() + make_interval(mins => ${c.reservation_minutes}::int), ${input.ipHash ?? null})
        RETURNING id, expires_at`;
      if (!res) throw new Error("falha ao criar reserva");

      const reserved = await tx.$queryRaw<{ number: number }[]>`
        UPDATE campaign_numbers
        SET status = 'RESERVED', reservation_id = ${res.id}::uuid, reserved_until = ${res.expires_at},
            version = version + 1
        WHERE campaign_id = ${campaign.id}::uuid AND number = ANY(${numbers}::int[]) AND status = 'AVAILABLE'
        RETURNING number`;

      if (reserved.length !== numbers.length) {
        const got = new Set(reserved.map((r) => r.number));
        const unavailable = numbers.filter((n) => !got.has(n));
        const label = unavailable
          .slice(0, 10)
          .map((n) => formatNumber(n, campaign.numberDigits))
          .join(", ");
        throw new AppError(
          "NUMBERS_UNAVAILABLE",
          unavailable.length === 1
            ? `O número ${label} acabou de ficar indisponível. Escolha outro.`
            : `Os números ${label}${unavailable.length > 10 ? "…" : ""} acabaram de ficar indisponíveis. Escolha outros.`,
          { details: { unavailable } },
        );
      }

      const unit = c.price_cents;
      return {
        reservationId: res.id,
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        status: "ACTIVE" as const,
        numbers,
        numberDigits: campaign.numberDigits,
        quantity: numbers.length,
        unitPriceCents: unit,
        totalCents: multiplyCents(unit, numbers.length),
        expiresAt: res.expires_at,
        usable: true,
      };
    });
    invalidateStatusCache(campaign.id);
    return { ...view, token };
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapTriggerError(e);
  }
}

export async function getReservationByToken(token: string): Promise<ReservationView | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = sha256Hex(token);
  const rows = await db().$queryRaw<
    {
      id: string;
      campaign_id: string;
      slug: string;
      status: ReservationStatus;
      quantity: number;
      expires_at: Date;
      price_cents: number;
      number_digits: number;
      numbers: number[] | null;
      expired: boolean;
    }[]
  >`
    SELECT r.id, r.campaign_id, c.slug, r.status, r.quantity, r.expires_at, c.price_cents, c.number_digits,
           (SELECT array_agg(cn.number ORDER BY cn.number) FROM campaign_numbers cn
             WHERE cn.reservation_id = r.id AND cn.status = 'RESERVED') AS numbers,
           (r.expires_at < now()) AS expired
    FROM reservations r JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.token_hash = ${tokenHash}`;
  const r = rows[0];
  if (!r) return null;
  const numbers = r.numbers ?? [];
  return {
    reservationId: r.id,
    campaignId: r.campaign_id,
    campaignSlug: r.slug,
    status: r.status,
    numbers,
    numberDigits: r.number_digits,
    quantity: r.quantity,
    unitPriceCents: r.price_cents,
    totalCents: multiplyCents(r.price_cents, r.quantity),
    expiresAt: r.expires_at,
    usable: r.status === "ACTIVE" && !r.expired && numbers.length === r.quantity,
  };
}

/** Cliente desistiu/voltou para trocar números. */
export async function releaseReservation(token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const released = await transaction((tx) => releaseReservationTx(tx, sha256Hex(token), "RELEASED"));
  return released;
}

/**
 * Rotina: expira reservas de carrinho vencidas e devolve seus números.
 * Não envolve gateway (carrinho não tem cobrança). Processa em lotes.
 */
export async function expireCartReservations(batchSize = 500): Promise<number> {
  const rows = await transaction(async (tx) => {
    return tx.$queryRaw<{ campaign_id: string }[]>`
      WITH expired AS (
        SELECT id FROM reservations
        WHERE status = 'ACTIVE' AND expires_at < now()
        ORDER BY expires_at
        LIMIT ${batchSize}
        FOR NO KEY UPDATE SKIP LOCKED
      ), marked AS (
        UPDATE reservations r SET status = 'EXPIRED'
        FROM expired e WHERE r.id = e.id
        RETURNING r.id, r.campaign_id
      ), released AS (
        UPDATE campaign_numbers cn
        SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL, version = cn.version + 1
        WHERE cn.reservation_id IN (SELECT id FROM marked) AND cn.status = 'RESERVED'
        RETURNING cn.campaign_id
      )
      SELECT campaign_id FROM marked`;
  });
  for (const id of new Set(rows.map((r) => r.campaign_id))) invalidateStatusCache(id);
  return rows.length;
}
