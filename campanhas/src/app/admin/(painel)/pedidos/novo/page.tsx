import Link from "next/link";
import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { AdminOrderForm } from "@/components/admin/admin-order-form";

export default async function NewAdminOrderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("orders.manage", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  return (
    <div>
      <Link href="/admin/pedidos" className="text-sm font-semibold text-brand-700">← Pedidos</Link>
      <PageTitle title="Reservar números para um comprador" subtitle="Atendimento por WhatsApp/presencial — gera pedido com Pix manual." />
      {ctx.campaign.status === "ACTIVE" ? (
        <AdminOrderForm campaignId={ctx.campaign.id} maxPerOrder={ctx.campaign.maxNumbersPerOrder} />
      ) : (
        <p className="card">As vendas desta campanha não estão abertas.</p>
      )}
    </div>
  );
}
