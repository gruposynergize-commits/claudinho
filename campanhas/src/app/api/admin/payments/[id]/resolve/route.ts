import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { resolveAttentionPayment } from "@/server/admin/payments";
import { resolvePaymentSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "payments.resolve");
  const { id } = await ctx.params;
  const body = await parseJson(req, resolvePaymentSchema);
  await resolveAttentionPayment(id, body, actor);
  return ok({ resolved: true });
});
