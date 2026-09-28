import { randomUUID } from "node:crypto";
import { FakeMercadoPago } from "../../dev/fake-mercadopago";
import { resetEnvCache } from "@/server/env";
import { db } from "@/server/db";
import { reserveNumbers } from "@/server/numbers/reservations";
import { createOrderFromReservation } from "@/server/orders/create";
import { ensureChargeForOrder } from "@/server/payments/charges";
import { handleMercadoPagoWebhook } from "@/server/payments/webhook";
import { customerInputSchema } from "@/server/validation/customer";
import { TEST_GATEWAY_TOKEN, TEST_WEBHOOK_SECRET, uniquePhone } from "./db";

export async function startFakeGateway(): Promise<FakeMercadoPago> {
  const fake = new FakeMercadoPago({ accessToken: TEST_GATEWAY_TOKEN, webhookSecret: TEST_WEBHOOK_SECRET });
  const url = await fake.start();
  process.env.MERCADOPAGO_API_BASE_URL = url;
  resetEnvCache();
  return fake;
}

export async function createAutomaticOrder(slug: string, numbers: number[], opts: { phone?: string; charge?: boolean } = {}) {
  const r = await reserveNumbers({ campaignSlug: slug, numbers });
  const order = await createOrderFromReservation({
    reservationToken: r.token,
    customer: customerInputSchema.parse({
      name: "João Pereira",
      phone: opts.phone ?? uniquePhone(),
      email: "joao@example.com",
    }),
    acceptTerms: true,
    acceptPrivacy: true,
    idempotencyKey: randomUUID(),
  });
  if (opts.charge !== false) await ensureChargeForOrder(order.orderId);
  const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.orderId }, orderBy: { createdAt: "asc" } });
  return { ...order, paymentId: payment.id, gatewayPaymentId: payment.gatewayPaymentId };
}

/** Entrega ao handler uma notificação montada como o Mercado Pago faria. */
export async function deliverWebhook(fake: FakeMercadoPago, gatewayPaymentId: string | number, signature: "valid" | "invalid" | "none" = "valid") {
  const w = fake.buildWebhook(Number(gatewayPaymentId), signature);
  const url = new URL(w.url);
  return handleMercadoPagoWebhook({ rawBody: w.body, query: url.searchParams, headers: new Headers(w.headers) });
}

export async function orderState(orderId: string) {
  const order = await db().order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { orderBy: { createdAt: "asc" } }, items: true },
  });
  const numbers = await db().campaignNumber.findMany({
    where: { id: { in: order.items.map((i) => i.campaignNumberId) } },
    orderBy: { number: "asc" },
  });
  return { order, numbers };
}

export async function eventsOf(orderId: string, type?: string) {
  return db().paymentEvent.findMany({ where: { orderId, ...(type ? { type } : {}) }, orderBy: { createdAt: "asc" } });
}
