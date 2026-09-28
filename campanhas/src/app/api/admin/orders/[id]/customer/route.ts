import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { correctOrderCustomer } from "@/server/admin/orders";
import { correctCustomerSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

/** Correção de dados do comprador; pedido pago só por ADMIN, com motivo. */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { user, actor } = await requireAdmin(req, "orders.manage");
  const { id } = await ctx.params;
  const { reason, ...data } = await parseJson(req, correctCustomerSchema);
  await correctOrderCustomer(id, data, reason, actor, { allowPaid: can(user.role, "orders.editPaid") });
  return ok({ saved: true });
});
