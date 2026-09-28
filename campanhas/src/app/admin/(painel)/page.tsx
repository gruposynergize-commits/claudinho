import Link from "next/link";
import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { getDashboard } from "@/server/admin/dashboard";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { StatusBadge } from "@/components/public/status-badge";
import { DashboardCharts } from "@/components/admin/dashboard-charts";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("dashboard.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const c = ctx.campaign;
  const d = await getDashboard(c.id);

  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Números", value: c.totalNumbers.toLocaleString("pt-BR") },
    { label: "Vendidos", value: d.counts.sold.toLocaleString("pt-BR") },
    { label: "Disponíveis", value: d.counts.available.toLocaleString("pt-BR") },
    { label: "Reservados", value: d.counts.reserved.toLocaleString("pt-BR"), hint: "carrinho" },
    { label: "Aguardando pagamento", value: d.counts.pendingPayment.toLocaleString("pt-BR"), hint: "números" },
    { label: "Pagos", value: d.paidOrders.toLocaleString("pt-BR"), hint: "pedidos" },
    { label: "Pagamentos pendentes", value: d.pendingOrders.toLocaleString("pt-BR"), hint: "pedidos" },
    { label: "Compradores", value: d.buyers.toLocaleString("pt-BR") },
  ];

  return (
    <div className="space-y-6">
      <PageTitle title={c.name} subtitle={d.lastSaleAt ? `Última venda: ${formatDateTime(d.lastSaleAt)}` : "Nenhuma venda confirmada ainda"}>
        <StatusBadge status={c.status} />
        <Link href={`/campanha/${c.slug}`} className="btn-ghost min-h-10 text-sm" target="_blank">
          Ver página pública
        </Link>
      </PageTitle>

      {(d.attention > 0 || d.awaitingManualCheck > 0) && (
        <div className="space-y-2">
          {d.attention > 0 && (
            <Link href="/admin/pagamentos" className="block rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-900">
              ⚠ {d.attention} pagamento(s) exigem tratamento administrativo (valor divergente, duplicidade ou pagamento tardio).
            </Link>
          )}
          {d.awaitingManualCheck > 0 && (
            <Link href="/admin/pedidos?status=PENDING_PAYMENT" className="block rounded-xl bg-amber-50 px-4 py-3 font-semibold text-amber-900">
              ⏳ {d.awaitingManualCheck} pedido(s) com “Já paguei” aguardando conferência no Pix manual.
            </Link>
          )}
        </div>
      )}

      <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-[2fr_3fr]">
        <div className="card flex flex-col justify-center">
          <p className="text-sm font-semibold text-stone-600">Arrecadado (pedidos pagos)</p>
          <p className="text-5xl font-extrabold tracking-tight text-stone-900">{formatBRL(d.raisedCents)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="card p-4">
              <dt className="text-xs font-semibold text-stone-600">
                {t.label}
                {t.hint && <span className="font-normal text-stone-500"> · {t.hint}</span>}
              </dt>
              <dd className="mt-1 text-2xl font-bold text-stone-900">{t.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <DashboardCharts
        daily={d.daily}
        total={c.totalNumbers}
        counts={d.counts}
        pendingByAge={d.pendingByAge}
      />
    </div>
  );
}
