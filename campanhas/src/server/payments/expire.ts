import "server-only";
import { db, transaction } from "../db";
import { logEvent } from "../logger";
import { markNow } from "../system-state";
import { releasePendingOrderTx, lockOrder } from "../orders/lifecycle";
import { applyGatewayPayment } from "./apply";
import { cancelChargeSafely } from "./charges";
import { gatewayForCampaign } from "./gateway";

export type ExpireSummary = { checked: number; expired: number; confirmed: number; kept: number };

/**
 * Expiração de pedidos AUTOMÁTICOS vencidos.
 *
 * Regra de ouro: um número só volta a ficar disponível depois que o gateway
 * confirma que a cobrança NÃO foi e NÃO poderá mais ser paga (cancelada).
 * - pago no gateway → confirma o pedido (mesmo "atrasado");
 * - pendente → cancela a cobrança; cancelou → libera; foi paga → confirma;
 * - gateway indisponível → mantém os números e tenta de novo depois.
 */
export async function expireAutomaticOrders(limit = 50): Promise<ExpireSummary> {
  const summary: ExpireSummary = { checked: 0, expired: 0, confirmed: 0, kept: 0 };
  const candidates = await db().$queryRaw<{ id: string; campaign_id: string; code: string }[]>`
    SELECT id, campaign_id, code FROM orders
    WHERE status = 'PENDING_PAYMENT' AND payment_mode = 'AUTOMATIC' AND expires_at < now()
    ORDER BY expires_at LIMIT ${limit}`;

  for (const c of candidates) {
    summary.checked++;
    try {
      const payments = await db().payment.findMany({
        where: { orderId: c.id, status: { in: ["CREATING", "PENDING"] } },
        orderBy: { createdAt: "asc" },
      });
      const client = await gatewayForCampaign(c.campaign_id);

      // Cobranças cujo id não foi salvo: procura no gateway pela referência.
      const unknownCreation = payments.some((p) => !p.gatewayPaymentId);
      if (unknownCreation) {
        const recent = payments.some(
          (p) => !p.gatewayPaymentId && p.creationStartedAt && Date.now() - p.creationStartedAt.getTime() < 120_000,
        );
        if (recent) {
          summary.kept++;
          continue;
        }
        const found = await client.searchByExternalReference(c.code);
        for (const gp of found) await applyGatewayPayment(gp, "EXPIRATION_JOB");
      }

      const open = await db().payment.findMany({
        where: { orderId: c.id, status: { in: ["CREATING", "PENDING"] }, gatewayPaymentId: { not: null } },
      });
      let paid = false;
      let allClosed = true;
      for (const p of open) {
        const gp = await client.getPayment(p.gatewayPaymentId!);
        if (gp.status === "PENDING") {
          const r = await cancelChargeSafely(c.campaign_id, gp.id, `cancel:${c.id}:${gp.id}`);
          if (r === "paid") paid = true;
          if (r === "failed") allClosed = false;
        } else {
          await applyGatewayPayment(gp, "EXPIRATION_JOB");
          if (gp.status === "APPROVED") paid = true;
        }
      }
      await markNow("gateway.lastSuccessAt");

      if (paid) {
        summary.confirmed++;
        continue;
      }
      if (!allClosed) {
        summary.kept++;
        continue;
      }
      const released = await transaction(async (tx) => {
        const o = await lockOrder(tx, c.id);
        if (!o || o.status !== "PENDING_PAYMENT" || !o.expired) return false;
        const stillOpen = await tx.payment.count({
          where: { orderId: c.id, status: { in: ["PENDING"] }, gatewayPaymentId: { not: null } },
        });
        if (stillOpen > 0) return false;
        return releasePendingOrderTx(tx, c.id, "EXPIRED", {
          source: "EXPIRATION_JOB",
          reason: "prazo encerrado; cobrança cancelada/inexistente no gateway",
        });
      });
      const after = await db().order.findUnique({ where: { id: c.id }, select: { status: true } });
      if (released || after?.status === "EXPIRED") summary.expired++;
      else if (after?.status === "PAID") summary.confirmed++;
      else summary.kept++;
    } catch (e) {
      summary.kept++;
      await markNow("gateway.lastErrorAt");
      await logEvent("WARN", "JOB", "Expiração adiada: gateway indisponível; números permanecem reservados", {
        order: c.code,
        error: (e as Error).message,
      });
    }
  }
  return summary;
}
