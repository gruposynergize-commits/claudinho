import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { resetUserPassword } from "@/server/admin/users";
import { passwordSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "users.manage");
  const { id } = await ctx.params;
  const { password } = await parseJson(req, passwordSchema);
  await resetUserPassword(id, password, actor);
  return ok({ saved: true });
});
