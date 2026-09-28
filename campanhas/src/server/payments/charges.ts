import "server-only";
import { db, transaction } from "../db";
import { env } from "../env";
import { logEvent } from "../logger";
import { markNow, setState } from "../system-state";
import { lockOrder, releasePendingOrderTx } from "../orders/lifecycle";
import { validatePixPayloadForOrder } from "./qr";
import { applyGatewayPayment } from "./apply";
import { gatewayForCampaign, notificationUrl } from "./gateway";
import { GatewayError, type GatewayPayment } from "./gateway/types";

export type ChargeResult = { ready: boolean; reason?: "not_pending" | "in_progress" | "gateway_error" | "rejected" | "invalid_payload" };

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() ?? full;
  return { firstName, lastName: parts.join(" ") || firstName };
}

/**
 * Garante que o pedido automático tenha uma cobrança Pix no gateway.
 *
 * Idempotente e segura para chamadas concorrentes/repetidas:
 * - usa sempre a mesma X-Idempotency-Key do registro de pagamento
 *   (`order:<id>:1`), então o gateway devolve a MESMA cobrança;
 * - um "lease" de 30 s evita chamadas simultâneas desnecessárias;
 * - nenhuma transação fica aberta durante a chamada HTTP.
 */
export async function ensureChargeForOrder(orderId: string): Promise<ChargeResult> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      campaign: { select: { name: true } },
      customer: { select: { email: true } },
      payments: { where: { status: { in: ["CREATING", "PENDING"] } }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!order || order.status !== "PENDING_PAYMENT") return { ready: false, reason: "not_pending" };
  if (order.paymentMode === "MANUAL") return { ready: true };
  const payment = order.payments[0];
  if (!payment) return { ready: false, reason: "not_pending" };
  if (payment.status === "PENDING" && payment.gatewayPaymentId && payment.pixCopyPaste) return { ready: true };

  // Lease: só um processo por vez tenta criar a cobrança deste pedido.
  const leased = await db().$executeRaw`
    UPDATE payments SET creation_attempts = creation_attempts + 1, creation_started_at = now()
    WHERE id = ${payment.id}::uuid AND status IN ('CREATING', 'PENDING')
      AND (creation_started_at IS NULL OR creation_started_at < now() - interval '30 seconds')`;
  if (leased === 0) return { ready: false, reason: "in_progress" };

  const minMinutes = env().MERCADOPAGO_PIX_MIN_EXPIRATION_MINUTES;
  const minExpiry = new Date(Date.now() + minMinutes * 60_000);
  // A cobrança pode viver mais que a reserva; na expiração do pedido ela é
  // cancelada no gateway ANTES de liberar os números (payments/expire.ts).
  const chargeExpiry = order.expiresAt > minExpiry ? order.expiresAt : minExpiry;
  const email = order.customerEmail ?? order.customer.email;

  let gp: GatewayPayment;
  try {
    if (!email) throw new GatewayError("http", "e-mail do pagador ausente", { httpStatus: 400 });
    const client = await gatewayForCampaign(order.campaignId);
    gp = await client.createPixCharge({
      idempotencyKey: payment.idempotencyKey,
      amountCents: order.totalCents,
      description: `${order.campaign.name} - Pedido ${order.code}`,
      externalReference: order.code,
      expiresAt: chargeExpiry,
      notificationUrl: notificationUrl(),
      payer: { email, ...splitName(order.customerName) },
      metadata: { order_code: order.code },
    });
    await markNow("gateway.lastSuccessAt");
  } catch (e) {
    const err = e instanceof GatewayError ? e : new GatewayError("network", (e as Error).message, { cause: e });
    await db().$executeRaw`
      UPDATE payments SET last_error = ${`${err.kind}:${err.httpStatus ?? ""} ${err.message}`.slice(0, 500)}
      WHERE id = ${payment.id}::uuid`;
    await markNow("gateway.lastErrorAt");
    await setState("gateway.lastError", { at: new Date().toISOString(), kind: err.kind, status: err.httpStatus ?? null });
    await logEvent(err.retryable ? "WARN" : "ERROR", "PAYMENT", "Falha ao criar cobrança Pix", {
      order: order.code,
      kind: err.kind,
      httpStatus: err.httpStatus,
      snippet: err.responseSnippet,
    });
    if (err.isClientDataError) {
      // Dados recusados pelo gateway: repetir não resolve. Libera os números.
      await transaction(async (tx) => {
        await releasePendingOrderTx(tx, order.id, "ERROR", { source: "SYSTEM", reason: "gateway recusou os dados da cobrança" });
      });
      return { ready: false, reason: "rejected" };
    }
    return { ready: false, reason: "gateway_error" };
  }

  if (gp.externalReference !== order.code || gp.amountCents !== order.totalCents) {
    await logEvent("CRITICAL", "PAYMENT", "Cobrança retornada não corresponde ao pedido", {
      order: order.code,
      gatewayPaymentId: gp.id,
      reference: gp.externalReference,
      amountCents: gp.amountCents,
    });
    return { ready: false, reason: "invalid_payload" };
  }
  const payloadOk = gp.qrCode
    ? await validatePixPayloadForOrder(gp.qrCode, order.totalCents, { order: order.code, gatewayPaymentId: gp.id })
    : false;

  const stillPending = await transaction(async (tx) => {
    const locked = await lockOrder(tx, order.id);
    await tx.$executeRaw`
      UPDATE payments SET gateway_payment_id = ${gp.id},
        status = CASE WHEN status = 'CREATING' THEN 'PENDING'::payment_status ELSE status END,
        pix_copy_paste = ${payloadOk ? gp.qrCode : null}, ticket_url = ${gp.ticketUrl},
        expires_at = ${gp.expiresAt ?? chargeExpiry}, gateway_status = ${gp.rawStatus}, last_error = NULL
      WHERE id = ${payment.id}::uuid AND (gateway_payment_id IS NULL OR gateway_payment_id = ${gp.id})`;
    await tx.paymentEvent.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        gateway: "MERCADO_PAGO",
        source: "SYSTEM",
        type: "CHARGE_CREATED",
        externalId: gp.id,
        processingStatus: "PROCESSED",
        payload: { status: gp.rawStatus, expiresAt: gp.expiresAt?.toISOString() ?? null },
        processedAt: new Date(),
      },
    });
    return locked?.status === "PENDING_PAYMENT";
  });

  if (!stillPending || gp.status !== "PENDING") {
    // O pedido expirou/foi cancelado enquanto a cobrança era criada, ou a
    // cobrança já veio com outro estado: aplica pelo fluxo padrão.
    await applyGatewayPayment(gp, "SYSTEM");
    if (!stillPending && gp.status === "PENDING") {
      await cancelChargeSafely(order.campaignId, gp.id, `cancel:${order.id}:late-create`);
    }
    return { ready: false, reason: "not_pending" };
  }
  return { ready: payloadOk, reason: payloadOk ? undefined : "invalid_payload" };
}

/**
 * Cancela uma cobrança pendente no gateway e aplica o estado resultante.
 * Se o gateway recusar porque já foi paga, a nova consulta confirma o pedido.
 */
export async function cancelChargeSafely(campaignId: string, gatewayPaymentId: string, idempotencyKey: string): Promise<"cancelled" | "paid" | "failed"> {
  const client = await gatewayForCampaign(campaignId);
  try {
    const gp = await client.cancelPayment(gatewayPaymentId, idempotencyKey);
    await applyGatewayPayment(gp, "EXPIRATION_JOB");
    return gp.status === "APPROVED" ? "paid" : gp.status === "PENDING" ? "failed" : "cancelled";
  } catch (e) {
    // Recusa do cancelamento (ex.: pagamento aprovado no mesmo instante):
    // consulta o estado real antes de decidir qualquer coisa.
    try {
      const gp = await client.getPayment(gatewayPaymentId);
      await applyGatewayPayment(gp, "EXPIRATION_JOB");
      if (gp.status === "APPROVED") return "paid";
      if (gp.status === "CANCELLED" || gp.status === "REJECTED") return "cancelled";
    } catch {
      // gateway indisponível: mantém a reserva e tenta na próxima execução
    }
    await logEvent("WARN", "PAYMENT", "Não foi possível cancelar cobrança no gateway", {
      gatewayPaymentId,
      error: (e as Error).message,
    });
    return "failed";
  }
}
