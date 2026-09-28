import { handler, ok, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { getDashboard } from "@/server/admin/dashboard";

export const dynamic = "force-dynamic";

export const GET = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  await requireAdmin(req, "dashboard.view");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  return ok(await getDashboard(campaign.id));
});
