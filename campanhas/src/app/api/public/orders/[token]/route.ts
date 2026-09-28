import { handler, ok, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { getOrderViewByToken } from "@/server/orders/view";
import { refreshOrderPaymentIfStale } from "@/server/payments/status-check";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";

export const dynamic = "force-dynamic";

/** Estado do pedido (consultado periodicamente pela página do pedido). */
export const GET = handler<RouteContext<{ token: string }>>(async (req, ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimit("orderStatus", clientIpHash(req));
  // Se o webhook atrasar, a própria consulta verifica o gateway (com limite de frequência).
  await refreshOrderPaymentIfStale(token);
  const view = await getOrderViewByToken(token);
  if (!view) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  return ok(view);
});
