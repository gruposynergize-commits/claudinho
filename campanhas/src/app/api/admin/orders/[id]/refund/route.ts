import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { refundManualOrder } from "@/server/admin/orders";
import { reasonSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "orders.refund");
  const { id } = await ctx.params;
  const { reason } = await parseJson(req, reasonSchema);
  await refundManualOrder(id, reason, actor);
  return ok({ refunded: true });
});
