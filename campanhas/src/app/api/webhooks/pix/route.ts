import { NextResponse, type NextRequest } from "next/server";
import { handler } from "@/server/http";
import { hitRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { handleMercadoPagoWebhook } from "@/server/payments/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

/**
 * Notificações do gateway. A resposta 2xx só é dada depois do processamento
 * (ou quando já processado antes); em falha retornamos 5xx para o gateway
 * reenviar. A validade vem da assinatura + consulta à API do gateway.
 */
export const POST = handler(async (req: NextRequest) => {
  const rl = await hitRateLimit(`webhook:${clientIpHash(req)}`, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowSeconds);
  if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  // Notificações do Mercado Pago têm poucos KB: corpo grande é recusado.
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY) return NextResponse.json({ ok: false }, { status: 413 });
  const result = await handleMercadoPagoWebhook({
    rawBody,
    query: req.nextUrl.searchParams,
    headers: req.headers,
  });
  return NextResponse.json(result.body, { status: result.status });
});
