import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { deliverySchema, updateDelivery } from "@/server/draw/service";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ resultId: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "draw.manage");
  const { resultId } = await ctx.params;
  const body = await parseJson(req, deliverySchema);
  await updateDelivery(resultId, body, actor);
  return ok({ saved: true });
});
