import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listOrders } from "@/server/admin/orders";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatNumber, formatPhone, maskPhone } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { NoCampaign, NoPermission, OrderBadge, PageTitle } from "@/components/admin/states";
import { AutoSubmitForm } from "@/components/admin/ui";
import type { OrderStatus } from "@/generated/prisma/client";

const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "EXPIRED", "CANCELLED", "REFUNDED", "ERROR"];

function dateParam(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00-03:00`);
  return endOfDay ? new Date(d.getTime() + 86_400_000) : d;
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("orders.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const c = ctx.campaign;
  const status = param(sp, "status");
  const numberRaw = param(sp, "number");
  const page = Number(param(sp, "page") ?? 1) || 1;
  const filters = {
    q: param(sp, "q"),
    phone: param(sp, "phone"),
    code: param(sp, "code"),
    number: numberRaw && /^\d+$/.test(numberRaw) ? Number(numberRaw) : undefined,
    status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
    from: dateParam(param(sp, "from")),
    to: dateParam(param(sp, "to"), true),
    page,
  };
  const result = await listOrders(c.id, filters);
  const pii = ctx.can("customers.viewPII");
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page") u.set(k, v);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div>
      <PageTitle title="Pedidos" subtitle={`${result.total.toLocaleString("pt-BR")} pedido(s) encontrados`}>
        {ctx.can("orders.manage") && c.status === "ACTIVE" && (
          <Link href="/admin/pedidos/novo" className="btn-primary min-h-10 text-sm">
            Reservar números para um comprador
          </Link>
        )}
        {ctx.can("export.data") && (
          <a href={`/api/admin/campaigns/${c.id}/export/pedidos`} className="btn-secondary min-h-10 text-sm">
            Exportar CSV
          </a>
        )}
      </PageTitle>

      <AutoSubmitForm className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="f-q">Nome</label>
          <input id="f-q" name="q" type="search" className="input" defaultValue={filters.q} />
        </div>
        <div>
          <label className="label" htmlFor="f-phone">Telefone</label>
          <input id="f-phone" name="phone" type="tel" className="input" defaultValue={filters.phone} />
        </div>
        <div>
          <label className="label" htmlFor="f-code">Pedido</label>
          <input id="f-code" name="code" type="search" className="input uppercase" defaultValue={filters.code} />
        </div>
        <div>
          <label className="label" htmlFor="f-number">Número</label>
          <input id="f-number" name="number" type="search" inputMode="numeric" className="input" defaultValue={numberRaw} />
        </div>
        <div>
          <label className="label" htmlFor="f-status">Situação</label>
          <select id="f-status" name="status" className="input" defaultValue={filters.status ?? ""}>
            <option value="">Todas</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">De</label>
          <input id="f-from" name="from" type="date" className="input" defaultValue={param(sp, "from")} />
        </div>
        <div>
          <label className="label" htmlFor="f-to">Até</label>
          <input id="f-to" name="to" type="date" className="input" defaultValue={param(sp, "to")} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary min-h-12 flex-1">
            Filtrar
          </button>
          <Link href="/admin/pedidos" className="btn-ghost">
            Limpar
          </Link>
        </div>
      </AutoSubmitForm>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-600">
            <tr>
              {["Pedido", "Cliente", "WhatsApp", "Números", "Qtd", "Valor", "Status", "Pagamento", "Data"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((o) => {
              const nums = (o.items.some((i) => i.active) ? o.items.filter((i) => i.active) : o.items).map((i) => formatNumber(i.number, c.numberDigits));
              const pay = o.payments[0];
              const attention = o.payments.some((p) => p.requiresAttention && !p.resolvedAt);
              return (
                <tr key={o.id} className="border-t border-stone-100 align-top hover:bg-stone-50">
                  <td className="px-3 py-2 font-mono font-semibold">
                    <Link href={`/admin/pedidos/${o.id}`} className="text-brand-700 underline">
                      {o.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{o.customerName}</td>
                  <td className="px-3 py-2 tabular-nums">{pii ? formatPhone(o.customerPhone) : maskPhone(o.customerPhone)}</td>
                  <td className="max-w-56 px-3 py-2 font-mono text-xs">{nums.length > 8 ? `${nums.slice(0, 8).join(" ")} …` : nums.join(" ")}</td>
                  <td className="px-3 py-2 tabular-nums">{o.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(o.totalCents)}</td>
                  <td className="px-3 py-2">
                    <OrderBadge status={o.status} label={ORDER_STATUS_LABEL[o.status] ?? o.status} />
                    {o.customerReportedPaidAt && o.status === "PENDING_PAYMENT" && <p className="mt-1 text-xs font-semibold text-amber-800">“Já paguei”</p>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {o.paymentMode === "AUTOMATIC" ? "Pix automático" : "Pix manual"}
                    {pay && <span className="block text-stone-500">{pay.status}</span>}
                    {attention && <span className="block font-bold text-red-700">⚠ pendência</span>}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{formatDateTime(o.createdAt)}</td>
                </tr>
              );
            })}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-stone-500">
                  Nenhum pedido com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav aria-label="Paginação" className="mt-4 flex items-center justify-between">
          {page > 1 ? <Link className="btn-ghost" href={qs(page - 1)}>← Anterior</Link> : <span />}
          <span className="text-sm text-stone-600">
            Página {page} de {pages}
          </span>
          {page < pages ? <Link className="btn-ghost" href={qs(page + 1)}>Próxima →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
