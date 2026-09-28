import "server-only";
import type { NumberStatus } from "@/generated/prisma/client";
import { allowExceptionalOperation, db, transaction } from "../db";
import { triggerCodeOf } from "../db-errors";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { invalidateStatusCache } from "../campaigns/queries";

export type AdminNumberRow = {
  number: number;
  status: NumberStatus;
  order_code: string | null;
  order_id: string | null;
  customer_name: string | null;
  reserved_until: Date | null;
  reservation_id: string | null;
  blocked_reason: string | null;
};

export async function listNumbers(campaignId: string, opts: { status?: NumberStatus; from?: number; to?: number }) {
  const from = opts.from ?? 0;
  const to = opts.to ?? 10_000_000;
  const rows = await db().$queryRaw<AdminNumberRow[]>`
    SELECT cn.number, cn.status, o.code AS order_code, o.id AS order_id, o.customer_name,
           cn.reserved_until, cn.reservation_id, cn.blocked_reason
    FROM campaign_numbers cn LEFT JOIN orders o ON o.id = cn.order_id
    WHERE cn.campaign_id = ${campaignId}::uuid AND cn.number BETWEEN ${from} AND ${to}
      AND (${opts.status ?? null}::number_status IS NULL OR cn.status = ${opts.status ?? null}::number_status)
    ORDER BY cn.number LIMIT 1500`;
  return rows;
}

function mapNumberError(e: unknown): never {
  const code = triggerCodeOf(e);
  if (code === "NUMBER_CAMPAIGN_FROZEN") throw new AppError("INVALID_STATE", "A campanha está congelada para o sorteio.");
  if (code === "NUMBER_INVALID_TRANSITION" || code === "NUMBER_EXCEPTIONAL_REQUIRED") {
    throw new AppError("INVALID_STATE", "Esta alteração não é permitida para o estado atual do número.");
  }
  throw e;
}

/** Bloqueio excepcional (ex.: número reservado para uso da organização). */
export async function blockNumber(campaignId: string, number: number, reason: string, actor: Actor & { type: "USER" }) {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo do bloqueio.");
  try {
    await transaction(async (tx) => {
      await allowExceptionalOperation(tx, `bloqueio:${reason.slice(0, 80)}`);
      const n = await tx.$executeRaw`
        UPDATE campaign_numbers SET status = 'CANCELLED', blocked_reason = ${reason.trim().slice(0, 200)}, version = version + 1
        WHERE campaign_id = ${campaignId}::uuid AND number = ${number} AND status = 'AVAILABLE'`;
      if (n !== 1) throw new AppError("INVALID_STATE", "Somente números disponíveis podem ser bloqueados.");
      await writeAudit(tx, {
        actor,
        action: "NUMBER_BLOCKED",
        entityType: "campaign_number",
        entityId: String(number),
        campaignId,
        before: { status: "AVAILABLE" },
        after: { status: "CANCELLED" },
        reason,
      });
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapNumberError(e);
  }
  invalidateStatusCache(campaignId);
}

/**
 * Desbloqueio/reabertura excepcional: CANCELLED → AVAILABLE. Permitido para
 * números bloqueados ou de pedidos reembolsados — nunca para um número pago.
 */
export async function unblockNumber(campaignId: string, number: number, reason: string, actor: Actor & { type: "USER" }) {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo da liberação.");
  try {
    await transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: NumberStatus; order_status: string | null }[]>`
        SELECT cn.status, o.status::text AS order_status FROM campaign_numbers cn LEFT JOIN orders o ON o.id = cn.order_id
        WHERE cn.campaign_id = ${campaignId}::uuid AND cn.number = ${number} FOR NO KEY UPDATE OF cn`;
      if (!row || row.status !== "CANCELLED") throw new AppError("INVALID_STATE", "O número não está bloqueado.");
      if (row.order_status && row.order_status !== "REFUNDED") {
        throw new AppError("INVALID_STATE", "Número vinculado a pedido não reembolsado.");
      }
      await allowExceptionalOperation(tx, `desbloqueio:${reason.slice(0, 80)}`);
      await tx.$executeRaw`
        UPDATE campaign_numbers SET status = 'AVAILABLE', order_id = NULL, paid_at = NULL, reserved_until = NULL,
          blocked_reason = NULL, version = version + 1
        WHERE campaign_id = ${campaignId}::uuid AND number = ${number} AND status = 'CANCELLED'`;
      await writeAudit(tx, {
        actor,
        action: "NUMBER_UNBLOCKED",
        entityType: "campaign_number",
        entityId: String(number),
        campaignId,
        before: { status: "CANCELLED", orderStatus: row.order_status },
        after: { status: "AVAILABLE" },
        reason,
      });
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapNumberError(e);
  }
  invalidateStatusCache(campaignId);
}

/** Libera uma reserva de carrinho (RESERVED) — ex.: comprador desistiu por WhatsApp. */
export async function releaseCartReservationByNumber(campaignId: string, number: number, reason: string, actor: Actor & { type: "USER" }) {
  if (reason.trim().length < 3) throw new AppError("VALIDATION", "Informe o motivo.");
  await transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ reservation_id: string | null; status: NumberStatus }[]>`
      SELECT reservation_id, status FROM campaign_numbers WHERE campaign_id = ${campaignId}::uuid AND number = ${number}`;
    if (!row || row.status !== "RESERVED" || !row.reservation_id) {
      throw new AppError("INVALID_STATE", "O número não está em reserva de carrinho. Pedidos aguardando pagamento são cancelados pela tela do pedido.");
    }
    const [res] = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM reservations WHERE id = ${row.reservation_id}::uuid FOR NO KEY UPDATE`;
    if (!res || res.status !== "ACTIVE") throw new AppError("INVALID_STATE", "A reserva já não está ativa.");
    const released = await tx.$executeRaw`
      UPDATE campaign_numbers SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL, version = version + 1
      WHERE reservation_id = ${res.id}::uuid AND status = 'RESERVED'`;
    await tx.$executeRaw`UPDATE reservations SET status = 'RELEASED' WHERE id = ${res.id}::uuid`;
    await writeAudit(tx, {
      actor,
      action: "RESERVATION_RELEASED_BY_ADMIN",
      entityType: "reservation",
      entityId: res.id,
      campaignId,
      after: { releasedNumbers: released, triggeredByNumber: number },
      reason,
    });
  });
  invalidateStatusCache(campaignId);
}
