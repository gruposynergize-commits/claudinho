import { handler, ok, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { findCampaignBySlug, getNumberStatusString, isSalesOpen } from "@/server/campaigns/queries";
import { isPubliclyVisible } from "@/server/campaigns/public";

export const dynamic = "force-dynamic";

/** Mapa compacto de estados da grade (sem dados pessoais). */
export const GET = handler<RouteContext<{ slug: string }>>(async (_req, ctx) => {
  const { slug } = await ctx.params;
  const campaign = await findCampaignBySlug(slug);
  if (!campaign || !isPubliclyVisible(campaign)) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
  const statuses = await getNumberStatusString(campaign.id);
  return ok(
    {
      firstNumber: campaign.firstNumber,
      totalNumbers: campaign.totalNumbers,
      numberDigits: campaign.numberDigits,
      statuses,
      salesOpen: isSalesOpen(campaign),
      generatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, max-age=2, s-maxage=2, stale-while-revalidate=5" } },
  );
});
