import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { legalSchema, updateLegalInfo } from "@/server/admin/campaign-settings";

export const dynamic = "force-dynamic";

export const PUT = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "settings.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, legalSchema, { maxBytes: 300_000 });
  await updateLegalInfo(campaign.id, body, actor);
  return ok({ saved: true });
});
