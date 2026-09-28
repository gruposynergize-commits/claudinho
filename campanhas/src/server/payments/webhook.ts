import "server-only";
import { db } from "../db";
import { isUniqueViolation } from "../db-errors";
import { logEvent } from "../logger";
import { markNow } from "../system-state";
import { getWebhookSecrets } from "./settings";
import { applyGatewayPayment } from "./apply";
import { allGatewayClients, gatewayForCampaign } from "./gateway";
import { verifyMercadoPagoSignature } from "./gateway/mercadopago";
import type { GatewayPayment, PixGatewayClient } from "./gateway/types";

export type WebhookResult = { status: number; body: Record<string, unknown> };

type Incoming = {
  rawBody: string;
  query: URLSearchParams;
  headers: Headers;
};

const MAX_BODY = 64 * 1024;

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Busca o pagamento no gateway com as credenciais corretas. */
async function fetchGatewayPayment(gatewayPaymentId: string): Promise<GatewayPayment> {
  const known = await db().payment.findUnique({
    where: { gateway_gatewayPaymentId: { gateway: "MERCADO_PAGO", gatewayPaymentId } },
    select: { order: { select: { campaignId: true } } },
  });
  let clients: PixGatewayClient[];
  if (known) clients = [await gatewayForCampaign(known.order.campaignId)];
  else clients = await allGatewayClients();
  if (clients.length === 0) throw new Error("nenhuma credencial de gateway configurada");
  let lastError: unknown;
  for (const client of clients) {
    try {
      return await client.getPayment(gatewayPaymentId);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("falha ao consultar pagamento");
}

/**
 * Processa uma notificação do Mercado Pago.
 *
 * 1. valida a assinatura (x-signature) — inválida → 401;
 * 2. deduplica pelo x-request-id / id da notificação;
 * 3. CONSULTA o pagamento na API (o corpo da notificação não é confiável);
 * 4. aplica de forma idempotente (valida referência, valor e pedido);
 * 5. falhas de consulta → 500 para que o gateway reenvie (a conciliação
 *    também cobre notificações perdidas).
 */
export async function handleMercadoPagoWebhook(input: Incoming): Promise<WebhookResult> {
  const receivedAt = new Date();
  await markNow("webhook.lastReceivedAt");
  if (Buffer.byteLength(input.rawBody) > MAX_BODY) return { status: 413, body: { ok: false } };

  const body = safeJson(input.rawBody) ?? {};
  const dataFromBody = (body.data as Record<string, unknown> | undefined)?.id;
  const dataId = input.query.get("data.id") ?? input.query.get("id") ?? (dataFromBody !== undefined ? String(dataFromBody) : null);
  const type = input.query.get("type") ?? input.query.get("topic") ?? (typeof body.type === "string" ? body.type : null);
  const xSignature = input.headers.get("x-signature");
  const xRequestId = input.headers.get("x-request-id");

  const secrets = await getWebhookSecrets();
  if (secrets.length === 0) {
    await logEvent("ERROR", "WEBHOOK", "Webhook recebido sem segredo configurado para validação", {});
    return { status: 401, body: { ok: false } };
  }
  const valid = secrets.some(
    (secret) => verifyMercadoPagoSignature({ xSignature, xRequestId, dataId, secret }).valid,
  );
  const payloadForLog = { query: Object.fromEntries(input.query), body, requestId: xRequestId };

  if (!valid) {
    await markNow("webhook.lastInvalidAt");
    await db().paymentEvent.create({
      data: {
        gateway: "MERCADO_PAGO",
        source: "WEBHOOK",
        type: "WEBHOOK_INVALID_SIGNATURE",
        externalId: dataId,
        processingStatus: "REJECTED",
        signatureValid: false,
        payload: JSON.parse(JSON.stringify(payloadForLog)) as object,
        processedAt: receivedAt,
      },
    });
    await logEvent("WARN", "SECURITY", "Webhook com assinatura inválida rejeitado", { dataId, type });
    return { status: 401, body: { ok: false } };
  }
  await markNow("webhook.lastValidAt");

  if (type !== "payment" || !dataId || !/^[A-Za-z0-9_-]{1,64}$/.test(dataId)) {
    await db().paymentEvent.create({
      data: {
        gateway: "MERCADO_PAGO",
        source: "WEBHOOK",
        type: "WEBHOOK_IGNORED",
        externalId: dataId,
        processingStatus: "IGNORED",
        signatureValid: true,
        payload: JSON.parse(JSON.stringify(payloadForLog)) as object,
        processedAt: receivedAt,
      },
    });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const notificationId = typeof body.id === "string" || typeof body.id === "number" ? String(body.id) : null;
  const dedupeKey = `mp:${xRequestId ?? `notif-${notificationId ?? "none"}`}:${dataId}`;

  let eventId: string;
  try {
    const ev = await db().paymentEvent.create({
      data: {
        gateway: "MERCADO_PAGO",
        source: "WEBHOOK",
        type: "WEBHOOK_RECEIVED",
        dedupeKey,
        externalId: dataId,
        processingStatus: "RECEIVED",
        signatureValid: true,
        payload: JSON.parse(JSON.stringify(payloadForLog)) as object,
      },
    });
    eventId = ev.id;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await db().paymentEvent.findUnique({ where: { dedupeKey } });
    if (existing?.processingStatus === "PROCESSED") {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    // Entrega anterior falhou: reprocessa (a aplicação é idempotente).
    eventId = existing!.id;
  }

  try {
    const gp = await fetchGatewayPayment(dataId);
    await markNow("gateway.lastSuccessAt");
    const outcome = await applyGatewayPayment(gp, "WEBHOOK");
    const local = await db().payment.findUnique({
      where: { gateway_gatewayPaymentId: { gateway: "MERCADO_PAGO", gatewayPaymentId: gp.id } },
      select: { id: true, orderId: true },
    });
    await db().paymentEvent.update({
      where: { id: eventId },
      data: {
        processingStatus: outcome === "UNKNOWN_ORDER" ? "IGNORED" : "PROCESSED",
        processedAt: new Date(),
        paymentId: local?.id ?? null,
        orderId: local?.orderId ?? null,
        error: outcome === "UNKNOWN_ORDER" || outcome === "REFERENCE_MISMATCH" ? outcome : null,
      },
    });
    return { status: 200, body: { ok: true, outcome } };
  } catch (e) {
    await markNow("gateway.lastErrorAt");
    await db().paymentEvent.update({
      where: { id: eventId },
      data: { processingStatus: "FAILED", error: (e as Error).message.slice(0, 500) },
    });
    await logEvent("ERROR", "WEBHOOK", "Falha ao processar webhook (gateway será consultado novamente)", {
      dataId,
      error: (e as Error).message,
    });
    return { status: 500, body: { ok: false } };
  }
}
