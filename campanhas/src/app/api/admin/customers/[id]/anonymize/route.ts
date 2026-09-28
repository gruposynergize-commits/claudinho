import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { anonymizeCustomer } from "@/server/lgpd/retention";
import { reasonSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "lgpd.anonymize");
  const { id } = await ctx.params;
  const { reason } = await parseJson(req, reasonSchema);
  await anonymizeCustomer(id, actor, reason);
  return ok({ anonymized: true });
});
