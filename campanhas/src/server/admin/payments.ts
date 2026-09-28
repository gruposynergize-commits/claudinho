import "server-only";
import { db, transaction } from "../db";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";

/** Pagamentos que exigem tratamento administrativo (valor divergente, duplicado, tardio…). */
export async function listAttentionPayments(campaignId: string, opts: { includeResolved?: boolean } = {}) {
  return db().payment.findMany({
    where: {
      requiresAttention: true,
      ...(opts.includeResolved ? {} : { resolvedAt: null }),
      order: { campaignId },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      order: { select: { id: true, code: true, customerName: true, totalCents: true, status: true, paidPaymentId: true } },
      resolvedBy: { select: { email: true } },
    },
  });
}

/**
 * Registra o tratamento de um pagamento com pendência (ex.: devolução feita
 * pelo app do banco). Não altera pedido nem números; opcionalmente marca o
 * pagamento como reembolsado. O pagamento que confirmou um pedido só é
 * reembolsado pelo fluxo de reembolso do pedido.
 */
export async function resolveAttentionPayment(
  paymentId: string,
  input: { notes: string; markRefunded: boolean },
  actor: Actor & { type: "USER" },
) {
  if (input.notes.trim().length < 10) throw new AppError("VALIDATION", "Descreva como a pendência foi tratada.");
  await transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: { select: { campaignId: true, paidPaymentId: true, code: true } } } });
    if (!p) throw new AppError("NOT_FOUND", "Pagamento não encontrado.");
    if (!p.requiresAttention) throw new AppError("INVALID_STATE", "Este pagamento não tem pendência.");
    if (p.resolvedAt) throw new AppError("INVALID_STATE", "Pendência já tratada.");
    if (input.markRefunded && p.order.paidPaymentId === p.id) {
      throw new AppError("INVALID_STATE", "Este pagamento confirmou o pedido: use o reembolso do pedido.");
    }
    if (input.markRefunded && !["AMOUNT_MISMATCH", "APPROVED"].includes(p.status)) {
      throw new AppError("INVALID_STATE", "Situação do pagamento não permite marcar reembolso.");
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolutionNotes: input.notes.trim().slice(0, 2000),
        ...(input.markRefunded ? { status: "REFUNDED" } : {}),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "PAYMENT_ATTENTION_RESOLVED",
      entityType: "payment",
      entityId: paymentId,
      campaignId: p.order.campaignId,
      before: { status: p.status, attentionReason: p.attentionReason },
      after: { resolved: true, markedRefunded: input.markRefunded, order: p.order.code },
      reason: input.notes,
    });
  });
}
