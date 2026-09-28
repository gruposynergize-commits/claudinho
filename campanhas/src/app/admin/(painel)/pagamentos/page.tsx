import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listAttentionPayments } from "@/server/admin/payments";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { PAYMENT_STATUS_LABEL } from "@/lib/labels";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { ResolvePayment } from "@/components/admin/resolve-payment";

const REASON: Record<string, string> = {
  PAYMENT_AMOUNT_MISMATCH: "Valor pago diferente do pedido (não confirmado)",
  DUPLICATE_PAYMENT: "Pagamento duplicado para pedido já pago",
  LATE_PAYMENT_CONFLICT: "Pagamento após expiração; números já vendidos a outra pessoa",
  PAYMENT_FOR_REFUNDED_ORDER: "Pagamento para pedido reembolsado",
  REFUNDED: "Estorno informado pelo gateway",
  CHARGED_BACK: "Contestação (chargeback) informada pelo gateway",
  REFUNDED_AFTER_FREEZE: "Estorno após congelamento do sorteio",
  CHARGED_BACK_AFTER_FREEZE: "Chargeback após congelamento do sorteio",
};

export default async function PaymentsAttentionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("orders.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const all = param(sp, "todas") === "1";
  const rows = await listAttentionPayments(ctx.campaign.id, { includeResolved: all });

  return (
    <div>
      <PageTitle title="Pagamentos com pendência" subtitle="Nada aqui confirma pedidos automaticamente: cada caso exige tratamento administrativo.">
        <Link href={all ? "/admin/pagamentos" : "/admin/pagamentos?todas=1"} className="btn-ghost min-h-10 text-sm">
          {all ? "Somente em aberto" : "Incluir tratadas"}
        </Link>
        {ctx.can("export.data") && (
          <a href={`/api/admin/campaigns/${ctx.campaign.id}/export/pagamentos`} className="btn-secondary min-h-10 text-sm">Exportar pagamentos</a>
        )}
      </PageTitle>
      {rows.length === 0 ? (
        <p className="card text-stone-600">Nenhuma pendência {all ? "" : "em aberto"}. ✓</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{REASON[p.attentionReason ?? ""] ?? p.attentionReason}</p>
                  <p className="text-sm text-stone-600">
                    Pedido <Link href={`/admin/pedidos/${p.order.id}`} className="font-mono text-brand-700 underline">{p.order.code}</Link> · {p.order.customerName}
                  </p>
                </div>
                <span className="badge bg-stone-200 text-stone-800">{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</span>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-4">
                <div><dt className="text-stone-500">Total do pedido</dt><dd className="font-semibold">{formatBRL(p.order.totalCents)}</dd></div>
                <div><dt className="text-stone-500">Valor pago</dt><dd className="font-semibold">{p.paidAmountCents !== null ? formatBRL(p.paidAmountCents) : "—"}</dd></div>
                <div><dt className="text-stone-500">ID no gateway</dt><dd className="font-mono text-xs">{p.gatewayPaymentId ?? "—"}</dd></div>
                <div><dt className="text-stone-500">Atualizado</dt><dd>{formatDateTime(p.updatedAt)}</dd></div>
              </dl>
              {p.resolvedAt ? (
                <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm">
                  Tratado por {p.resolvedBy?.email ?? "?"} em {formatDateTime(p.resolvedAt)}: {p.resolutionNotes}
                </p>
              ) : (
                ctx.can("payments.resolve") && <ResolvePayment paymentId={p.id} canMarkRefunded={p.order.paidPaymentId !== p.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
