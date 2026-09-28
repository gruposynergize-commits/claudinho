import { handler, ok, parseJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { requireAdmin } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { createAdminOrder, listOrders } from "@/server/admin/orders";
import { requireCampaignById } from "@/server/admin/context";
import { adminOrderSchema } from "@/server/validation/admin";
import { formatNumber, maskEmail, maskPhone } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Lista de pedidos (VIEWER recebe telefone/e-mail mascarados). */
export const GET = handler(async (req) => {
  const { user } = await requireAdmin(req, "orders.view");
  const sp = req.nextUrl.searchParams;
  const campaign = await requireCampaignById(sp.get("campaignId") ?? "");
  const status = sp.get("status");
  const number = sp.get("number");
  const result = await listOrders(campaign.id, {
    q: sp.get("q") ?? undefined,
    phone: sp.get("phone") ?? undefined,
    code: sp.get("code") ?? undefined,
    number: number ? Number(number) : undefined,
    status: status && /^[A-Z_]+$/.test(status) ? (status as never) : undefined,
    page: Number(sp.get("page") ?? 1),
  });
  const pii = can(user.role, "customers.viewPII");
  return ok({
    total: result.total,
    page: result.page,
    rows: result.rows.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      customerName: o.customerName,
      customerPhone: pii ? o.customerPhone : maskPhone(o.customerPhone),
      customerEmail: o.customerEmail ? (pii ? o.customerEmail : maskEmail(o.customerEmail)) : null,
      numbers: o.items.filter((i) => i.active || o.status !== "PAID").map((i) => formatNumber(i.number, campaign.numberDigits)),
      quantity: o.quantity,
      totalCents: o.totalCents,
      paymentMode: o.paymentMode,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    })),
  });
});

/** "Reservar número": pedido Pix manual criado pelo painel. */
export const POST = handler(async (req) => {
  const { actor } = await requireAdmin(req, "orders.manage");
  const body = await parseJson(req, adminOrderSchema);
  const campaign = await requireCampaignById(body.campaignId);
  if (campaign.status !== "ACTIVE") throw new AppError("CAMPAIGN_NOT_ACTIVE", "As vendas desta campanha não estão abertas.");
  const order = await createAdminOrder(campaign.slug, body.numbers, body.customer, { customerAcceptedTerms: body.customerAcceptedTerms }, actor);
  return ok({ orderId: order.orderId, code: order.code }, { status: 201 });
});
