import { handler, ok } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { getSystemStatus } from "@/server/admin/observability";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireAdmin(req, "system.view");
  return ok(await getSystemStatus());
});
