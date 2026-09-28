import "server-only";
import type { OrderStatus, PaymentEventSource, PaymentStatus } from "@/generated/prisma/client";
import { allowExceptionalOperation, db, transaction, type Tx } from "../db";
import { logEvent } from "../logger";
import { writeAudit } from "../audit";
import { invalidateStatusCache } from "../campaigns/queries";
import { lockOrder, releasePendingOrderTx, type LockedOrder } from "../orders/lifecycle";
import type { GatewayPayment } from "./gateway/types";

export type ApplyOutcome =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "PENDING"
  | "AMOUNT_MISMATCH"
  | "DUPLICATE_PAYMENT"
  | "LATE_PAYMENT_REVIVED"
  | "LATE_PAYMENT_CONFLICT"
  | "CANCELLED"
  | "REFUNDED"
  | "REFUND_NEEDS_ATTENTION"
  | "UNKNOWN_ORDER"
  | "REFERENCE_MISMATCH"
  | "NO_CHANGE";

type PaymentRow = {
  id: string;
  order_id: string;
  status: PaymentStatus;
  gateway_payment_id: string | null;
  amount_cents: number;
};

const OPEN: PaymentStatus[] = ["CREATING", "PENDING"];

async function event(
  tx: Tx,
  data: { orderId: string; paymentId?: string | null; source: PaymentEventSource; type: string; payload?: object; externalId?: string },
) {
  await tx.paymentEvent.create({
    data: {
      orderId: data.orderId,
      paymentId: data.paymentId ?? null,
      gateway: "MERCADO_PAGO",
      source: data.source,
      type: data.type,
      externalId: data.externalId ?? null,
      processingStatus: "PROCESSED",
      payload: data.payload ?? undefined,
      processedAt: new Date(),
    },
  });
}

/**
 * Localiza (ou vincula/cria) o registro local do pagamento do gateway, já com
 * o pedido travado. Nunca cria um segundo registro para o mesmo id do gateway
 * (UNIQUE(gateway, gateway_payment_id)).
 */
async function findOrAttachPayment(tx: Tx, order: LockedOrder, gp: GatewayPayment): Promise<PaymentRow | null> {
  const byGatewayId = await tx.$queryRaw<PaymentRow[]>`
    SELECT id, order_id, status, gateway_payment_id, amount_cents FROM payments
    WHERE gateway = 'MERCADO_PAGO' AND gateway_payment_id = ${gp.id} FOR NO KEY UPDATE`;
  if (byGatewayId[0]) return byGatewayId[0];

  // Cobrança criada no gateway mas cujo id não chegou a ser salvo (queda entre a
  // chamada e o commit): vincula ao registro local em CREATING.
  const creating = await tx.$queryRaw<PaymentRow[]>`
    SELECT id, order_id, status, gateway_payment_id, amount_cents FROM payments
    WHERE order_id = ${order.id}::uuid AND gateway = 'MERCADO_PAGO' AND status = 'CREATING'
      AND gateway_payment_id IS NULL
    ORDER BY created_at LIMIT 1 FOR NO KEY UPDATE`;
  if (creating[0]) {
    await tx.$executeRaw`
      UPDATE payments SET gateway_payment_id = ${gp.id}, status = 'PENDING'
      WHERE id = ${creating[0].id}::uuid`;
    return { ...creating[0], gateway_payment_id: gp.id, status: "PENDING" };
  }

  // Pagamento desconhecido referenciando este pedido. Pendentes são apenas
  // registrados em evento (não abrem uma segunda cobrança local).
  if (gp.status === "PENDING") return null;
  // Entra com status fechado (não conflita com a cobrança aberta do pedido);
  // a lógica de aplicação abaixo avança o estado (ex.: CANCELLED → APPROVED).
  const insertStatus: PaymentStatus =
    gp.status === "REFUNDED" ? "REFUNDED" : gp.status === "CHARGED_BACK" ? "CHARGED_BACK" : "CANCELLED";
  const rows = await tx.$queryRaw<PaymentRow[]>`
    INSERT INTO payments (order_id, gateway, mode, status, gateway_payment_id, idempotency_key, amount_cents, currency)
    VALUES (${order.id}::uuid, 'MERCADO_PAGO', 'AUTOMATIC', ${insertStatus}::payment_status, ${gp.id},
            ${`gw:MERCADO_PAGO:${gp.id}`}, ${gp.amountCents > 0 ? gp.amountCents : order.total_cents}, 'BRL')
    RETURNING id, order_id, status, gateway_payment_id, amount_cents`;
  return rows[0] ?? null;
}

function amountsMatch(order: LockedOrder, payment: PaymentRow, gp: GatewayPayment): boolean {
  const paid = gp.paidAmountCents ?? gp.amountCents;
  const currencyOk = gp.currency === null || gp.currency === "BRL";
  return currencyOk && gp.amountCents === order.total_cents && paid === order.total_cents && payment.amount_cents === order.total_cents;
}

async function markApproved(tx: Tx, paymentId: string, gp: GatewayPayment, source: PaymentEventSource, attention?: string) {
  const paid = gp.paidAmountCents ?? gp.amountCents;
  await tx.$executeRaw`
    UPDATE payments SET status = 'APPROVED', paid_amount_cents = ${paid},
      approved_at = ${gp.approvedAt ?? new Date()}, confirmation_source = ${source}::payment_event_source,
      requires_attention = ${attention ? true : false}, attention_reason = ${attention ?? null}
    WHERE id = ${paymentId}::uuid AND status <> 'APPROVED'`;
}

/** PENDING_PAYMENT → PAID dos números e do pedido (mesma transação). */
async function confirmOrderTx(tx: Tx, order: LockedOrder, paymentId: string, gp: GatewayPayment): Promise<void> {
  const paidNow = await tx.$executeRaw`
    UPDATE campaign_numbers SET status = 'PAID', paid_at = now(), version = version + 1
    WHERE order_id = ${order.id}::uuid AND status = 'PENDING_PAYMENT'`;
  if (paidNow !== order.quantity) {
    throw new Error(`inconsistência: pedido ${order.code} confirmaria ${paidNow} de ${order.quantity} números`);
  }
  await tx.$executeRaw`
    UPDATE orders SET status = 'PAID', paid_at = ${gp.approvedAt ?? new Date()}, paid_payment_id = ${paymentId}::uuid,
      version = version + 1
    WHERE id = ${order.id}::uuid`;
}

/**
 * Pagamento aprovado para pedido que já havia expirado/sido cancelado:
 * recupera os MESMOS números se todos ainda estiverem livres. Nunca toma
 * números de outro comprador.
 */
async function tryReviveTx(tx: Tx, order: LockedOrder): Promise<boolean> {
  const [c] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM campaigns WHERE id = ${order.campaign_id}::uuid FOR SHARE`;
  if (!c || !["ACTIVE", "PAUSED", "CLOSED"].includes(c.status)) return false;

  const grabbed = await tx.$executeRaw`
    UPDATE campaign_numbers SET status = 'PENDING_PAYMENT', order_id = ${order.id}::uuid,
      reserved_until = now() + interval '10 minutes', version = version + 1
    WHERE id IN (SELECT campaign_number_id FROM order_items WHERE order_id = ${order.id}::uuid)
      AND status = 'AVAILABLE'`;
  if (grabbed !== order.quantity) {
    // Desfaz o que conseguiu pegar: os demais já pertencem a outra pessoa.
    await tx.$executeRaw`
      UPDATE campaign_numbers SET status = 'AVAILABLE', order_id = NULL, reserved_until = NULL, version = version + 1
      WHERE order_id = ${order.id}::uuid AND status = 'PENDING_PAYMENT'`;
    return false;
  }
  await tx.$executeRaw`
    UPDATE order_items SET active = true, released_at = NULL WHERE order_id = ${order.id}::uuid`;
  return true;
}

/**
 * Aplica o estado de um pagamento vindo do gateway. Idempotente: pode ser
 * chamada quantas vezes for necessário (webhook repetido, conciliação,
 * consulta da página) sem efeito duplicado.
 */
export async function applyGatewayPayment(gp: GatewayPayment, source: PaymentEventSource): Promise<ApplyOutcome> {
  const reference = gp.externalReference;
  const orderRef = reference
    ? await db().order.findUnique({ where: { code: reference }, select: { id: true, campaignId: true } })
    : null;

  // Pagamento já conhecido tem precedência sobre a referência externa.
  const known = await db().payment.findUnique({
    where: { gateway_gatewayPaymentId: { gateway: "MERCADO_PAGO", gatewayPaymentId: gp.id } },
    select: { orderId: true },
  });
  if (known && orderRef && known.orderId !== orderRef.id) {
    await logEvent("CRITICAL", "PAYMENT", "Pagamento do gateway com referência divergente do registro local", {
      gatewayPaymentId: gp.id,
      reference,
    });
    return "REFERENCE_MISMATCH";
  }
  const orderId = known?.orderId ?? orderRef?.id;
  if (!orderId) {
    await logEvent("WARN", "PAYMENT", "Pagamento do gateway sem pedido correspondente (ignorado)", {
      gatewayPaymentId: gp.id,
      reference,
      status: gp.rawStatus,
    });
    return "UNKNOWN_ORDER";
  }

  const result = await transaction(async (tx): Promise<{ outcome: ApplyOutcome; campaignId: string; code: string }> => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new Error("pedido desapareceu durante a aplicação do pagamento");
    const base = { campaignId: order.campaign_id, code: order.code };
    const payment = await findOrAttachPayment(tx, order, gp);

    if (!payment) {
      await event(tx, { orderId: order.id, source, type: "UNTRACKED_GATEWAY_PAYMENT", externalId: gp.id, payload: { status: gp.rawStatus } });
      return { outcome: "PENDING", ...base };
    }

    await tx.$executeRaw`
      UPDATE payments SET gateway_status = ${gp.rawStatus}, gateway_status_detail = ${gp.statusDetail},
        last_checked_at = now(), check_count = check_count + 1,
        pix_copy_paste = COALESCE(pix_copy_paste, ${gp.qrCode}), ticket_url = COALESCE(ticket_url, ${gp.ticketUrl}),
        expires_at = COALESCE(expires_at, ${gp.expiresAt})
      WHERE id = ${payment.id}::uuid`;

    const ev = (type: string, payload: object = {}) =>
      event(tx, { orderId: order.id, paymentId: payment.id, source, type, externalId: gp.id, payload: { status: gp.rawStatus, ...payload } });

    switch (gp.status) {
      case "PENDING": {
        if (payment.status === "CREATING") {
          await tx.$executeRaw`UPDATE payments SET status = 'PENDING' WHERE id = ${payment.id}::uuid`;
        }
        return { outcome: "PENDING", ...base };
      }

      case "APPROVED": {
        if (payment.status === "AMOUNT_MISMATCH") return { outcome: "AMOUNT_MISMATCH", ...base };
        if (payment.status === "APPROVED") {
          return { outcome: order.paid_payment_id === payment.id ? "ALREADY_CONFIRMED" : "DUPLICATE_PAYMENT", ...base };
        }
        if (!amountsMatch(order, payment, gp)) {
          await tx.$executeRaw`
            UPDATE payments SET status = 'AMOUNT_MISMATCH', paid_amount_cents = ${gp.paidAmountCents ?? gp.amountCents},
              requires_attention = true, attention_reason = 'PAYMENT_AMOUNT_MISMATCH'
            WHERE id = ${payment.id}::uuid`;
          await ev("PAYMENT_AMOUNT_MISMATCH", {
            expectedCents: order.total_cents,
            chargedCents: gp.amountCents,
            paidCents: gp.paidAmountCents,
            currency: gp.currency,
          });
          return { outcome: "AMOUNT_MISMATCH", ...base };
        }
        if (order.status === "PENDING_PAYMENT") {
          await markApproved(tx, payment.id, gp, source);
          await confirmOrderTx(tx, order, payment.id, gp);
          await ev("PAYMENT_APPROVED", { totalCents: order.total_cents });
          return { outcome: "CONFIRMED", ...base };
        }
        if (order.status === "PAID") {
          await markApproved(tx, payment.id, gp, source, "DUPLICATE_PAYMENT");
          await ev("DUPLICATE_PAYMENT", { confirmingPaymentId: order.paid_payment_id });
          return { outcome: "DUPLICATE_PAYMENT", ...base };
        }
        if ((["EXPIRED", "CANCELLED", "ERROR"] as OrderStatus[]).includes(order.status)) {
          const revived = await tryReviveTx(tx, order);
          if (revived) {
            await markApproved(tx, payment.id, gp, source);
            await confirmOrderTx(tx, order, payment.id, gp);
            await ev("LATE_PAYMENT_REVIVED", { previousStatus: order.status });
            return { outcome: "LATE_PAYMENT_REVIVED", ...base };
          }
          await markApproved(tx, payment.id, gp, source, "LATE_PAYMENT_CONFLICT");
          await ev("LATE_PAYMENT_CONFLICT", { previousStatus: order.status });
          return { outcome: "LATE_PAYMENT_CONFLICT", ...base };
        }
        // Pedido reembolsado recebendo nova aprovação.
        await markApproved(tx, payment.id, gp, source, "PAYMENT_FOR_REFUNDED_ORDER");
        await ev("PAYMENT_FOR_REFUNDED_ORDER");
        return { outcome: "DUPLICATE_PAYMENT", ...base };
      }

      case "REJECTED":
      case "CANCELLED": {
        if (OPEN.includes(payment.status)) {
          const to = gp.status === "REJECTED" ? "REJECTED" : "CANCELLED";
          await tx.$executeRaw`UPDATE payments SET status = ${to}::payment_status WHERE id = ${payment.id}::uuid`;
          await ev(`PAYMENT_${to}`);
        }
        // Cobrança cancelada não pode mais ser paga: devolve os números já.
        if (order.status === "PENDING_PAYMENT") {
          const stillOpen = await tx.payment.count({ where: { orderId: order.id, status: { in: OPEN } } });
          if (stillOpen === 0) {
            await releasePendingOrderTx(tx, order.id, "EXPIRED", { source, reason: `cobrança ${gp.rawStatus} no gateway` });
          }
        }
        return { outcome: "CANCELLED", ...base };
      }

      case "REFUNDED":
      case "CHARGED_BACK": {
        const final = gp.status;
        if (payment.status === final) return { outcome: "NO_CHANGE", ...base };
        const isConfirming = order.status === "PAID" && order.paid_payment_id === payment.id;
        if (!isConfirming) {
          await tx.$executeRaw`UPDATE payments SET status = ${final}::payment_status WHERE id = ${payment.id}::uuid`;
          await ev(`PAYMENT_${final}`);
          return { outcome: "REFUNDED", ...base };
        }
        const [camp] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM campaigns WHERE id = ${order.campaign_id}::uuid`;
        if (camp && (camp.status === "FROZEN" || camp.status === "DRAWN")) {
          // Lista do sorteio já congelada: não alteramos números; exige tratamento conforme regulamento.
          await tx.$executeRaw`
            UPDATE payments SET requires_attention = true, attention_reason = ${`${final}_AFTER_FREEZE`}
            WHERE id = ${payment.id}::uuid`;
          await ev(`${final}_AFTER_FREEZE`);
          return { outcome: "REFUND_NEEDS_ATTENTION", ...base };
        }
        await allowExceptionalOperation(tx, `gateway ${final.toLowerCase()}`);
        await tx.$executeRaw`
          UPDATE campaign_numbers SET status = 'CANCELLED', blocked_reason = ${`pagamento ${final.toLowerCase()} no gateway`},
            version = version + 1
          WHERE order_id = ${order.id}::uuid AND status = 'PAID'`;
        await tx.$executeRaw`UPDATE order_items SET active = false, released_at = now() WHERE order_id = ${order.id}::uuid AND active`;
        await tx.$executeRaw`UPDATE orders SET status = 'REFUNDED', refunded_at = now(), version = version + 1 WHERE id = ${order.id}::uuid`;
        await tx.$executeRaw`
          UPDATE payments SET status = ${final}::payment_status, requires_attention = true, attention_reason = ${final}
          WHERE id = ${payment.id}::uuid`;
        await ev(`PAYMENT_${final}`);
        await writeAudit(tx, {
          actor: { type: "GATEWAY", label: "mercado_pago" },
          action: final === "REFUNDED" ? "ORDER_REFUNDED_BY_GATEWAY" : "ORDER_CHARGED_BACK",
          entityType: "order",
          entityId: order.id,
          campaignId: order.campaign_id,
          before: { status: "PAID" },
          after: { status: "REFUNDED", numbers: "CANCELLED" },
          reason: `Gateway informou ${gp.rawStatus} para o pagamento ${gp.id}`,
        });
        return { outcome: "REFUNDED", ...base };
      }
    }
  });

  invalidateStatusCache(result.campaignId);
  const level =
    result.outcome === "AMOUNT_MISMATCH" || result.outcome === "LATE_PAYMENT_CONFLICT" || result.outcome === "REFUND_NEEDS_ATTENTION"
      ? "ERROR"
      : result.outcome === "DUPLICATE_PAYMENT" || result.outcome === "REFUNDED" || result.outcome === "LATE_PAYMENT_REVIVED"
        ? "WARN"
        : "INFO";
  if (result.outcome !== "PENDING" && result.outcome !== "ALREADY_CONFIRMED" && result.outcome !== "NO_CHANGE") {
    await logEvent(level, "PAYMENT", `Pagamento ${gp.id}: ${result.outcome}`, {
      order: result.code,
      source,
      gatewayStatus: gp.rawStatus,
    });
  }
  return result.outcome;
}
