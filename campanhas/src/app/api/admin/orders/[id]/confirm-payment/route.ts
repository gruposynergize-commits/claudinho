import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { confirmManualPayment } from "@/server/payments/manual";
import { confirmPaymentSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

/** Confirmação manual (Pix estático), após conferência — AuditLog obrigatório. */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "payments.confirmManual");
  const { id } = await ctx.params;
  const body = await parseJson(req, confirmPaymentSchema);
  const result = await confirmManualPayment({ orderId: id, ...body }, actor);
  return ok(result);
});
