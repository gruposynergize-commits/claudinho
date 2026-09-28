import { handler, ok, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { buildConfirmationMessage } from "@/server/admin/orders";

export const dynamic = "force-dynamic";

/** Mensagem pronta de confirmação para WhatsApp (sem envio automático). */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "orders.manage");
  const { id } = await ctx.params;
  return ok(await buildConfirmationMessage(id, actor));
});
