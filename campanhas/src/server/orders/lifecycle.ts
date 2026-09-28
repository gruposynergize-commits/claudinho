import "server-only";
import type { OrderStatus, PaymentEventSource, PaymentMode } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "../db";
import { AppError } from "../errors";
import { logEvent } from "../logger";
import { writeAudit, type Actor } from "../audit";
import { invalidateStatusCache } from "../campaigns/queries";
import { hashAccessToken, isPlausibleToken } from "./access";

export type LockedOrder = {
  id: string;
  code: string;
  campaign_id: string;
  status: OrderStatus;
  payment_mode: PaymentMode;
  quantity: number;
  total_cents: number;
  expires_at: Date;
  customer_reported_paid_at: Date | null;
  paid_payment_id: string | null;
  /** Calculado com o relógio do banco. */
  expired: boolean;
};

export async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, code, campaign_id, status, payment_mode, quantity, total_cents, expires_at,
           customer_reported_paid_at, paid_payment_id, (expires_at < now()) AS expired
    FROM orders WHERE id = ${orderId}::uuid FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}

/**
 * Encerra um pedido pendente devolvendo seus números (PENDING_PAYMENT →
 * AVAILABLE). Só deve ser chamado quando se sabe que não haverá pagamento
 * (no modo automático: depois de confirmar/cancelar no gateway).
 * Retorna false se o pedido já não estava pendente (idempotente).
 */
export async function releasePendingOrderTx(
  tx: Tx,
  orderId: string,
  to: "EXPIRED" | "CANCELLED" | "ERROR",
  opts: { reason?: string; source: PaymentEventSource },
): Promise<boolean> {
  const order = await lockOrder(tx, orderId);
  if (!order || order.status !== "PENDING_PAYMENT") return false;

  const released = await tx.$executeRaw`
    UPDATE campaign_numbers
    SET status = 'AVAILABLE', order_id = NULL, reserved_until = NULL, version = version + 1
    WHERE order_id = ${orderId}::uuid AND status = 'PENDING_PAYMENT'`;
  if (released !== order.quantity) {
    throw new Error(`inconsistência: pedido ${order.code} liberou ${released} de ${order.quantity} números`);
  }
  await tx.$executeRaw`
    UPDATE order_items SET active = false, released_at = now() WHERE order_id = ${orderId}::uuid AND active`;

  if (to === "EXPIRED") {
    await tx.$executeRaw`UPDATE orders SET status = 'EXPIRED', expired_at = now(), version = version + 1 WHERE id = ${orderId}::uuid`;
  } else if (to === "CANCELLED") {
    await tx.$executeRaw`
      UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = ${opts.reason ?? null},
             version = version + 1
      WHERE id = ${orderId}::uuid`;
  } else {
    await tx.$executeRaw`UPDATE orders SET status = 'ERROR', version = version + 1 WHERE id = ${orderId}::uuid`;
  }

  const paymentStatus = to === "EXPIRED" ? "EXPIRED" : to === "CANCELLED" ? "CANCELLED" : "FAILED";
  await tx.$executeRaw`
    UPDATE payments SET status = ${paymentStatus}::payment_status
    WHERE order_id = ${orderId}::uuid AND status IN ('CREATING', 'PENDING')`;

  await tx.paymentEvent.create({
    data: {
      orderId,
      source: opts.source,
      type: `ORDER_${to}`,
      processingStatus: "PROCESSED",
      payload: { code: order.code, reason: opts.reason ?? null, releasedNumbers: released },
      processedAt: new Date(),
    },
  });
  invalidateStatusCache(order.campaign_id);
  return true;
}

/**
 * Rotina (modo MANUAL): expira pedidos vencidos em que o comprador NÃO
 * informou pagamento. Pedidos com "Já paguei" aguardam conferência do
 * administrador e nunca são liberados automaticamente.
 */
export async function expireManualOrders(limit = 100): Promise<number> {
  const candidates = await db().$queryRaw<{ id: string }[]>`
    SELECT id FROM orders
    WHERE status = 'PENDING_PAYMENT' AND payment_mode = 'MANUAL'
      AND expires_at < now() AND customer_reported_paid_at IS NULL
    ORDER BY expires_at LIMIT ${limit}`;
  let count = 0;
  for (const c of candidates) {
    const done = await transaction(async (tx) => {
      // Reconfere sob lock: o comprador pode ter clicado "Já paguei" agora.
      const o = await lockOrder(tx, c.id);
      if (!o || o.status !== "PENDING_PAYMENT" || o.customer_reported_paid_at || !o.expired) return false;
      return releasePendingOrderTx(tx, c.id, "EXPIRED", { source: "EXPIRATION_JOB", reason: "prazo de pagamento encerrado" });
    });
    if (done) count++;
  }
  return count;
}

/**
 * "Já paguei" (Pix manual): apenas registra a informação do comprador. O
 * pedido continua PENDING_PAYMENT até a conferência do administrador.
 */
export async function reportPaidByCustomer(token: string, note: string | undefined): Promise<void> {
  if (!isPlausibleToken(token)) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  await transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { accessTokenHash: hashAccessToken(token) } });
    if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    const locked = await lockOrder(tx, order.id);
    if (!locked || locked.status !== "PENDING_PAYMENT") {
      throw new AppError("INVALID_STATE", "Este pedido não está aguardando pagamento.");
    }
    if (locked.payment_mode !== "MANUAL") {
      throw new AppError("INVALID_STATE", "Este pedido é confirmado automaticamente pelo sistema de pagamentos.");
    }
    if (locked.customer_reported_paid_at) return;
    if (locked.expired) {
      throw new AppError("INVALID_STATE", "O prazo deste pedido terminou. Se você pagou, fale com a organização.");
    }
    await tx.$executeRaw`
      UPDATE orders SET customer_reported_paid_at = now(), customer_payment_note = ${note?.slice(0, 300) ?? null}
      WHERE id = ${order.id}::uuid`;
    await tx.paymentEvent.create({
      data: {
        orderId: order.id,
        source: "CUSTOMER",
        type: "CUSTOMER_REPORTED_PAID",
        processingStatus: "PROCESSED",
        payload: { note: note?.slice(0, 300) ?? null },
        processedAt: new Date(),
      },
    });
  });
  void logEvent("INFO", "PAYMENT", "Comprador informou pagamento (Pix manual) — aguardando conferência");
}

/** Cancelamento administrativo de pedido pendente (auditado). */
export async function cancelPendingOrder(orderId: string, actor: Actor, reason: string): Promise<void> {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo do cancelamento.");
  await transaction(async (tx) => {
    const before = await lockOrder(tx, orderId);
    if (!before) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    if (before.status !== "PENDING_PAYMENT") {
      throw new AppError("INVALID_STATE", "Somente pedidos aguardando pagamento podem ser cancelados.");
    }
    if (before.payment_mode === "AUTOMATIC") {
      // No automático, o cancelamento precisa passar pelo gateway (ver payments/expire.ts).
      throw new AppError("INVALID_STATE", "Use o cancelamento com verificação no gateway.");
    }
    await releasePendingOrderTx(tx, orderId, "CANCELLED", { reason, source: "MANUAL" });
    await writeAudit(tx, {
      actor,
      action: "ORDER_CANCELLED",
      entityType: "order",
      entityId: orderId,
      campaignId: before.campaign_id,
      before: { status: before.status },
      after: { status: "CANCELLED" },
      reason,
    });
  });
}
