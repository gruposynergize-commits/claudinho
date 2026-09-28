import "server-only";
import { db } from "../db";
import { logEvent } from "../logger";
import { markNow } from "../system-state";
import { hashAccessToken, isPlausibleToken } from "../orders/access";
import { applyGatewayPayment, type ApplyOutcome } from "./apply";
import { ensureChargeForOrder } from "./charges";
import { gatewayForCampaign } from "./gateway";

/**
 * Consulta o gateway para um pedido automático pendente, no máximo uma vez a
 * cada `minIntervalSeconds` (controle feito no banco, vale para todas as
 * instâncias). Cobre webhook atrasado/perdido enquanto o comprador está na
 * página do pedido.
 */
export async function checkOrderPayment(orderId: string, minIntervalSeconds = 15): Promise<ApplyOutcome | "SKIPPED"> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      paymentMode: true,
      campaignId: true,
      payments: {
        where: { gatewayPaymentId: { not: null }, status: { in: ["PENDING", "CREATING"] } },
        select: { id: true, gatewayPaymentId: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!order || order.paymentMode !== "AUTOMATIC" || order.status !== "PENDING_PAYMENT") return "SKIPPED";
  const payment = order.payments[0];
  if (!payment?.gatewayPaymentId) {
    await ensureChargeForOrder(order.id).catch(() => undefined);
    return "SKIPPED";
  }
  const claimed = await db().$executeRaw`
    UPDATE payments SET last_checked_at = now()
    WHERE id = ${payment.id}::uuid
      AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(secs => ${minIntervalSeconds}::int))`;
  if (claimed === 0) return "SKIPPED";
  try {
    const client = await gatewayForCampaign(order.campaignId);
    const gp = await client.getPayment(payment.gatewayPaymentId);
    await markNow("gateway.lastSuccessAt");
    return await applyGatewayPayment(gp, "STATUS_CHECK");
  } catch (e) {
    await markNow("gateway.lastErrorAt");
    await logEvent("WARN", "PAYMENT", "Consulta de status no gateway falhou", { error: (e as Error).message });
    return "SKIPPED";
  }
}

export async function refreshOrderPaymentIfStale(token: string): Promise<void> {
  if (!isPlausibleToken(token)) return;
  const order = await db().order.findUnique({
    where: { accessTokenHash: hashAccessToken(token) },
    select: { id: true, status: true, paymentMode: true },
  });
  if (!order || order.status !== "PENDING_PAYMENT" || order.paymentMode !== "AUTOMATIC") return;
  await checkOrderPayment(order.id);
}
