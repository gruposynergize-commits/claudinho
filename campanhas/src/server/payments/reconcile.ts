import "server-only";
import { db } from "../db";
import { logEvent } from "../logger";
import { markNow } from "../system-state";
import { applyGatewayPayment } from "./apply";
import { ensureChargeForOrder } from "./charges";
import { gatewayForCampaign } from "./gateway";

export type ReconcileSummary = {
  pendingChecked: number;
  confirmed: number;
  chargesRetried: number;
  paidRechecked: number;
  errors: number;
};

/**
 * Conciliação periódica (protege contra webhook perdido):
 * 1. pedidos automáticos pendentes com cobrança → consulta o gateway
 *    (com espaçamento crescente conforme a idade do pedido);
 * 2. cobranças que ficaram em CREATING → tenta de novo com a MESMA chave
 *    de idempotência (o gateway devolve a mesma cobrança, se já existir);
 * 3. pedidos pagos recentemente → reconsulta ocasional para detectar
 *    estornos/chargebacks antes do congelamento do sorteio.
 */
export async function reconcilePayments(opts: { limit?: number } = {}): Promise<ReconcileSummary> {
  const limit = opts.limit ?? 100;
  const summary: ReconcileSummary = { pendingChecked: 0, confirmed: 0, chargesRetried: 0, paidRechecked: 0, errors: 0 };

  const pending = await db().$queryRaw<{ payment_id: string; gateway_payment_id: string; campaign_id: string }[]>`
    SELECT p.id AS payment_id, p.gateway_payment_id, o.campaign_id
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE o.status = 'PENDING_PAYMENT' AND o.payment_mode = 'AUTOMATIC'
      AND p.status = 'PENDING' AND p.gateway_payment_id IS NOT NULL
      AND (p.last_checked_at IS NULL OR p.last_checked_at < now() - CASE
            WHEN o.created_at > now() - interval '15 minutes' THEN interval '45 seconds'
            WHEN o.created_at > now() - interval '2 hours' THEN interval '3 minutes'
            ELSE interval '15 minutes' END)
    ORDER BY p.last_checked_at NULLS FIRST
    LIMIT ${limit}`;

  for (const row of pending) {
    summary.pendingChecked++;
    try {
      await db().$executeRaw`UPDATE payments SET last_checked_at = now() WHERE id = ${row.payment_id}::uuid`;
      const client = await gatewayForCampaign(row.campaign_id);
      const gp = await client.getPayment(row.gateway_payment_id);
      const outcome = await applyGatewayPayment(gp, "RECONCILIATION");
      if (outcome === "CONFIRMED" || outcome === "LATE_PAYMENT_REVIVED") summary.confirmed++;
    } catch (e) {
      summary.errors++;
      await logEvent("WARN", "JOB", "Conciliação: falha ao consultar pagamento", { error: (e as Error).message });
    }
  }

  const stuck = await db().$queryRaw<{ order_id: string }[]>`
    SELECT p.order_id FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE o.status = 'PENDING_PAYMENT' AND o.payment_mode = 'AUTOMATIC' AND p.status = 'CREATING'
      AND p.created_at < now() - interval '1 minute'
      AND (p.creation_started_at IS NULL OR p.creation_started_at < now() - interval '1 minute')
    LIMIT ${limit}`;
  for (const row of stuck) {
    summary.chargesRetried++;
    try {
      await ensureChargeForOrder(row.order_id);
    } catch (e) {
      summary.errors++;
      await logEvent("WARN", "JOB", "Conciliação: nova tentativa de cobrança falhou", { error: (e as Error).message });
    }
  }

  const paid = await db().$queryRaw<{ payment_id: string; gateway_payment_id: string; campaign_id: string }[]>`
    SELECT p.id AS payment_id, p.gateway_payment_id, o.campaign_id
    FROM payments p JOIN orders o ON o.paid_payment_id = p.id JOIN campaigns c ON c.id = o.campaign_id
    WHERE o.status = 'PAID' AND p.gateway = 'MERCADO_PAGO' AND p.gateway_payment_id IS NOT NULL
      AND c.status IN ('ACTIVE', 'PAUSED', 'CLOSED')
      AND o.paid_at > now() - interval '45 days'
      AND (p.last_checked_at IS NULL OR p.last_checked_at < now() - interval '6 hours')
    ORDER BY p.last_checked_at NULLS FIRST
    LIMIT ${Math.ceil(limit / 4)}`;
  for (const row of paid) {
    summary.paidRechecked++;
    try {
      await db().$executeRaw`UPDATE payments SET last_checked_at = now() WHERE id = ${row.payment_id}::uuid`;
      const client = await gatewayForCampaign(row.campaign_id);
      await applyGatewayPayment(await client.getPayment(row.gateway_payment_id), "RECONCILIATION");
    } catch (e) {
      summary.errors++;
      await logEvent("WARN", "JOB", "Conciliação: falha ao reconsultar pagamento aprovado", { error: (e as Error).message });
    }
  }

  await markNow("jobs.reconcile.lastRunAt");
  if (summary.errors === 0 && (summary.pendingChecked > 0 || summary.paidRechecked > 0)) await markNow("gateway.lastSuccessAt");
  return summary;
}
