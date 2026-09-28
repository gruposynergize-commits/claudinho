import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { activationChecklist, COMPLIANCE_DECLARATION } from "@/server/admin/campaign-settings";
import { db } from "@/server/db";
import { formatDateTime } from "@/lib/format";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { CampaignForm, type CampaignFormData } from "@/components/admin/campaign-form";
import { CampaignStatusPanel } from "@/components/admin/campaign-status-panel";

function faqOf(v: unknown): { q: string; a: string }[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x.q === "string" && typeof x.a === "string") : [];
}

export default async function CampaignSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("settings.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const c = ctx.campaign;
  const hasOrders = (await db().order.count({ where: { campaignId: c.id } })) > 0;
  const missing = c.status === "DRAFT" ? await activationChecklist(c.id) : [];
  const canManage = ctx.can("settings.manage");
  const params = (c.drawMethodParams ?? null) as CampaignFormData["drawMethodParams"];

  const data: CampaignFormData = {
    id: c.id,
    version: c.version,
    hasOrders,
    locked: c.status === "FROZEN" || c.status === "DRAWN",
    name: c.name,
    shortDescription: c.shortDescription,
    story: c.story,
    imageUrl: c.imageUrl,
    priceCents: c.priceCents,
    totalNumbers: c.totalNumbers,
    numberDigits: c.numberDigits,
    minNumbersPerOrder: c.minNumbersPerOrder,
    maxNumbersPerOrder: c.maxNumbersPerOrder,
    maxNumbersPerCustomer: c.maxNumbersPerCustomer,
    reservationMinutes: c.reservationMinutes,
    paymentMinutes: c.paymentMinutes,
    requireCpf: c.requireCpf,
    requireEmail: c.requireEmail,
    salesStartAt: c.salesStartAt?.toISOString() ?? null,
    salesEndAt: c.salesEndAt?.toISOString() ?? null,
    drawScheduledAt: c.drawScheduledAt?.toISOString() ?? null,
    drawMethod: c.drawMethod,
    drawMethodParams: params,
    contactWhatsapp: c.contactWhatsapp,
    contactEmail: c.contactEmail,
    contactInstagram: c.contactInstagram,
    faq: faqOf(c.faq),
    confirmationMessage: c.confirmationMessage,
    orderCodePrefix: c.orderCodePrefix,
  };

  return (
    <div className="space-y-5">
      <PageTitle
        title="Configurações → Campanha"
        subtitle={c.complianceConfirmedAt ? `Conformidade declarada em ${formatDateTime(c.complianceConfirmedAt)}` : "Conformidade ainda não declarada"}
      />
      {canManage ? (
        <>
          <CampaignStatusPanel campaignId={c.id} status={c.status} missing={missing} declaration={COMPLIANCE_DECLARATION} />
          <CampaignForm initial={data} />
        </>
      ) : (
        <p className="card text-stone-600">Somente administradores alteram a campanha.</p>
      )}
    </div>
  );
}
