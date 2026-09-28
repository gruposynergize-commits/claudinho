import "server-only";
import { formatBRL } from "@/lib/money";
import { db, transaction, type Tx } from "../db";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { logEvent } from "../logger";
import { invalidateStatusCache } from "../campaigns/queries";
import { lockOrder, releasePendingOrderTx, type LockedOrder } from "../orders/lifecycle";
import { cancelChargeSafely } from "./charges";
import { checkOrderPayment } from "./status-check";

export type ManualConfirmInput = {
  orderId: string;
  /** Valor efetivamente identificado na conta (centavos), digitado pelo admin. */
  verifiedAmountCents: number;
  /** Referência do extrato (ex.: E2E id, horário, nome do pagador). */
  reference: string;
  reason: string;
  /** Checkbox "Você verificou o pagamento na conta?" */
  confirmedVerification: boolean;
};

async function reviveForManual(tx: Tx, order: LockedOrder): Promise<boolean> {
  const [c] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM campaigns WHERE id = ${order.campaign_id}::uuid FOR SHARE`;
  if (!c || !["ACTIVE", "PAUSED", "CLOSED"].includes(c.status)) return false;
  const grabbed = await tx.$executeRaw`
    UPDATE campaign_numbers SET status = 'PENDING_PAYMENT', order_id = ${order.id}::uuid,
      reserved_until = now() + interval '10 minutes', version = version + 1
    WHERE id IN (SELECT campaign_number_id FROM order_items WHERE order_id = ${order.id}::uuid) AND status = 'AVAILABLE'`;
  if (grabbed !== order.quantity) {
    await tx.$executeRaw`
      UPDATE campaign_numbers SET status = 'AVAILABLE', order_id = NULL, reserved_until = NULL, version = version + 1
      WHERE order_id = ${order.id}::uuid AND status = 'PENDING_PAYMENT'`;
    return false;
  }
  await tx.$executeRaw`UPDATE order_items SET active = true, released_at = NULL WHERE order_id = ${order.id}::uuid`;
  return true;
}

/**
 * Confirmação manual (somente Pix manual/estático), após conferência do
 * extrato pelo administrador. Exige: marcação explícita de verificação,
 * valor conferido ≥ total (valor menor nunca confirma), referência e motivo.
 * Gera AuditLog obrigatório na mesma transação.
 */
export async function confirmManualPayment(input: ManualConfirmInput, actor: Actor): Promise<{ revived: boolean }> {
  if (actor.type !== "USER") throw new AppError("FORBIDDEN", "Somente um usuário do painel pode confirmar.");
  if (!input.confirmedVerification) {
    throw new AppError("VALIDATION", "Confirme que verificou o pagamento na conta.");
  }
  if (!Number.isSafeInteger(input.verifiedAmountCents) || input.verifiedAmountCents <= 0) {
    throw new AppError("VALIDATION", "Informe o valor identificado na conta.");
  }
  if (input.reference.trim().length < 3) throw new AppError("VALIDATION", "Informe a referência do pagamento no extrato.");
  if (input.reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo da confirmação manual.");

  const result = await transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    if (order.payment_mode !== "MANUAL") {
      throw new AppError(
        "INVALID_STATE",
        "Pedidos do Pix automático são confirmados pelo gateway. Use “Verificar no gateway”.",
      );
    }
    if (order.status === "PAID") throw new AppError("INVALID_STATE", "Este pedido já está pago.");
    if (order.status === "REFUNDED") throw new AppError("INVALID_STATE", "Este pedido foi reembolsado.");
    if (input.verifiedAmountCents < order.total_cents) {
      await tx.paymentEvent.create({
        data: {
          orderId: order.id,
          source: "MANUAL",
          type: "MANUAL_AMOUNT_INSUFFICIENT",
          processingStatus: "REJECTED",
          payload: { expectedCents: order.total_cents, verifiedCents: input.verifiedAmountCents, by: actor.label },
          processedAt: new Date(),
        },
      });
      throw new AppError(
        "VALIDATION",
        `O valor identificado (${formatBRL(input.verifiedAmountCents)}) é menor que o total do pedido (${formatBRL(order.total_cents)}). O pedido não pode ser confirmado.`,
      );
    }
    if (input.verifiedAmountCents > order.total_cents && input.reason.trim().length < 10) {
      throw new AppError("VALIDATION", "Valor maior que o total: descreva no motivo como a diferença será tratada.");
    }

    let revived = false;
    if (order.status !== "PENDING_PAYMENT") {
      revived = await reviveForManual(tx, order);
      if (!revived) {
        throw new AppError(
          "CONFLICT",
          "Os números deste pedido já não estão livres (ou a campanha foi congelada). Trate como devolução ao comprador.",
        );
      }
    }

    const payments = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM payments WHERE order_id = ${order.id}::uuid AND gateway = 'STATIC_PIX'
      ORDER BY created_at LIMIT 1 FOR NO KEY UPDATE`;
    let paymentId = payments[0]?.id;
    if (!paymentId) {
      const created = await tx.payment.create({
        data: {
          orderId: order.id,
          gateway: "STATIC_PIX",
          mode: "MANUAL",
          status: "CANCELLED",
          idempotencyKey: `order:${order.id}:manual`,
          amountCents: order.total_cents,
        },
      });
      paymentId = created.id;
    }
    await tx.$executeRaw`
      UPDATE payments SET status = 'APPROVED', paid_amount_cents = ${input.verifiedAmountCents}, approved_at = now(),
        confirmation_source = 'MANUAL', confirmed_by_id = ${actor.id}::uuid, manual_reference = ${input.reference.trim().slice(0, 200)}
      WHERE id = ${paymentId}::uuid`;

    const paid = await tx.$executeRaw`
      UPDATE campaign_numbers SET status = 'PAID', paid_at = now(), version = version + 1
      WHERE order_id = ${order.id}::uuid AND status = 'PENDING_PAYMENT'`;
    if (paid !== order.quantity) throw new Error(`inconsistência: ${paid} de ${order.quantity} números`);
    await tx.$executeRaw`
      UPDATE orders SET status = 'PAID', paid_at = now(), paid_payment_id = ${paymentId}::uuid, version = version + 1
      WHERE id = ${order.id}::uuid`;

    await tx.paymentEvent.create({
      data: {
        orderId: order.id,
        paymentId,
        source: "MANUAL",
        type: revived ? "MANUAL_CONFIRMATION_LATE" : "MANUAL_CONFIRMATION",
        processingStatus: "PROCESSED",
        payload: { verifiedCents: input.verifiedAmountCents, reference: input.reference.trim().slice(0, 200), by: actor.label },
        processedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "PAYMENT_MANUAL_CONFIRMED",
      entityType: "order",
      entityId: order.id,
      campaignId: order.campaign_id,
      before: { status: order.status, code: order.code },
      after: { status: "PAID", verifiedAmountCents: input.verifiedAmountCents, reference: input.reference.trim() },
      reason: input.reason.trim(),
    });
    return { revived, campaignId: order.campaign_id, code: order.code };
  });
  invalidateStatusCache(result.campaignId);
  await logEvent("INFO", "ADMIN", "Pagamento confirmado manualmente", { order: result.code, by: actor.label });
  return { revived: result.revived };
}

/**
 * Cancelamento administrativo de pedido AUTOMÁTICO pendente: cancela a
 * cobrança no gateway antes de liberar os números.
 */
export async function cancelAutomaticOrder(orderId: string, actor: Actor, reason: string): Promise<"cancelled" | "paid"> {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo do cancelamento.");
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: { payments: { where: { status: { in: ["CREATING", "PENDING"] } } } },
  });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  if (order.paymentMode !== "AUTOMATIC") throw new AppError("INVALID_STATE", "Pedido não é do Pix automático.");
  if (order.status !== "PENDING_PAYMENT") throw new AppError("INVALID_STATE", "Somente pedidos aguardando pagamento podem ser cancelados.");

  for (const p of order.payments) {
    if (!p.gatewayPaymentId) continue;
    const r = await cancelChargeSafely(order.campaignId, p.gatewayPaymentId, `cancel:${order.id}:${p.gatewayPaymentId}:admin`);
    if (r === "paid") return "paid";
    if (r === "failed") {
      throw new AppError("GATEWAY_UNAVAILABLE", "Não foi possível confirmar o cancelamento no gateway. Os números continuam reservados.");
    }
  }
  if (order.payments.some((p) => !p.gatewayPaymentId)) {
    // Cobrança possivelmente criada sem id salvo: verifica antes de liberar.
    await checkOrderPayment(order.id, 0);
  }
  await transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (!locked) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    if (locked.status === "PENDING_PAYMENT") {
      await releasePendingOrderTx(tx, orderId, "CANCELLED", { reason, source: "MANUAL" });
    }
    await writeAudit(tx, {
      actor,
      action: "ORDER_CANCELLED",
      entityType: "order",
      entityId: orderId,
      campaignId: locked.campaign_id,
      before: { status: "PENDING_PAYMENT" },
      after: { status: locked.status === "PENDING_PAYMENT" ? "CANCELLED" : locked.status },
      reason,
    });
  });
  return "cancelled";
}
