import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { addOrderNote } from "@/server/admin/orders";
import { noteSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "orders.manage");
  const { id } = await ctx.params;
  const { body } = await parseJson(req, noteSchema);
  await addOrderNote(id, body, actor);
  return ok({ saved: true });
});
