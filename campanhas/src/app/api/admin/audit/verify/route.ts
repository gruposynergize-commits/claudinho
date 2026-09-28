import { handler, ok } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { verifyAuditChain } from "@/server/admin/observability";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await requireAdmin(req, "audit.view");
  return ok(await verifyAuditChain());
});
