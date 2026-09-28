import { z } from "zod";
import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { prizeSchema, savePrize } from "@/server/admin/campaign-settings";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ prizeId: z.uuid().nullable(), prize: prizeSchema });

export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "settings.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, bodySchema);
  await savePrize(campaign.id, body.prizeId, body.prize, actor);
  return ok({ saved: true });
});
