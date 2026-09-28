import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db, disconnectDb } from "@/server/db";
import { ensureChargeForOrder } from "@/server/payments/charges";
import { reconcilePayments } from "@/server/payments/reconcile";
import { expireAutomaticOrders } from "@/server/payments/expire";
import { checkOrderPayment } from "@/server/payments/status-check";
import { parseBrCode } from "@/lib/pix/brcode";
import { POST as webhookRoute } from "@/app/api/webhooks/pix/route";
import type { FakeMercadoPago } from "../../dev/fake-mercadopago";
import { assertGlobalInvariants, createCampaign, resetData, withoutTriggers } from "../helpers/db";
import { createAutomaticOrder, deliverWebhook, eventsOf, orderState, startFakeGateway } from "../helpers/payments";

let fake: FakeMercadoPago;

beforeAll(async () => {
  fake = await startFakeGateway();
});
afterAll(async () => {
  await fake.stop();
  await disconnectDb();
});
beforeEach(async () => {
  await resetData();
  fake.reset();
});

async function automaticCampaign() {
  // R$ 4,90 × 10 = R$ 49,00 (cenário do requisito 49)
  return createCampaign({ mode: "AUTOMATIC", totalNumbers: 200, priceCents: 490 });
}
const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("criação da cobrança Pix", () => {
  it("cria cobrança individual com referência, valor e chave de idempotência do pedido", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, TEN);
    expect(o.gatewayPaymentId).toBeTruthy();
    const { order } = await orderState(o.orderId);
    const payment = order.payments[0]!;
    expect(payment.status).toBe("PENDING");
    expect(order.totalCents).toBe(4900);

    const remote = fake.payments.get(Number(o.gatewayPaymentId))!;
    expect(remote.transaction_amount).toBe(49);
    expect(remote.external_reference).toBe(order.code);
    expect(remote.payment_method_id).toBe("pix");
    const post = fake.requests.find((r) => r.method === "POST");
    expect(post?.idempotencyKey).toBe(`order:${order.id}:1`);

    const qr = parseBrCode(payment.pixCopyPaste!);
    expect(qr.crcValid).toBe(true);
    expect(qr.amountCents).toBe(4900);
  });

  it("repetir a criação (inclusive em paralelo) não cria duas cobranças", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [1, 2], { charge: false });
    await Promise.all(Array.from({ length: 5 }, () => ensureChargeForOrder(o.orderId)));
    await ensureChargeForOrder(o.orderId);
    await db().$executeRaw`UPDATE payments SET creation_started_at = now() - interval '1 minute' WHERE order_id = ${o.orderId}::uuid`;
    await ensureChargeForOrder(o.orderId);
    const remote = [...fake.payments.values()].filter((p) => p.external_reference === o.code);
    expect(remote).toHaveLength(1);
    const keys = new Set(fake.requests.filter((r) => r.method === "POST").map((r) => r.idempotencyKey));
    expect(keys.size).toBe(1);
    expect(await db().payment.count({ where: { orderId: o.orderId } })).toBe(1);
  });

  it("gateway fora do ar na criação: pedido segue pendente e a nova tentativa reaproveita a chave", async () => {
    const c = await automaticCampaign();
    fake.down = true;
    const o = await createAutomaticOrder(c.slug, [3]);
    expect(o.gatewayPaymentId).toBeNull();
    let s = await orderState(o.orderId);
    expect(s.order.status).toBe("PENDING_PAYMENT");
    expect(s.order.payments[0]!.status).toBe("CREATING");
    expect(s.numbers[0]!.status).toBe("PENDING_PAYMENT");

    fake.down = false;
    await db().$executeRaw`UPDATE payments SET creation_started_at = now() - interval '1 minute' WHERE order_id = ${o.orderId}::uuid`;
    expect((await ensureChargeForOrder(o.orderId)).ready).toBe(true);
    s = await orderState(o.orderId);
    expect(s.order.payments[0]!.status).toBe("PENDING");
    expect(new Set(fake.requests.filter((r) => r.method === "POST").map((r) => r.idempotencyKey)).size).toBe(1);
  });

  it("dados recusados pelo gateway (400): pedido vai para ERROR e os números voltam", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [4], { charge: false });
    await db().$executeRaw`UPDATE orders SET customer_email = NULL WHERE id = ${o.orderId}::uuid`;
    await db().$executeRaw`UPDATE customers SET email = NULL`;
    const r = await ensureChargeForOrder(o.orderId);
    expect(r.ready).toBe(false);
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("ERROR");
    expect(s.numbers[0]!.status).toBe("AVAILABLE");
  });
});

describe("webhook (requisito 49)", () => {
  it("pedido R$ 49,00 + webhook R$ 49,00 → PAID; reenviado 5 vezes → nenhuma duplicação", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, TEN);
    fake.approve(Number(o.gatewayPaymentId));

    const first = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("CONFIRMED");

    for (let i = 0; i < 5; i++) {
      const again = await deliverWebhook(fake, o.gatewayPaymentId!);
      expect(again.status).toBe(200);
    }
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("PAID");
    expect(s.order.paidPaymentId).toBe(o.paymentId);
    expect(s.numbers.every((n) => n.status === "PAID")).toBe(true);
    expect(await eventsOf(o.orderId, "PAYMENT_APPROVED")).toHaveLength(1);
    expect(await db().payment.count({ where: { orderId: o.orderId } })).toBe(1);
    await assertGlobalInvariants(c.id);
  });

  it("mesma notificação entregue 5 vezes em paralelo é processada uma única vez", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [11, 12]);
    fake.approve(Number(o.gatewayPaymentId));
    const w = fake.buildWebhook(Number(o.gatewayPaymentId));
    const { handleMercadoPagoWebhook } = await import("@/server/payments/webhook");
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        handleMercadoPagoWebhook({ rawBody: w.body, query: new URL(w.url).searchParams, headers: new Headers(w.headers) }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await eventsOf(o.orderId, "PAYMENT_APPROVED")).toHaveLength(1);
    expect((await orderState(o.orderId)).order.status).toBe("PAID");
    await assertGlobalInvariants(c.id);
  });

  it("webhook com R$ 4,90 para pedido de R$ 49,00 NÃO confirma (PAYMENT_AMOUNT_MISMATCH)", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, TEN);
    fake.approve(Number(o.gatewayPaymentId), 4.9);
    const res = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(res.body.outcome).toBe("AMOUNT_MISMATCH");
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("PENDING_PAYMENT");
    expect(s.numbers.every((n) => n.status === "PENDING_PAYMENT")).toBe(true);
    expect(s.order.payments[0]!.status).toBe("AMOUNT_MISMATCH");
    expect(s.order.payments[0]!.requiresAttention).toBe(true);
    expect(s.order.payments[0]!.paidAmountCents).toBe(490);
    expect(await eventsOf(o.orderId, "PAYMENT_AMOUNT_MISMATCH")).toHaveLength(1);
  });

  it("pagamento parcial (R$ 24,50 de R$ 49,00) não confirma", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, TEN);
    fake.approve(Number(o.gatewayPaymentId), 24.5);
    await deliverWebhook(fake, o.gatewayPaymentId!);
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");
  });

  it("webhook com assinatura inválida ou ausente é rejeitado (401) sem efeito", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [20]);
    fake.approve(Number(o.gatewayPaymentId));
    expect((await deliverWebhook(fake, o.gatewayPaymentId!, "invalid")).status).toBe(401);
    expect((await deliverWebhook(fake, o.gatewayPaymentId!, "none")).status).toBe(401);
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");
    const rejected = await db().paymentEvent.count({ where: { type: "WEBHOOK_INVALID_SIGNATURE" } });
    expect(rejected).toBe(2);
  });

  it("rota HTTP /api/webhooks/pix valida assinatura e confirma", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [21]);
    fake.approve(Number(o.gatewayPaymentId));
    const w = fake.buildWebhook(Number(o.gatewayPaymentId));
    const target = new URL(w.url);
    const url = `http://localhost:3100/api/webhooks/pix${target.search}`;
    const bad = await webhookRoute(
      new NextRequest(url, { method: "POST", headers: { ...w.headers, "x-signature": "ts=1,v1=abc" }, body: w.body }),
      { params: Promise.resolve({}) },
    );
    expect(bad.status).toBe(401);
    const good = await webhookRoute(new NextRequest(url, { method: "POST", headers: w.headers, body: w.body }), {
      params: Promise.resolve({}),
    });
    expect(good.status).toBe(200);
    expect((await orderState(o.orderId)).order.status).toBe("PAID");
  });

  it("gateway fora do ar ao receber webhook → 500 (reenvio) e a conciliação confirma depois", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [30, 31]);
    fake.approve(Number(o.gatewayPaymentId));
    fake.down = true;
    const res = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(res.status).toBe(500);
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");
    fake.down = false;
    await db().$executeRaw`UPDATE payments SET last_checked_at = NULL WHERE order_id = ${o.orderId}::uuid`;
    await reconcilePayments();
    expect((await orderState(o.orderId)).order.status).toBe("PAID");
  });

  it("pagamento de outra origem (referência desconhecida) é ignorado", async () => {
    const created = fake.createPayment(
      { transaction_amount: 10, payment_method_id: "pix", external_reference: "OUTRA-LOJA-1", payer: { email: "x@y.z" } },
      "k-externo",
    );
    fake.approve(created.payment.id);
    await createCampaign({ mode: "AUTOMATIC" });
    const res = await deliverWebhook(fake, created.payment.id);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("UNKNOWN_ORDER");
    expect(await db().order.count()).toBe(0);
  });
});

describe("recuperação (requisito 50) e cenários de erro (requisito 21)", () => {
  it("OBRIGATÓRIO: aprovado no gateway, webhook NÃO chega → conciliação confirma o pedido", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, TEN);
    fake.approve(Number(o.gatewayPaymentId)); // nenhum webhook enviado
    const summary = await reconcilePayments();
    expect(summary.confirmed).toBe(1);
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("PAID");
    expect(s.numbers.every((n) => n.status === "PAID")).toBe(true);
    expect(s.order.payments[0]!.confirmationSource).toBe("RECONCILIATION");
    await assertGlobalInvariants(c.id);
  });

  it("frontend sem atualização: a consulta da página verifica o gateway e confirma", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [40]);
    fake.approve(Number(o.gatewayPaymentId));
    expect(await checkOrderPayment(o.orderId, 0)).toBe("CONFIRMED");
    // Consultas em sequência respeitam o intervalo mínimo (não martelam o gateway).
    const before = fake.requests.length;
    await checkOrderPayment(o.orderId, 15);
    expect(fake.requests.length).toBe(before);
  });

  it("webhook atrasado depois da expiração: recupera os mesmos números se ainda livres", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [50, 51]);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${o.orderId}::uuid`;
    const exp = await expireAutomaticOrders();
    expect(exp.expired).toBe(1);
    expect(fake.payments.get(Number(o.gatewayPaymentId))!.status).toBe("cancelled");
    let s = await orderState(o.orderId);
    expect(s.order.status).toBe("EXPIRED");
    expect(s.numbers.every((n) => n.status === "AVAILABLE")).toBe(true);

    // O gateway (por corrida) ainda aprovou o pagamento depois:
    fake.setStatus(Number(o.gatewayPaymentId), "approved");
    fake.approve(Number(o.gatewayPaymentId));
    const res = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(res.body.outcome).toBe("LATE_PAYMENT_REVIVED");
    s = await orderState(o.orderId);
    expect(s.order.status).toBe("PAID");
    expect(s.numbers.every((n) => n.status === "PAID" && n.orderId === o.orderId)).toBe(true);
    await assertGlobalInvariants(c.id);
  });

  it("pagamento após expiração com número já vendido a outro: nunca toma o número (conflito para tratamento)", async () => {
    const c = await automaticCampaign();
    const a = await createAutomaticOrder(c.slug, [60]);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${a.orderId}::uuid`;
    await expireAutomaticOrders();
    const b = await createAutomaticOrder(c.slug, [60]);
    fake.approve(Number(b.gatewayPaymentId));
    await deliverWebhook(fake, b.gatewayPaymentId!);

    fake.setStatus(Number(a.gatewayPaymentId), "approved");
    fake.approve(Number(a.gatewayPaymentId));
    const res = await deliverWebhook(fake, a.gatewayPaymentId!);
    expect(res.body.outcome).toBe("LATE_PAYMENT_CONFLICT");

    const sa = await orderState(a.orderId);
    const sb = await orderState(b.orderId);
    expect(sa.order.status).toBe("EXPIRED");
    expect(sa.order.payments[0]!.requiresAttention).toBe(true);
    expect(sa.order.payments[0]!.attentionReason).toBe("LATE_PAYMENT_CONFLICT");
    expect(sb.order.status).toBe("PAID");
    expect(sb.numbers[0]!.orderId).toBe(b.orderId);
    await assertGlobalInvariants(c.id);
  });

  it("pago perto do fim do prazo: a expiração consulta o gateway e CONFIRMA em vez de liberar", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [70]);
    fake.approve(Number(o.gatewayPaymentId));
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '5 seconds' WHERE id = ${o.orderId}::uuid`;
    const summary = await expireAutomaticOrders();
    expect(summary.confirmed).toBe(1);
    expect(summary.expired).toBe(0);
    expect((await orderState(o.orderId)).order.status).toBe("PAID");
  });

  it("gateway fora do ar na expiração: números permanecem reservados", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [80]);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${o.orderId}::uuid`;
    fake.down = true;
    const summary = await expireAutomaticOrders();
    expect(summary.kept).toBe(1);
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("PENDING_PAYMENT");
    expect(s.numbers[0]!.status).toBe("PENDING_PAYMENT");
    fake.down = false;
  });

  it("cobrança expirada/cancelada no gateway libera os números imediatamente", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [90]);
    fake.setStatus(Number(o.gatewayPaymentId), "cancelled");
    const res = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(res.body.outcome).toBe("CANCELLED");
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("EXPIRED");
    expect(s.numbers[0]!.status).toBe("AVAILABLE");
  });

  it("pagamento duplicado (segunda cobrança paga para pedido já pago) é sinalizado, sem efeito duplo", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [100]);
    fake.approve(Number(o.gatewayPaymentId));
    await deliverWebhook(fake, o.gatewayPaymentId!);
    const dup = fake.createPayment(
      { transaction_amount: 4.9, payment_method_id: "pix", external_reference: o.code, payer: { email: "j@e.com" } },
      "outra-chave",
    );
    fake.approve(dup.payment.id);
    const res = await deliverWebhook(fake, dup.payment.id);
    expect(res.body.outcome).toBe("DUPLICATE_PAYMENT");
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("PAID");
    expect(s.order.paidPaymentId).toBe(o.paymentId);
    const dupLocal = s.order.payments.find((p) => p.gatewayPaymentId === String(dup.payment.id))!;
    expect(dupLocal.status).toBe("APPROVED");
    expect(dupLocal.attentionReason).toBe("DUPLICATE_PAYMENT");
    expect(await db().campaignNumber.count({ where: { orderId: o.orderId, status: "PAID" } })).toBe(1);
    await assertGlobalInvariants(c.id);
  });

  it("queda entre criar a cobrança e salvar o id: conciliação vincula a MESMA cobrança", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [110], { charge: false });
    const local = await db().payment.findFirstOrThrow({ where: { orderId: o.orderId } });
    // Simula: gateway criou (com a nossa chave), mas o id não foi salvo.
    fake.createPayment(
      { transaction_amount: 4.9, payment_method_id: "pix", external_reference: o.code, payer: { email: "j@e.com" } },
      local.idempotencyKey,
    );
    await withoutTriggers((tx) => tx.$executeRaw`UPDATE payments SET created_at = now() - interval '5 minutes' WHERE id = ${local.id}::uuid`);
    await reconcilePayments();
    const remote = [...fake.payments.values()].filter((p) => p.external_reference === o.code);
    expect(remote).toHaveLength(1);
    const after = await db().payment.findUniqueOrThrow({ where: { id: local.id } });
    expect(after.gatewayPaymentId).toBe(String(remote[0]!.id));
    expect(after.status).toBe("PENDING");
  });

  it("estorno de pedido pago: números vão para CANCELLED (nunca voltam a AVAILABLE)", async () => {
    const c = await automaticCampaign();
    const o = await createAutomaticOrder(c.slug, [120, 121]);
    fake.approve(Number(o.gatewayPaymentId));
    await deliverWebhook(fake, o.gatewayPaymentId!);
    fake.setStatus(Number(o.gatewayPaymentId), "refunded");
    const res = await deliverWebhook(fake, o.gatewayPaymentId!);
    expect(res.body.outcome).toBe("REFUNDED");
    const s = await orderState(o.orderId);
    expect(s.order.status).toBe("REFUNDED");
    expect(s.numbers.every((n) => n.status === "CANCELLED")).toBe(true);
    const audit = await db().auditLog.findFirst({ where: { action: "ORDER_REFUNDED_BY_GATEWAY" } });
    expect(audit).not.toBeNull();
  });
});
