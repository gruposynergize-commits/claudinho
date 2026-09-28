import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/server/admin/page-context";
import { getCustomerDetail } from "@/server/admin/customers";
import { anonymizationBlockers } from "@/server/lgpd/retention";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatNumber, formatPhone, maskEmail, maskPhone } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { NoPermission, OrderBadge, PageTitle } from "@/components/admin/states";
import { CustomerActions } from "@/components/admin/customer-actions";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPage("orders.view");
  if (!ctx.allowed) return <NoPermission />;
  const { id } = await params;
  const c = await getCustomerDetail(id);
  if (!c) notFound();
  const pii = ctx.can("customers.viewPII");
  const blockers = await anonymizationBlockers(c.id);

  return (
    <div className="space-y-5">
      <Link href="/admin/compradores" className="text-sm font-semibold text-brand-700">← Compradores</Link>
      <PageTitle title={c.name} subtitle={`Cadastro desde ${formatDateTime(c.createdAt)}`} />
      <section className="card space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-stone-500">WhatsApp</dt><dd className="font-semibold">{c.anonymizedAt ? "—" : pii ? formatPhone(c.phone) : maskPhone(c.phone)}</dd></div>
          <div><dt className="text-stone-500">E-mail</dt><dd className="font-semibold">{c.email ? (pii ? c.email : maskEmail(c.email)) : "—"}</dd></div>
          <div><dt className="text-stone-500">CPF</dt><dd className="font-semibold">{c.cpfEncrypted ? "informado (criptografado)" : "não coletado"}</dd></div>
        </dl>
        <CustomerActions
          customerId={c.id}
          initial={{ name: c.name, phone: c.phone, email: c.email ?? "" }}
          perms={{ manage: ctx.can("customers.manage"), export: ctx.can("export.data"), anonymize: ctx.can("lgpd.anonymize") }}
          anonymized={!!c.anonymizedAt}
          blockers={blockers}
        />
      </section>
      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-bold">Pedidos</h2>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-stone-600">
            <tr>{["Pedido", "Campanha", "Números", "Total", "Situação", "Data"].map((h) => <th key={h} className="py-1 pr-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {c.orders.map((o) => (
              <tr key={o.id} className="border-t border-stone-100">
                <td className="py-2 pr-3 font-mono"><Link href={`/admin/pedidos/${o.id}`} className="text-brand-700 underline">{o.code}</Link></td>
                <td className="py-2 pr-3">{o.campaign.name}</td>
                <td className="py-2 pr-3 font-mono text-xs">{o.items.map((i) => formatNumber(i.number, o.campaign.numberDigits)).join(" ") || "—"}</td>
                <td className="py-2 pr-3 tabular-nums">{formatBRL(o.totalCents)}</td>
                <td className="py-2 pr-3"><OrderBadge status={o.status} label={ORDER_STATUS_LABEL[o.status] ?? o.status} /></td>
                <td className="py-2 pr-3 text-xs">{formatDateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
