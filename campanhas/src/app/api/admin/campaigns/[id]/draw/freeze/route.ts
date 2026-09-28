import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { freezeAndSnapshot, freezeSchema } from "@/server/draw/service";

export const dynamic = "force-dynamic";

/** Congela as vendas e publica o snapshot (lista elegível + SHA-256). */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "draw.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, freezeSchema);
  return ok(await freezeAndSnapshot(campaign.id, body, actor), { status: 201 });
});
