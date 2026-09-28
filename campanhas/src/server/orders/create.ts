import "server-only";
import { randomUUID } from "node:crypto";
import type { CampaignStatus, OrderStatus, PaymentMode, ReservationStatus } from "@/generated/prisma/client";
import { multiplyCents } from "@/lib/money";
import { buildStaticPixPayload } from "@/lib/pix/brcode";
import { transaction, type Tx } from "../db";
import { triggerCodeOf } from "../db-errors";
import { AppError } from "../errors";
import { encryptSecret, hashIdentifier, sha256Hex } from "../crypto";
import { logEvent } from "../logger";
import { invalidateStatusCache } from "../campaigns/queries";
import { getPaymentConfig } from "../payments/settings";
import type { CustomerInput } from "../validation/customer";
import { orderAccessToken, orderAccessTokenHash } from "./access";

export type CreateOrderInput = {
  reservationToken: string;
  customer: CustomerInput;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  /** Gerada pelo navegador por tentativa de checkout (UUID). */
  idempotencyKey: string;
  ipHash?: string | null;
};

export type CreateOrderResult = {
  orderId: string;
  code: string;
  accessToken: string;
  status: OrderStatus;
  paymentMode: PaymentMode;
  totalCents: number;
  /** false quando a chamada foi uma repetição idempotente. */
  created: boolean;
};

type ReservationRow = {
  id: string;
  campaign_id: string;
  status: ReservationStatus;
  quantity: number;
  order_id: string | null;
};

type CampaignRow = {
  id: string;
  status: CampaignStatus;
  sales_open: boolean;
  price_cents: number;
  payment_minutes: number;
  order_code_prefix: string;
  max_numbers_per_customer: number | null;
  require_cpf: boolean;
  require_email: boolean;
};

export function emailRequired(campaignRequiresEmail: boolean, mode: PaymentMode): boolean {
  return campaignRequiresEmail || mode === "AUTOMATIC";
}

export function termsVersionOf(regulation: string | null | undefined): string {
  return `reg-${sha256Hex(regulation ?? "").slice(0, 16)}`;
}

async function existingResult(tx: Tx, orderId: string): Promise<CreateOrderResult & { campaignId: string }> {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  return {
    campaignId: o.campaignId,
    orderId: o.id,
    code: o.code,
    accessToken: orderAccessToken(o.id),
    status: o.status,
    paymentMode: o.paymentMode,
    totalCents: o.totalCents,
    created: false,
  };
}

/**
 * Converte uma reserva ativa em pedido PENDING_PAYMENT.
 *
 * - Preço unitário vem do banco (campanha travada FOR SHARE); nada vindo do
 *   navegador é usado para valores.
 * - Idempotente: repetir a chamada (mesma reserva) devolve o mesmo pedido.
 * - A cobrança Pix do modo automático é criada DEPOIS do commit (nunca
 *   chamamos APIs externas segurando locks); ver payments/charges.ts.
 */
export async function createOrderFromReservation(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.acceptTerms || !input.acceptPrivacy) {
    throw new AppError("VALIDATION", "É preciso aceitar o regulamento e a política de privacidade.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) {
    throw new AppError("VALIDATION", "Requisição inválida. Recarregue a página e tente novamente.");
  }
  const reservationHash = sha256Hex(input.reservationToken);

  try {
    const result = await transaction(async (tx) => {
      // 1. Reserva travada: serializa cliques duplos e a rotina de expiração.
      const [reservation] = await tx.$queryRaw<ReservationRow[]>`
        SELECT id, campaign_id, status, quantity, order_id FROM reservations
        WHERE token_hash = ${reservationHash} FOR NO KEY UPDATE`;
      if (!reservation) {
        throw new AppError("RESERVATION_EXPIRED", "Sua reserva não foi encontrada. Escolha os números novamente.");
      }
      if (reservation.status === "CONVERTED" && reservation.order_id) {
        // Mesmo navegador (possui o token da reserva) repetindo o envio.
        return existingResult(tx, reservation.order_id);
      }
      const sameKey = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (sameKey) {
        throw new AppError("CONFLICT", "Este pedido já foi enviado. Consulte seus pedidos.");
      }
      if (reservation.status !== "ACTIVE") {
        throw new AppError("RESERVATION_EXPIRED", "Sua reserva expirou. Escolha os números novamente.");
      }

      // 2. Campanha travada em modo compartilhado (fechar vendas espera).
      const [campaign] = await tx.$queryRaw<CampaignRow[]>`
        SELECT id, status, price_cents, payment_minutes, order_code_prefix, max_numbers_per_customer,
               require_cpf, require_email,
               (status = 'ACTIVE'
                 AND (sales_start_at IS NULL OR sales_start_at <= now())
                 AND (sales_end_at IS NULL OR sales_end_at > now())) AS sales_open
        FROM campaigns WHERE id = ${reservation.campaign_id}::uuid FOR SHARE`;
      if (!campaign || !campaign.sales_open) {
        throw new AppError("CAMPAIGN_NOT_ACTIVE", "As vendas desta campanha não estão abertas.");
      }
      if (campaign.require_cpf && !input.customer.cpf) {
        throw new AppError("VALIDATION", "Informe seu CPF.", { details: { fields: { "customer.cpf": "Informe seu CPF." } } });
      }

      // 3. Números ainda presos a esta reserva.
      const numbers = await tx.$queryRaw<{ id: string; number: number }[]>`
        SELECT id, number FROM campaign_numbers
        WHERE reservation_id = ${reservation.id}::uuid AND status = 'RESERVED'
        ORDER BY number FOR NO KEY UPDATE`;
      if (numbers.length !== reservation.quantity) {
        throw new AppError("RESERVATION_EXPIRED", "Sua reserva expirou. Escolha os números novamente.");
      }

      // 4. Configuração de pagamento (modo congelado no pedido).
      const payment = await getPaymentConfig(campaign.id, tx);
      if (payment.mode === "AUTOMATIC" && !payment.gateway) {
        throw new AppError("GATEWAY_NOT_CONFIGURED", "Pagamentos indisponíveis no momento. Tente mais tarde.");
      }
      // O Mercado Pago exige e-mail do pagador (payer.email) para criar Pix.
      if (emailRequired(campaign.require_email, payment.mode) && !input.customer.email) {
        throw new AppError("VALIDATION", "Informe seu e-mail.", {
          details: { fields: { "customer.email": "Informe seu e-mail." } },
        });
      }

      // 5. Limite por comprador (serializado por telefone).
      const phone = input.customer.phone;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${phone}`}))`;
      if (campaign.max_numbers_per_customer) {
        const [row] = await tx.$queryRaw<{ n: bigint }[]>`
          SELECT coalesce(sum(quantity), 0)::bigint AS n FROM orders
          WHERE campaign_id = ${campaign.id}::uuid AND customer_phone = ${phone}
            AND status IN ('PENDING_PAYMENT', 'PAID')`;
        const already = Number(row?.n ?? 0);
        if (already + numbers.length > campaign.max_numbers_per_customer) {
          throw new AppError(
            "LIMIT_EXCEEDED",
            `O limite por participante é de ${campaign.max_numbers_per_customer} números nesta campanha.`,
          );
        }
      }

      // 6. Cliente (não sobrescreve dados de um cadastro existente).
      const cpf = input.customer.cpf;
      const [customer] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO customers (name, phone, email, cpf_encrypted, cpf_hash)
        VALUES (${input.customer.name}, ${phone}, ${input.customer.email ?? null},
                ${cpf ? encryptSecret(cpf) : null}, ${cpf ? hashIdentifier("cpf", cpf) : null})
        ON CONFLICT (phone) WHERE anonymized_at IS NULL
        DO UPDATE SET email = COALESCE(customers.email, EXCLUDED.email),
                      cpf_encrypted = COALESCE(customers.cpf_encrypted, EXCLUDED.cpf_encrypted),
                      cpf_hash = COALESCE(customers.cpf_hash, EXCLUDED.cpf_hash)
        RETURNING id`;
      if (!customer) throw new Error("falha ao registrar cliente");

      // 7. Código do pedido e valores oficiais.
      const [seq] = await tx.$queryRaw<{ seq: bigint; day: string }[]>`
        SELECT nextval('order_code_seq') AS seq,
               to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD') AS day`;
      if (!seq) throw new Error("falha ao gerar código");
      const code = `${campaign.order_code_prefix}-${seq.day}-${String(seq.seq).padStart(6, "0")}`;
      const unitPriceCents = campaign.price_cents;
      const totalCents = multiplyCents(unitPriceCents, numbers.length);

      const legal = await tx.legalInformation.findUnique({ where: { campaignId: campaign.id }, select: { regulation: true } });
      const orderId = randomUUID();
      const gateway = payment.mode === "AUTOMATIC" ? "MERCADO_PAGO" : "STATIC_PIX";

      const [order] = await tx.$queryRaw<{ id: string; expires_at: Date }[]>`
        INSERT INTO orders (
          id, code, campaign_id, customer_id, status, payment_mode, gateway, quantity,
          unit_price_cents, total_cents, currency, customer_name, customer_phone, customer_email,
          access_token_hash, idempotency_key, reservation_id, expires_at,
          terms_accepted_at, privacy_accepted_at, terms_version, source, ip_hash)
        VALUES (
          ${orderId}::uuid, ${code}, ${campaign.id}::uuid, ${customer.id}::uuid, 'PENDING_PAYMENT',
          ${payment.mode}::payment_mode, ${gateway}::payment_gateway, ${numbers.length},
          ${unitPriceCents}, ${totalCents}, 'BRL', ${input.customer.name}, ${phone}, ${input.customer.email ?? null},
          ${orderAccessTokenHash(orderId)}, ${input.idempotencyKey}, ${reservation.id}::uuid,
          now() + make_interval(mins => ${campaign.payment_minutes}::int),
          now(), now(), ${termsVersionOf(legal?.regulation)}, 'WEB', ${input.ipHash ?? null})
        RETURNING id, expires_at`;
      if (!order) throw new Error("falha ao criar pedido");

      await tx.$executeRaw`
        INSERT INTO order_items (order_id, campaign_number_id, campaign_id, number, unit_price_cents)
        SELECT ${order.id}::uuid, cn.id, cn.campaign_id, cn.number, ${unitPriceCents}
        FROM campaign_numbers cn
        WHERE cn.reservation_id = ${reservation.id}::uuid AND cn.status = 'RESERVED'`;

      const moved = await tx.$executeRaw`
        UPDATE campaign_numbers
        SET status = 'PENDING_PAYMENT', order_id = ${order.id}::uuid, reservation_id = NULL,
            reserved_until = ${order.expires_at}, version = version + 1
        WHERE reservation_id = ${reservation.id}::uuid AND status = 'RESERVED'`;
      if (moved !== numbers.length) {
        throw new Error(`inconsistência ao mover números: ${moved} de ${numbers.length}`);
      }

      await tx.$executeRaw`
        UPDATE reservations SET status = 'CONVERTED', order_id = ${order.id}::uuid WHERE id = ${reservation.id}::uuid`;

      // 8. Registro de pagamento. Manual: BR Code estático já definido aqui.
      if (payment.mode === "MANUAL") {
        if (!payment.pixReceiverConfigured) {
          throw new AppError("GATEWAY_NOT_CONFIGURED", "Pagamentos indisponíveis no momento. Tente mais tarde.", {
            internal: { reason: "nome/cidade do recebedor Pix não configurados" },
          });
        }
        const copyPaste = buildStaticPixPayload({
          ...payment.pix,
          amountCents: totalCents,
          txid: code.replace(/-/g, ""),
        });
        await tx.payment.create({
          data: {
            orderId: order.id,
            gateway: "STATIC_PIX",
            mode: "MANUAL",
            status: "PENDING",
            idempotencyKey: `order:${order.id}:1`,
            amountCents: totalCents,
            pixCopyPaste: copyPaste,
            expiresAt: order.expires_at,
          },
        });
      } else {
        await tx.payment.create({
          data: {
            orderId: order.id,
            gateway: "MERCADO_PAGO",
            mode: "AUTOMATIC",
            status: "CREATING",
            idempotencyKey: `order:${order.id}:1`,
            amountCents: totalCents,
            expiresAt: order.expires_at,
          },
        });
      }

      await tx.paymentEvent.create({
        data: {
          orderId: order.id,
          source: "SYSTEM",
          type: "ORDER_CREATED",
          processingStatus: "PROCESSED",
          payload: { code, quantity: numbers.length, totalCents, mode: payment.mode },
          processedAt: new Date(),
        },
      });

      return {
        orderId: order.id,
        code,
        accessToken: orderAccessToken(order.id),
        status: "PENDING_PAYMENT" as const,
        paymentMode: payment.mode,
        totalCents,
        created: true,
        campaignId: campaign.id,
      };
    });

    if (result.created) {
      invalidateStatusCache(result.campaignId);
      void logEvent("INFO", "ORDER", "Pedido criado", {
        code: result.code,
        totalCents: result.totalCents,
        mode: result.paymentMode,
      });
    }
    const { orderId, code, accessToken, status, paymentMode, totalCents, created } = result;
    return { orderId, code, accessToken, status, paymentMode, totalCents, created };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const t = triggerCodeOf(e);
    if (t === "NUMBER_CAMPAIGN_NOT_ACTIVE" || t === "NUMBER_CAMPAIGN_FROZEN") {
      throw new AppError("CAMPAIGN_NOT_ACTIVE", "As vendas desta campanha não estão abertas.", { cause: e });
    }
    throw e;
  }
}
