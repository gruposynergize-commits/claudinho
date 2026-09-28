import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { paymentSettingsView } from "@/server/admin/payment-settings";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { PaymentSettingsForm, StaticQrTool, type PaymentSettingsView } from "@/components/admin/payment-settings-form";

export default async function PaymentSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("settings.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const view = await paymentSettingsView(ctx.campaign.id);
  return (
    <div className="space-y-5">
      <PageTitle title="Configurações → Pagamentos → Pix" subtitle={ctx.campaign.name} />
      {view ? (
        <PaymentSettingsForm campaignId={ctx.campaign.id} view={view as PaymentSettingsView} readOnly={!ctx.can("settings.manage")} />
      ) : (
        <p className="card">Configuração de pagamento ausente.</p>
      )}
      {ctx.can("orders.manage") && <StaticQrTool campaignId={ctx.campaign.id} />}
    </div>
  );
}
