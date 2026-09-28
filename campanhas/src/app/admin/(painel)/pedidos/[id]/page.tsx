import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/server/admin/page-context";
import { getOrderDetail } from "@/server/admin/orders";
import { formatBRL } from "@/lib/money";
import { formatDateTime, formatNumber, formatPhone, maskEmail, maskPhone } from "@/lib/format";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/labels";
import { NoPermission, OrderBadge, PageTitle } from "@/components/admin/states";
import { OrderActions } from "@/components/admin/order-actions";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPage("orders.view");
  if (!ctx.allowed) return <NoPermission />;
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { order, audit } = detail;
  const pii = ctx.can("customers.viewPII");
  const digits = order.campaign.numberDigits;
  const active = order.items.filter((i) => i.active);
  const shown = active.length > 0 ? active : order.items;

  return (
    <div className="space-y-5">
      <Link href="/admin/pedidos" className="text-sm font-semibold text-brand-700">← Pedidos</Link>
      <PageTitle title={`Pedido ${order.code}`} subtitle={`${order.campaign.name} · criado em ${formatDateTime(order.createdAt)}${order.source === "ADMIN" ? ` · pelo painel (${order.createdBy?.email ?? "?"})` : ""}`}>
        <OrderBadge status={order.status} label={ORDER_STATUS_LABEL[order.status] ?? order.status} />
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card space-y-2 lg:col-span-2">
          <h2 className="font-bold">Resumo</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-stone-500">Cliente</dt><dd className="font-semibold">{order.customerName}</dd></div>
            <div><dt className="text-stone-500">WhatsApp</dt><dd className="font-semibold tabular-nums">{pii ? formatPhone(order.customerPhone) : maskPhone(order.customerPhone)}</dd></div>
            <div><dt className="text-stone-500">E-mail</dt><dd className="font-semibold">{order.customerEmail ? (pii ? order.customerEmail : maskEmail(order.customerEmail)) : "—"}</dd></div>
            <div><dt className="text-stone-500">Quantidade</dt><dd className="font-semibold">{order.quantity}</dd></div>
            <div><dt className="text-stone-500">Preço unitário</dt><dd className="font-semibold">{formatBRL(order.unitPriceCents)}</dd></div>
            <div><dt className="text-stone-500">Total</dt><dd className="text-lg font-bold">{formatBRL(order.totalCents)}</dd></div>
            <div><dt className="text-stone-500">Pagamento</dt><dd className="font-semibold">{order.paymentMode === "AUTOMATIC" ? "Pix automático (gateway)" : "Pix manual (estático)"}</dd></div>
            <div><dt className="text-stone-500">Prazo</dt><dd className="font-semibold">{formatDateTime(order.expiresAt)}</dd></div>
            <div><dt className="text-stone-500">Pago em</dt><dd className="font-semibold">{order.paidAt ? formatDateTime(order.paidAt) : "—"}</dd></div>
          </dl>
          {order.customerReportedPaidAt && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Comprador informou “Já paguei” em {formatDateTime(order.customerReportedPaidAt)}
              {order.customerPaymentNote ? ` — “${order.customerPaymentNote}”` : ""}. Isso não confirma o pagamento.
            </p>
          )}
          <div>
            <h3 className="mt-2 text-sm font-semibold text-stone-600">Números {active.length === 0 && order.items.length > 0 ? "(liberados)" : ""}</h3>
            <p className="mt-1 flex flex-wrap gap-1.5 font-mono text-sm">
              {shown.map((i) => (
                <span key={i.id} className={`rounded-md px-2 py-0.5 ${i.active ? "bg-stone-100" : "bg-stone-50 text-stone-400 line-through"}`}>
                  {formatNumber(i.number, digits)}
                </span>
              ))}
            </p>
          </div>
        </section>

        <section className="card">
          <h2 className="mb-3 font-bold">Ações</h2>
          <OrderActions
            orderId={order.id}
            status={order.status}
            paymentMode={order.paymentMode}
            totalCents={order.totalCents}
            customer={{ name: order.customerName, phone: order.customerPhone, email: order.customerEmail }}
            perms={{
              manage: ctx.can("orders.manage"),
              confirm: ctx.can("payments.confirmManual"),
              check: ctx.can("payments.check"),
              refund: ctx.can("orders.refund"),
              editPaid: ctx.can("orders.editPaid"),
            }}
          />
        </section>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-bold">Pagamentos</h2>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase text-stone-600">
            <tr>{["Gateway", "Situação", "ID no gateway", "Valor", "Pago", "Aprovado em", "Confirmação", "Pendência"].map((h) => <th key={h} className="py-1 pr-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {order.payments.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 align-top">
                <td className="py-2 pr-3">{p.gateway === "MERCADO_PAGO" ? "Mercado Pago" : "Pix estático"}</td>
                <td className="py-2 pr-3 font-semibold">{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</td>
                <td className="py-2 pr-3 font-mono text-xs">{p.gatewayPaymentId ?? "—"}</td>
                <td className="py-2 pr-3 tabular-nums">{formatBRL(p.amountCents)}</td>
                <td className="py-2 pr-3 tabular-nums">{p.paidAmountCents !== null ? formatBRL(p.paidAmountCents) : "—"}</td>
                <td className="py-2 pr-3 text-xs">{p.approvedAt ? formatDateTime(p.approvedAt) : "—"}</td>
                <td className="py-2 pr-3 text-xs">
                  {p.confirmationSource ?? "—"}
                  {p.confirmedBy && <span className="block">por {p.confirmedBy.email}</span>}
                  {p.manualReference && <span className="block">ref.: {p.manualReference}</span>}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {p.requiresAttention ? (
                    <span className={p.resolvedAt ? "text-stone-600" : "font-bold text-red-700"}>
                      {p.attentionReason}
                      {p.resolvedAt ? ` · tratada por ${p.resolvedBy?.email ?? "?"}` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-bold">Observações</h2>
          {order.notes.length === 0 ? (
            <p className="text-sm text-stone-500">Nenhuma observação.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {order.notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-stone-50 px-3 py-2">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-stone-500">{n.author.email} · {formatDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="mb-3 font-bold">Histórico</h2>
          <ol className="max-h-96 space-y-2 overflow-auto text-sm">
            {[
              ...order.paymentEvents.map((e) => ({ at: e.createdAt, text: e.type, by: e.source })),
              ...audit.map((a) => ({ at: a.createdAt, text: a.action + (a.reason ? ` — ${a.reason}` : ""), by: a.actorLabel })),
            ]
              .sort((a, b) => b.at.getTime() - a.at.getTime())
              .map((e, i) => (
                <li key={i} className="border-l-2 border-stone-200 pl-3">
                  <p className="font-medium">{e.text}</p>
                  <p className="text-xs text-stone-500">{formatDateTime(e.at)} · {e.by}</p>
                </li>
              ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
