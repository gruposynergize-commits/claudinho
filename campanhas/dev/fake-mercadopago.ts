/**
 * Simulador local da API de Pagamentos do Mercado Pago (somente testes e
 * desenvolvimento). Implementa o mesmo contrato usado pelo adaptador real:
 *
 *   POST /v1/payments              (exige Bearer e X-Idempotency-Key)
 *   GET  /v1/payments/:id
 *   GET  /v1/payments/search?external_reference=
 *   PUT  /v1/payments/:id          {"status":"cancelled"}
 *
 * Controles (para simular o comprador pagando, falhas etc.):
 *   POST /__control/payments/:id/approve   {"paidAmount"?: number, "webhook"?: "valid"|"invalid"|"none"}
 *   POST /__control/payments/:id/status    {"status": "...", "webhook"?: ...}
 *   POST /__control/payments/:id/webhook   {"signature"?: "valid"|"invalid"}
 *   POST /__control/mode                   {"down"?: boolean, "latencyMs"?: number}
 *   POST /__control/reset
 *   GET  /__control/payments
 *   GET  /__control/requests
 */
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { buildStaticPixPayload } from "../src/lib/pix/brcode";

export type FakePayment = {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  transaction_details: { total_paid_amount: number | null };
  currency_id: string;
  description: string;
  external_reference: string | null;
  notification_url: string | null;
  date_created: string;
  date_approved: string | null;
  date_of_expiration: string | null;
  payment_method_id: string;
  live_mode: boolean;
  payer: unknown;
  metadata: unknown;
  point_of_interaction: { type: string; transaction_data: { qr_code: string; qr_code_base64: string; ticket_url: string } };
};

export type FakeRequestLog = { method: string; path: string; idempotencyKey: string | null; at: string };

export type FakeMercadoPagoOptions = {
  port?: number;
  accessToken: string;
  webhookSecret: string;
  /** Para onde enviar webhooks quando a cobrança não tem notification_url. */
  defaultNotificationUrl?: string;
  log?: boolean;
};

export type WebhookRequest = { url: string; headers: Record<string, string>; body: string };

export class FakeMercadoPago {
  payments = new Map<number, FakePayment>();
  idempotency = new Map<string, number>();
  requests: FakeRequestLog[] = [];
  down = false;
  latencyMs = 0;
  private nextId = 1_000_000_001;
  private server: Server | null = null;
  url = "";

  constructor(private readonly opts: FakeMercadoPagoOptions) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        this.send(res, 500, { message: String(e) });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
    const addr = this.server.address();
    const port = typeof addr === "object" && addr ? addr.port : this.opts.port;
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  reset(): void {
    this.payments.clear();
    this.idempotency.clear();
    this.requests = [];
    this.down = false;
    this.latencyMs = 0;
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  /** Cria cobrança como o Mercado Pago faria (usado também diretamente pelos testes). */
  createPayment(body: Record<string, unknown>, idempotencyKey: string): { status: number; payment: FakePayment } {
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId !== undefined) return { status: 200, payment: this.payments.get(existingId)! };
    const amount = Number(body.transaction_amount);
    const id = this.nextId++;
    const ref = typeof body.external_reference === "string" ? body.external_reference : null;
    const qr = buildStaticPixPayload({
      keyType: "EVP",
      key: "123e4567-e12b-12d1-a456-426655440000",
      receiverName: "MERCADO PAGO SIMULADO",
      receiverCity: "OSASCO",
      amountCents: Math.round(amount * 100),
      txid: `MP${id}`,
    });
    const payment: FakePayment = {
      id,
      status: "pending",
      status_detail: "pending_waiting_transfer",
      transaction_amount: amount,
      transaction_details: { total_paid_amount: amount },
      currency_id: "BRL",
      description: String(body.description ?? ""),
      external_reference: ref,
      notification_url: typeof body.notification_url === "string" ? body.notification_url : null,
      date_created: new Date().toISOString(),
      date_approved: null,
      date_of_expiration: typeof body.date_of_expiration === "string" ? body.date_of_expiration : null,
      payment_method_id: "pix",
      live_mode: false,
      payer: body.payer ?? null,
      metadata: body.metadata ?? null,
      point_of_interaction: {
        type: "PIX",
        transaction_data: {
          qr_code: qr,
          qr_code_base64: Buffer.from("qr").toString("base64"),
          ticket_url: `https://www.mercadopago.com.br/payments/${id}/ticket?caller_id=1&hash=${randomUUID()}`,
        },
      },
    };
    this.payments.set(id, payment);
    this.idempotency.set(idempotencyKey, id);
    return { status: 201, payment };
  }

  approve(id: number, paidAmount?: number): FakePayment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`pagamento ${id} não existe`);
    p.status = "approved";
    p.status_detail = "accredited";
    p.date_approved = new Date().toISOString();
    p.transaction_details.total_paid_amount = paidAmount ?? p.transaction_amount;
    return p;
  }

  setStatus(id: number, status: string): FakePayment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`pagamento ${id} não existe`);
    p.status = status;
    p.status_detail = status;
    return p;
  }

  /** Monta a notificação exatamente como o Mercado Pago envia (assinada). */
  buildWebhook(id: number, signature: "valid" | "invalid" | "none" = "valid"): WebhookRequest {
    const p = this.payments.get(id);
    const base = p?.notification_url ?? this.opts.defaultNotificationUrl ?? "http://127.0.0.1:3000/api/webhooks/pix";
    const url = new URL(base);
    url.searchParams.set("data.id", String(id));
    url.searchParams.set("type", "payment");
    const requestId = randomUUID();
    const ts = String(Date.now());
    const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
    const secret = signature === "invalid" ? "segredo-errado" : this.opts.webhookSecret;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": requestId };
    if (signature !== "none") headers["x-signature"] = `ts=${ts},v1=${v1}`;
    const body = JSON.stringify({
      action: "payment.updated",
      api_version: "v1",
      data: { id: String(id) },
      date_created: new Date().toISOString(),
      id: randomInt(1, 2 ** 47),
      live_mode: false,
      type: "payment",
      user_id: "123456",
    });
    return { url: url.toString(), headers, body };
  }

  async deliverWebhook(id: number, signature: "valid" | "invalid" | "none" = "valid"): Promise<number> {
    const w = this.buildWebhook(id, signature);
    try {
      const res = await fetch(w.url, { method: "POST", headers: w.headers, body: w.body });
      if (this.opts.log) console.log(`[fake-mp] webhook ${id} → ${res.status}`);
      return res.status;
    } catch (e) {
      if (this.opts.log) console.log(`[fake-mp] webhook ${id} falhou: ${(e as Error).message}`);
      return 0;
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const raw = await this.readBody(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    if (path.startsWith("/__control")) return this.control(method, path, body, res);

    this.requests.push({
      method,
      path: `${path}${url.search}`,
      idempotencyKey: (req.headers["x-idempotency-key"] as string | undefined) ?? null,
      at: new Date().toISOString(),
    });
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.down) return this.send(res, 503, { message: "service unavailable", status: 503 });
    if (req.headers.authorization !== `Bearer ${this.opts.accessToken}`) {
      return this.send(res, 401, { message: "invalid access token", status: 401 });
    }

    if (method === "POST" && path === "/v1/payments") {
      const key = req.headers["x-idempotency-key"];
      if (typeof key !== "string" || !key) return this.send(res, 400, { message: "X-Idempotency-Key required", status: 400 });
      const payer = body.payer as { email?: string } | undefined;
      if (body.payment_method_id !== "pix" || !(Number(body.transaction_amount) > 0) || !payer?.email) {
        return this.send(res, 400, { message: "invalid parameters", status: 400, cause: [{ code: 4, description: "bad request" }] });
      }
      const { status, payment } = this.createPayment(body, key);
      return this.send(res, status, payment);
    }

    if (method === "GET" && path === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      const results = [...this.payments.values()].filter((p) => !ref || p.external_reference === ref).reverse();
      return this.send(res, 200, { paging: { total: results.length, limit: 30, offset: 0 }, results });
    }

    const m = /^\/v1\/payments\/(\d+)$/.exec(path);
    if (m) {
      const p = this.payments.get(Number(m[1]));
      if (!p) return this.send(res, 404, { message: "Payment not found", status: 404 });
      if (method === "GET") return this.send(res, 200, p);
      if (method === "PUT") {
        if (body.status === "cancelled") {
          if (p.status !== "pending" && p.status !== "in_process") {
            return this.send(res, 400, { message: `Payment with status ${p.status} cannot be cancelled`, status: 400 });
          }
          p.status = "cancelled";
          p.status_detail = "by_collector";
          return this.send(res, 200, p);
        }
        return this.send(res, 400, { message: "unsupported update", status: 400 });
      }
    }
    return this.send(res, 404, { message: "not found", status: 404 });
  }

  private async control(method: string, path: string, body: Record<string, unknown>, res: ServerResponse) {
    if (method === "POST" && path === "/__control/reset") {
      this.reset();
      return this.send(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/__control/mode") {
      if (typeof body.down === "boolean") this.down = body.down;
      if (typeof body.latencyMs === "number") this.latencyMs = body.latencyMs;
      return this.send(res, 200, { down: this.down, latencyMs: this.latencyMs });
    }
    if (method === "GET" && path === "/__control/payments") return this.send(res, 200, [...this.payments.values()]);
    if (method === "GET" && path === "/__control/requests") return this.send(res, 200, this.requests);

    const m = /^\/__control\/payments\/(\d+)\/(approve|status|webhook)$/.exec(path);
    if (m && method === "POST") {
      const id = Number(m[1]);
      if (!this.payments.has(id)) return this.send(res, 404, { message: "not found" });
      const mode = (body.webhook ?? body.signature ?? "valid") as "valid" | "invalid" | "none";
      if (m[2] === "approve") this.approve(id, typeof body.paidAmount === "number" ? body.paidAmount : undefined);
      if (m[2] === "status" && typeof body.status === "string") this.setStatus(id, body.status);
      // "none" em approve/status = não enviar webhook; em /webhook = enviar sem assinatura.
      const delivered = m[2] !== "webhook" && mode === "none" ? null : await this.deliverWebhook(id, mode);
      return this.send(res, 200, { payment: this.payments.get(id), webhookStatus: delivered });
    }
    return this.send(res, 404, { message: "unknown control" });
  }
}
