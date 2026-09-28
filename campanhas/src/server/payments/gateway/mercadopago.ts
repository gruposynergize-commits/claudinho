import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { centsToGatewayAmount, gatewayAmountToCents } from "@/lib/money";
import {
  GatewayError,
  type CreatePixChargeInput,
  type GatewayPayment,
  type GatewayStatus,
  type PixGatewayClient,
} from "./types";

/**
 * Adaptador da API de Pagamentos do Mercado Pago.
 *
 * Contrato conferido no SDK oficial `mercadopago` (v3.6.1, npm), que é a
 * implementação de referência mantida pelo Mercado Pago:
 *  - POST /v1/payments        (criação; header X-Idempotency-Key)
 *  - GET  /v1/payments/{id}   (consulta)
 *  - GET  /v1/payments/search?external_reference=… (busca)
 *  - PUT  /v1/payments/{id}  {"status":"cancelled"} (cancelamento de pendente)
 *  - Webhook: header x-signature "ts=…,v1=…" = HMAC-SHA256 do manifesto
 *    "id:{data.id};request-id:{x-request-id};ts:{ts};" (partes ausentes omitidas)
 * Ver docs/GATEWAY-MERCADOPAGO.md.
 */

const TIMEOUT_MS = 10_000;

type MpPayment = {
  id?: number | string;
  status?: string;
  status_detail?: string | null;
  external_reference?: string | null;
  transaction_amount?: number | string;
  transaction_details?: { total_paid_amount?: number | string | null } | null;
  currency_id?: string | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  payment_method_id?: string | null;
  live_mode?: boolean | null;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string | null; ticket_url?: string | null } | null;
  } | null;
};

export function normalizeMpStatus(status: string | undefined): GatewayStatus {
  switch (status) {
    case "approved":
      return "APPROVED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    case "refunded":
      return "REFUNDED";
    case "charged_back":
      return "CHARGED_BACK";
    // pending, in_process, authorized, in_mediation e desconhecidos: ainda não pago.
    default:
      return "PENDING";
  }
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapMpPayment(p: MpPayment): GatewayPayment {
  if (p.id === undefined || p.id === null || p.transaction_amount === undefined) {
    throw new GatewayError("invalid_response", "resposta do Mercado Pago sem id/valor");
  }
  const amountCents = gatewayAmountToCents(p.transaction_amount);
  const paidRaw = p.transaction_details?.total_paid_amount;
  return {
    id: String(p.id),
    status: normalizeMpStatus(p.status),
    rawStatus: p.status ?? "unknown",
    statusDetail: p.status_detail ?? null,
    externalReference: p.external_reference ?? null,
    amountCents,
    paidAmountCents: paidRaw === undefined || paidRaw === null ? null : gatewayAmountToCents(paidRaw),
    currency: p.currency_id ?? null,
    approvedAt: parseDate(p.date_approved),
    expiresAt: parseDate(p.date_of_expiration),
    qrCode: p.point_of_interaction?.transaction_data?.qr_code ?? null,
    ticketUrl: p.point_of_interaction?.transaction_data?.ticket_url ?? null,
    paymentMethodId: p.payment_method_id ?? null,
    liveMode: p.live_mode ?? null,
  };
}

/** Data com fuso explícito de Brasília, formato aceito pela API (ISO 8601). */
export function formatMpDate(d: Date): string {
  const shifted = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 23)}-03:00`;
}

export class MercadoPagoClient implements PixGatewayClient {
  readonly name = "MERCADO_PAGO" as const;

  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["x-idempotency-key"] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      throw new GatewayError(aborted ? "timeout" : "network", aborted ? "tempo esgotado no Mercado Pago" : "falha de rede com o Mercado Pago", { cause: e });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new GatewayError("http", `Mercado Pago respondeu ${res.status}`, {
        httpStatus: res.status,
        responseSnippet: text.slice(0, 500),
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new GatewayError("invalid_response", "resposta inválida do Mercado Pago", { cause: e, responseSnippet: text.slice(0, 200) });
    }
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<GatewayPayment> {
    const body = {
      transaction_amount: centsToGatewayAmount(input.amountCents),
      description: input.description.slice(0, 250),
      payment_method_id: "pix",
      external_reference: input.externalReference,
      date_of_expiration: formatMpDate(input.expiresAt),
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      payer: {
        email: input.payer.email,
        first_name: input.payer.firstName,
        last_name: input.payer.lastName,
        ...(input.payer.cpf ? { identification: { type: "CPF", number: input.payer.cpf } } : {}),
      },
    };
    const raw = await this.request<MpPayment>("POST", "v1/payments", { body, idempotencyKey: input.idempotencyKey });
    return mapMpPayment(raw);
  }

  async getPayment(id: string): Promise<GatewayPayment> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new GatewayError("invalid_response", "id de pagamento inválido");
    return mapMpPayment(await this.request<MpPayment>("GET", `v1/payments/${encodeURIComponent(id)}`));
  }

  async searchByExternalReference(externalReference: string): Promise<GatewayPayment[]> {
    const raw = await this.request<{ results?: MpPayment[] }>("GET", "v1/payments/search", {
      query: { external_reference: externalReference, sort: "date_created", criteria: "desc", limit: "30" },
    });
    return (raw.results ?? []).map(mapMpPayment).filter((p) => p.externalReference === externalReference);
  }

  async cancelPayment(id: string, idempotencyKey: string): Promise<GatewayPayment> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new GatewayError("invalid_response", "id de pagamento inválido");
    const raw = await this.request<MpPayment>("PUT", `v1/payments/${encodeURIComponent(id)}`, {
      body: { status: "cancelled" },
      idempotencyKey,
    });
    return mapMpPayment(raw);
  }
}

// ---------------------------------------------------------------------------
// Assinatura do webhook (mesma regra do WebhookSignatureValidator oficial)
// ---------------------------------------------------------------------------

export type SignatureCheck =
  | { valid: true; ts: string }
  | { valid: false; reason: "missing_header" | "malformed" | "missing_ts" | "missing_hash" | "mismatch" };

function parseSignatureHeader(header: string): { ts?: string; hashes: Record<string, string> } {
  const hashes: Record<string, string> = {};
  let ts: string | undefined;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (!key || !value) continue;
    if (key === "ts") ts = value;
    else if (/^v\d+$/.test(key)) hashes[key] = value;
  }
  return { ts, hashes };
}

export function buildSignatureManifest(dataId: string | null, requestId: string | null, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(";")};`;
}

export function signManifest(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function constantTimeHexEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Valida o header x-signature. `dataId` vem do query param `data.id`.
 * Para ids alfanuméricos, a documentação orienta usar minúsculas; tentamos o
 * valor recebido e, se diferente, a versão em minúsculas.
 */
export function verifyMercadoPagoSignature(opts: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): SignatureCheck {
  const header = opts.xSignature?.trim();
  if (!header) return { valid: false, reason: "missing_header" };
  const { ts, hashes } = parseSignatureHeader(header);
  if (!ts && Object.keys(hashes).length === 0) return { valid: false, reason: "malformed" };
  if (!ts) return { valid: false, reason: "missing_ts" };
  if (!/^\d+$/.test(ts)) return { valid: false, reason: "malformed" };
  const received = hashes.v1;
  if (!received) return { valid: false, reason: "missing_hash" };

  const requestId = opts.xRequestId?.trim() || null;
  const candidates = new Set<string | null>([opts.dataId?.trim() || null]);
  if (opts.dataId && opts.dataId !== opts.dataId.toLowerCase()) candidates.add(opts.dataId.trim().toLowerCase());
  for (const dataId of candidates) {
    const expected = signManifest(opts.secret, buildSignatureManifest(dataId, requestId, ts));
    if (constantTimeHexEquals(expected, received.toLowerCase())) return { valid: true, ts };
  }
  return { valid: false, reason: "mismatch" };
}
