import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listNumbers } from "@/server/admin/numbers";
import { formatDateTime, formatNumber } from "@/lib/format";
import { NUMBER_STATUS_LABEL } from "@/lib/labels";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { AutoSubmitForm } from "@/components/admin/ui";
import { NumberActions } from "@/components/admin/number-actions";
import type { NumberStatus } from "@/generated/prisma/client";

const STATUSES: NumberStatus[] = ["AVAILABLE", "RESERVED", "PENDING_PAYMENT", "PAID", "CANCELLED", "DRAWN", "WINNER"];
const COLOR: Record<string, string> = {
  AVAILABLE: "bg-green-50 text-green-900",
  RESERVED: "bg-amber-100 text-amber-900",
  PENDING_PAYMENT: "bg-blue-100 text-blue-900",
  PAID: "bg-red-100 text-red-900",
  CANCELLED: "bg-stone-200 text-stone-700",
  DRAWN: "bg-violet-100 text-violet-900",
  WINNER: "bg-brand-100 text-brand-800",
};
const PAGE = 100;

export default async function NumbersAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("orders.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const c = ctx.campaign;
  const status = STATUSES.find((s) => s === param(sp, "status"));
  const pages = Math.ceil(c.totalNumbers / PAGE);
  const pageIdx = Math.min(Math.max(Number(param(sp, "faixa") ?? 0) || 0, 0), pages - 1);
  const from = status ? c.firstNumber : c.firstNumber + pageIdx * PAGE;
  const to = status ? c.firstNumber + c.totalNumbers - 1 : Math.min(from + PAGE - 1, c.firstNumber + c.totalNumbers - 1);
  const rows = await listNumbers(c.id, { status, from, to });
  const fmt = (n: number) => formatNumber(n, c.numberDigits);

  return (
    <div>
      <PageTitle title="Números" subtitle="Estados controlados pelo sistema; exceções exigem motivo e ficam na auditoria.">
        {ctx.can("export.data") && (
          <a href={`/api/admin/campaigns/${c.id}/export/numeros`} className="btn-secondary min-h-10 text-sm">Exportar CSV</a>
        )}
      </PageTitle>
      <AutoSubmitForm className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="st">Situação</label>
          <select id="st" name="status" className="input w-auto" defaultValue={status ?? ""}>
            <option value="">Todas (por faixa)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{NUMBER_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        {!status && (
          <div>
            <label className="label" htmlFor="fx">Faixa</label>
            <select id="fx" name="faixa" className="input w-auto" defaultValue={String(pageIdx)}>
              {Array.from({ length: pages }, (_, i) => (
                <option key={i} value={i}>
                  {fmt(c.firstNumber + i * PAGE)}–{fmt(Math.min(c.firstNumber + (i + 1) * PAGE - 1, c.firstNumber + c.totalNumbers - 1))}
                </option>
              ))}
            </select>
          </div>
        )}
        <noscript><button type="submit" className="btn-primary">Filtrar</button></noscript>
      </AutoSubmitForm>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-600">
            <tr>{["Número", "Situação", "Pedido", "Comprador", "Reservado até", "Ações"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} className="border-t border-stone-100">
                <td className="px-3 py-2 font-mono font-bold">{fmt(r.number)}</td>
                <td className="px-3 py-2">
                  <span className={`badge ${COLOR[r.status]}`}>{NUMBER_STATUS_LABEL[r.status]}</span>
                  {r.blocked_reason && <span className="block text-xs text-stone-500">{r.blocked_reason}</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.order_id ? <Link href={`/admin/pedidos/${r.order_id}`} className="text-brand-700 underline">{r.order_code}</Link> : "—"}
                </td>
                <td className="px-3 py-2">{r.customer_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.reserved_until ? formatDateTime(r.reserved_until) : "—"}</td>
                <td className="px-3 py-2">
                  <NumberActions
                    campaignId={c.id}
                    number={r.number}
                    label={fmt(r.number)}
                    status={r.status}
                    canManage={ctx.can("numbers.manage")}
                    canExceptional={ctx.can("numbers.exceptional")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
