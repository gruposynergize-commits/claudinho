import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, disconnectDb } from "@/server/db";
import { reserveNumbers } from "@/server/numbers/reservations";
import { createOrderFromReservation } from "@/server/orders/create";
import { getOrderViewByToken, lookupOrderToken } from "@/server/orders/view";
import { expireManualOrders, reportPaidByCustomer } from "@/server/orders/lifecycle";
import { parseBrCode } from "@/lib/pix/brcode";
import { customerInputSchema } from "@/server/validation/customer";
import { assertGlobalInvariants, createCampaign, resetData, uniquePhone, VALID_CUSTOMER } from "../helpers/db";

beforeEach(async () => {
  await resetData();
});
afterAll(async () => {
  await disconnectDb();
});

function customer(overrides: Partial<typeof VALID_CUSTOMER> = {}) {
  return customerInputSchema.parse({ ...VALID_CUSTOMER, ...overrides });
}

async function reserveAndOrder(slug: string, numbers: number[], phone?: string) {
  const r = await reserveNumbers({ campaignSlug: slug, numbers });
  const o = await createOrderFromReservation({
    reservationToken: r.token,
    customer: customer(phone ? { phone } : {}),
    acceptTerms: true,
    acceptPrivacy: true,
    idempotencyKey: randomUUID(),
  });
  return { reservation: r, order: o };
}

describe("criação de pedido", () => {
  it("converte a reserva em pedido com preço oficial do banco", async () => {
    const c = await createCampaign({ totalNumbers: 1200, priceCents: 490 });
    const { reservation, order } = await reserveAndOrder(c.slug, [10, 345, 782]);

    expect(order.created).toBe(true);
    expect(order.code).toMatch(/^TST-\d{8}-000001$/);
    expect(order.totalCents).toBe(1470);
    expect(order.status).toBe("PENDING_PAYMENT");

    const o = await db().order.findUniqueOrThrow({ where: { id: order.orderId }, include: { items: true, payments: true } });
    expect(o.unitPriceCents).toBe(490);
    expect(o.quantity).toBe(3);
    expect(o.items.map((i) => i.number).sort((a, b) => a - b)).toEqual([10, 345, 782]);
    expect(o.customerPhone).toBe("5541999998888");
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]!.status).toBe("PENDING");
    expect(o.payments[0]!.gateway).toBe("STATIC_PIX");

    const pix = parseBrCode(o.payments[0]!.pixCopyPaste!);
    expect(pix.crcValid).toBe(true);
    expect(pix.amountCents).toBe(1470);
    expect(pix.merchantAccount.get("01")).toBe("13786508917");

    const numbers = await db().campaignNumber.findMany({ where: { campaignId: c.id, number: { in: [10, 345, 782] } } });
    expect(numbers.every((n) => n.status === "PENDING_PAYMENT" && n.orderId === order.orderId)).toBe(true);
    const res = await db().reservation.findUniqueOrThrow({ where: { id: reservation.reservationId } });
    expect(res.status).toBe("CONVERTED");
    await assertGlobalInvariants(c.id);
  });

  it("recalcula com o preço vigente no banco, não o exibido na reserva", async () => {
    const c = await createCampaign({ priceCents: 490 });
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [1, 2] });
    expect(r.totalCents).toBe(980);
    await db().campaign.update({ where: { id: c.id }, data: { priceCents: 500 } });
    const o = await createOrderFromReservation({
      reservationToken: r.token,
      customer: customer(),
      acceptTerms: true,
      acceptPrivacy: true,
      idempotencyKey: randomUUID(),
    });
    expect(o.totalCents).toBe(1000);
  });

  it("é idempotente: reenvio devolve o mesmo pedido", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [5] });
    const input = {
      reservationToken: r.token,
      customer: customer(),
      acceptTerms: true,
      acceptPrivacy: true,
      idempotencyKey: randomUUID(),
    };
    const first = await createOrderFromReservation(input);
    const again = await createOrderFromReservation(input);
    expect(again.orderId).toBe(first.orderId);
    expect(again.accessToken).toBe(first.accessToken);
    expect(again.created).toBe(false);
    expect(await db().order.count()).toBe(1);
  });

  it("cliques duplos simultâneos criam um único pedido", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [1, 2, 3] });
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        createOrderFromReservation({
          reservationToken: r.token,
          customer: customer(),
          acceptTerms: true,
          acceptPrivacy: true,
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    const ids = new Set(results.flatMap((x) => (x.status === "fulfilled" ? [x.value.orderId] : [])));
    expect(ids.size).toBe(1);
    expect(await db().order.count()).toBe(1);
    expect(await db().orderItem.count()).toBe(3);
    await assertGlobalInvariants(c.id);
  });

  it("exige aceite do regulamento e da privacidade", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [1] });
    await expect(
      createOrderFromReservation({
        reservationToken: r.token,
        customer: customer(),
        acceptTerms: false,
        acceptPrivacy: true,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejeita reserva expirada e liberada", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [1] });
    await db().$executeRaw`UPDATE campaign_numbers SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL WHERE reservation_id = ${r.reservationId}::uuid`;
    await db().$executeRaw`UPDATE reservations SET status = 'EXPIRED' WHERE id = ${r.reservationId}::uuid`;
    await expect(
      createOrderFromReservation({
        reservationToken: r.token,
        customer: customer(),
        acceptTerms: true,
        acceptPrivacy: true,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "RESERVATION_EXPIRED" });
  });

  it("respeita o limite de números por participante", async () => {
    const c = await createCampaign({ maxNumbersPerCustomer: 3 });
    await reserveAndOrder(c.slug, [1, 2]);
    await expect(reserveAndOrder(c.slug, [3, 4])).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const other = await reserveAndOrder(c.slug, [5, 6], uniquePhone());
    expect(other.order.created).toBe(true);
  });

  it("mesmo WhatsApp em compras diferentes reaproveita o cadastro", async () => {
    const c = await createCampaign();
    await reserveAndOrder(c.slug, [1]);
    await reserveAndOrder(c.slug, [2]);
    expect(await db().customer.count()).toBe(1);
    expect(await db().order.count()).toBe(2);
  });

  it("fluxo completo concorrente: 50 compradores, mesmo número → 1 pedido", async () => {
    const c = await createCampaign({ totalNumbers: 1200 });
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => reserveAndOrder(c.slug, [777], uniquePhone())),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(await db().orderItem.count({ where: { number: 777, active: true } })).toBe(1);
    expect(await db().order.count()).toBe(1);
    await assertGlobalInvariants(c.id);
  });
});

describe("acesso ao pedido e consulta", () => {
  it("visão pública não expõe telefone, e-mail nem nome completo", async () => {
    const c = await createCampaign();
    const { order } = await reserveAndOrder(c.slug, [1, 2]);
    const view = await getOrderViewByToken(order.accessToken);
    expect(view).not.toBeNull();
    expect(view!.numbers).toEqual(["0001", "0002"]);
    expect(view!.customerShortName).toBe("Maria S.");
    expect(view!.pix?.kind).toBe("STATIC");
    expect(view!.pix?.qrDataUri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("99999");
    expect(serialized).not.toContain("maria@example.com");
    expect(serialized).not.toContain("da Silva");
  });

  it("token inválido não encontra pedido", async () => {
    expect(await getOrderViewByToken("x".repeat(43))).toBeNull();
    expect(await getOrderViewByToken("curto")).toBeNull();
  });

  it("consulta exige código E WhatsApp corretos, com a mesma resposta para ambos os erros", async () => {
    const c = await createCampaign();
    const { order } = await reserveAndOrder(c.slug, [1]);
    expect(await lookupOrderToken({ code: order.code, phone: "+55 (41) 99999-8888" })).toBe(order.accessToken);
    const wrongPhone = lookupOrderToken({ code: order.code, phone: "41988887777" });
    const wrongCode = lookupOrderToken({ code: order.code.replace(/\d$/, "9"), phone: "41999998888" });
    await expect(wrongPhone).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(wrongCode).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [a, b] = await Promise.allSettled([wrongPhone, wrongCode]);
    expect((a as PromiseRejectedResult).reason.userMessage).toBe((b as PromiseRejectedResult).reason.userMessage);
  });
});

describe("Pix manual: 'Já paguei' e expiração", () => {
  it("'Já paguei' NÃO confirma o pagamento", async () => {
    const c = await createCampaign();
    const { order } = await reserveAndOrder(c.slug, [1]);
    await reportPaidByCustomer(order.accessToken, "paguei às 10h");
    const o = await db().order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(o.customerReportedPaidAt).not.toBeNull();
    const n = await db().campaignNumber.findFirstOrThrow({ where: { campaignId: c.id, number: 1 } });
    expect(n.status).toBe("PENDING_PAYMENT");
  });

  it("expira pedido manual vencido sem aviso de pagamento e devolve os números", async () => {
    const c = await createCampaign();
    const { order } = await reserveAndOrder(c.slug, [1, 2]);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.orderId}::uuid`;
    expect(await expireManualOrders()).toBe(1);
    const o = await db().order.findUniqueOrThrow({ where: { id: order.orderId }, include: { items: true, payments: true } });
    expect(o.status).toBe("EXPIRED");
    expect(o.items.every((i) => !i.active && i.releasedAt)).toBe(true);
    expect(o.payments[0]!.status).toBe("EXPIRED");
    expect(await db().campaignNumber.count({ where: { campaignId: c.id, status: "AVAILABLE" } })).toBe(50);
    await assertGlobalInvariants(c.id);
  });

  it("pedido com 'Já paguei' não expira sozinho (aguarda conferência)", async () => {
    const c = await createCampaign();
    const { order } = await reserveAndOrder(c.slug, [1]);
    await reportPaidByCustomer(order.accessToken, undefined);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${order.orderId}::uuid`;
    expect(await expireManualOrders()).toBe(0);
    const o = await db().order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(o.status).toBe("PENDING_PAYMENT");
  });
});
