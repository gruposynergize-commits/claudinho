import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { paymentSettingsSchema, paymentSettingsView, updatePaymentSettings } from "@/server/admin/payment-settings";

export const dynamic = "force-dynamic";

/** Nunca devolve segredos: apenas "configurado" + dica final. */
export const GET = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  await requireAdmin(req, "settings.view");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  return ok(await paymentSettingsView(campaign.id));
});

export const PUT = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "settings.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, paymentSettingsSchema);
  await updatePaymentSettings(campaign.id, body, actor);
  return ok({ saved: true });
});
