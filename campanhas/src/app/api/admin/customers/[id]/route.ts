import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { updateCustomer } from "@/server/admin/customers";
import { customerUpdateSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "customers.manage");
  const { id } = await ctx.params;
  const { reason, ...data } = await parseJson(req, customerUpdateSchema);
  await updateCustomer(id, data, reason, actor);
  return ok({ saved: true });
});
