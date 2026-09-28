import { handler, ok, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { checkOrderPayment } from "@/server/payments/status-check";

export const dynamic = "force-dynamic";

/** "Verificar no gateway agora" (Pix automático). */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  await requireAdmin(req, "payments.check");
  const { id } = await ctx.params;
  const outcome = await checkOrderPayment(id, 0);
  return ok({ outcome });
});
