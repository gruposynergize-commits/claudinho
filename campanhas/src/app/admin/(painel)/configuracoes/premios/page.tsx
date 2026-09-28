import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { db } from "@/server/db";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { PrizesManager } from "@/components/admin/prizes-manager";

export default async function PrizesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("settings.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const prizes = await db().prize.findMany({ where: { campaignId: ctx.campaign.id, deletedAt: null }, orderBy: { position: "asc" } });
  const locked = ctx.campaign.status === "FROZEN" || ctx.campaign.status === "DRAWN" || !ctx.can("settings.manage");
  return (
    <div>
      <PageTitle title="Configurações → Prêmios" subtitle={ctx.campaign.name} />
      <PrizesManager
        campaignId={ctx.campaign.id}
        locked={locked}
        prizes={prizes.map((p) => ({
          id: p.id,
          position: p.position,
          name: p.name,
          description: p.description,
          imageUrl: p.imageUrl,
          estimatedValueCents: p.estimatedValueCents,
          origin: p.origin,
          originDetails: p.originDetails,
          documentationUrl: p.documentationUrl,
        }))}
      />
    </div>
  );
}
