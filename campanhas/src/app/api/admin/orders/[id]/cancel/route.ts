import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/guard";
import { cancelPendingOrder } from "@/server/orders/lifecycle";
import { cancelAutomaticOrder } from "@/server/payments/manual";
import { reasonSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "orders.manage");
  const { id } = await ctx.params;
  const { reason } = await parseJson(req, reasonSchema);
  const order = await db().order.findUnique({ where: { id }, select: { paymentMode: true } });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  if (order.paymentMode === "AUTOMATIC") {
    const r = await cancelAutomaticOrder(id, actor, reason);
    return ok({ result: r });
  }
  await cancelPendingOrder(id, actor, reason);
  return ok({ result: "cancelled" });
});
