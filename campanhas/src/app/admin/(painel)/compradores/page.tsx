import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listCustomers } from "@/server/admin/customers";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatPhone, maskEmail, maskPhone } from "@/lib/format";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { AutoSubmitForm } from "@/components/admin/ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("orders.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const q = param(sp, "q");
  const page = Number(param(sp, "page") ?? 1) || 1;
  const { rows } = await listCustomers(ctx.campaign.id, { q, page });
  const pii = ctx.can("customers.viewPII");

  return (
    <div>
      <PageTitle title="Compradores" subtitle="Pessoas com pedidos nesta campanha.">
        {ctx.can("export.data") && (
          <a href={`/api/admin/campaigns/${ctx.campaign.id}/export/compradores`} className="btn-secondary min-h-10 text-sm">Exportar CSV</a>
        )}
      </PageTitle>
      <AutoSubmitForm className="card mb-4 flex gap-3">
        <label className="sr-only" htmlFor="q">Buscar por nome ou telefone</label>
        <input id="q" name="q" type="search" className="input" placeholder="Buscar por nome ou telefone" defaultValue={q} />
      </AutoSubmitForm>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-600">
            <tr>{["Nome", "WhatsApp", "E-mail", "Pedidos pagos", "Números", "Total pago", "Pendentes", "Último pedido"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="px-3 py-2">
                  <Link href={`/admin/compradores/${r.id}`} className="font-semibold text-brand-700 underline">{r.name}</Link>
                  {r.anonymized_at && <span className="block text-xs text-stone-500">anonimizado</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.anonymized_at ? "—" : pii ? formatPhone(r.phone) : maskPhone(r.phone)}</td>
                <td className="px-3 py-2">{r.email ? (pii ? r.email : maskEmail(r.email)) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{Number(r.paid_orders)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(r.paid_numbers)}</td>
                <td className="px-3 py-2 tabular-nums">{formatBRL(Number(r.paid_cents))}</td>
                <td className="px-3 py-2 tabular-nums">{Number(r.pending_orders)}</td>
                <td className="px-3 py-2 text-xs">{formatDateTime(r.last_order_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-500">Nenhum comprador encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-between">
        {page > 1 ? <Link className="btn-ghost" href={`?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>← Anterior</Link> : <span />}
        {rows.length === 30 && <Link className="btn-ghost" href={`?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Próxima →</Link>}
      </div>
    </div>
  );
}
