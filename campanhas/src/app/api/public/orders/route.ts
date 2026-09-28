import { handler, ok, parseJson } from "@/server/http";
import { createOrderFromReservation } from "@/server/orders/create";
import { ensureChargeForOrder } from "@/server/payments/charges";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { createOrderBodySchema } from "@/server/validation/public";

export const dynamic = "force-dynamic";

/**
 * Cria o pedido a partir da reserva. O navegador envia SOMENTE o token da
 * reserva e os dados do comprador — nunca preço, quantidade ou status.
 */
export const POST = handler(async (req) => {
  const ipHash = clientIpHash(req);
  await enforceRateLimit("order", ipHash);
  const body = await parseJson(req, createOrderBodySchema);
  const order = await createOrderFromReservation({ ...body, ipHash });
  let chargeReady = order.paymentMode === "MANUAL";
  if (order.paymentMode === "AUTOMATIC") {
    // Falha aqui não perde o pedido: a página do pedido permite tentar de novo
    // (mesma chave de idempotência) e a conciliação também repete.
    chargeReady = await ensureChargeForOrder(order.orderId).then(
      (r) => r.ready,
      () => false,
    );
  }
  return ok({ token: order.accessToken, code: order.code, chargeReady }, { status: order.created ? 201 : 200 });
});
