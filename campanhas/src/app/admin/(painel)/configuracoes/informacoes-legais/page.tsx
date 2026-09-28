import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { db } from "@/server/db";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { LegalForm } from "@/components/admin/legal-form";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function LegalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("settings.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const l = await db().legalInformation.findUnique({ where: { campaignId: ctx.campaign.id } });
  return (
    <div>
      <PageTitle title="Configurações → Informações legais" subtitle={ctx.campaign.name} />
      <LegalForm
        campaignId={ctx.campaign.id}
        readOnly={!ctx.can("settings.manage")}
        initial={{
          operatorName: l?.operatorName ?? "",
          entityName: l?.entityName ?? "",
          cnpj: l?.cnpj ?? "",
          authorizationNumber: l?.authorizationNumber ?? "",
          regulation: l?.regulation ?? "",
          regulationUrl: l?.regulationUrl ?? "",
          startDate: iso(l?.startDate),
          endDate: iso(l?.endDate),
          modality: l?.modality ?? "",
          officialDrawMethod: l?.officialDrawMethod ?? "",
          additionalInfo: l?.additionalInfo ?? "",
          privacyContact: l?.privacyContact ?? "",
          showOnPublicPage: l?.showOnPublicPage ?? true,
        }}
      />
    </div>
  );
}
