import { handler, ok, parseJson } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { createUser, createUserSchema, listUsers } from "@/server/admin/users";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireAdmin(req, "users.manage");
  return ok(await listUsers());
});

export const POST = handler(async (req) => {
  const { actor } = await requireAdmin(req, "users.manage");
  const body = await parseJson(req, createUserSchema);
  await createUser(body, actor);
  return ok({ created: true }, { status: 201 });
});
