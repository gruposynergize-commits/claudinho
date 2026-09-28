import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { changeCampaignStatus } from "@/server/admin/campaign-settings";
import { statusActionSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "settings.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, statusActionSchema);
  await changeCampaignStatus(campaign.id, body.action, body, actor);
  return ok({ saved: true });
});
