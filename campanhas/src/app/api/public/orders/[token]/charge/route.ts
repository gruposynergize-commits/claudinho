import { handler, ok, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { db } from "@/server/db";
import { hashAccessToken, isPlausibleToken } from "@/server/orders/access";
import { ensureChargeForOrder } from "@/server/payments/charges";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";

export const dynamic = "force-dynamic";

/** Tenta (de novo) gerar o Pix de um pedido automático — idempotente. */
export const POST = handler<RouteContext<{ token: string }>>(async (req, ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimit("order", clientIpHash(req));
  if (!isPlausibleToken(token)) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  const order = await db().order.findUnique({ where: { accessTokenHash: hashAccessToken(token) }, select: { id: true } });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  const result = await ensureChargeForOrder(order.id);
  if (!result.ready) {
    throw new AppError("GATEWAY_UNAVAILABLE", "Não conseguimos gerar o Pix agora. Seus números continuam reservados; tente novamente em instantes.");
  }
  return ok({ ready: true });
});
