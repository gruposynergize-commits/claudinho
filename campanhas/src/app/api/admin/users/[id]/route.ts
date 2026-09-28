import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { updateUser } from "@/server/admin/users";
import { userUpdateSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "users.manage");
  const { id } = await ctx.params;
  const body = await parseJson(req, userUpdateSchema);
  await updateUser(id, body, actor);
  return ok({ saved: true });
});
