import { handler, ok, parseJson } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { changeOwnPassword } from "@/server/admin/users";
import { changeOwnPasswordSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { user, actor } = await requireAdmin(req, "dashboard.view");
  const body = await parseJson(req, changeOwnPasswordSchema);
  await changeOwnPassword(user.id, body.current, body.next, actor);
  return ok({ changed: true });
});
