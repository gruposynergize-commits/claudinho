import { handler, ok, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { deletePrize } from "@/server/admin/campaign-settings";

export const dynamic = "force-dynamic";

export const DELETE = handler<RouteContext<{ id: string; prizeId: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "settings.manage");
  const { id, prizeId } = await ctx.params;
  const campaign = await requireCampaignById(id);
  await deletePrize(campaign.id, prizeId, actor);
  return ok({ removed: true });
});
