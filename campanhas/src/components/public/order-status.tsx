"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { Countdown } from "./countdown";

export type OrderView = {
  code: string;
  status: string;
  campaign: { slug: string; name: string };
  customerShortName: string;
  numbers: string[];
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  paymentMode: "AUTOMATIC" | "MANUAL";
  paymentStatus: string | null;
  pix: null | { kind: "DYNAMIC" | "STATIC"; copyPaste: string; qrDataUri: string; amountCents: number; expiresAt: string | null };
  chargeMissing: boolean;
  customerReportedPaidAt: string | null;
};

export function OrderStatus({ token, initial }: { token: string; initial: OrderView }) {
  const [order, setOrder] = useState<OrderView>(initial);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const startedAt = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<OrderView>(`/api/public/orders/${token}`);
    if (r.ok) setOrder(r.data);
  }, [token]);

  // Enquanto aguarda pagamento: consulta a cada 5 s (10 s após 3 min).
  useEffect(() => {
    if (order.status !== "PENDING_PAYMENT") return;
    startedAt.current ??= Date.now();
    const interval = Date.now() - startedAt.current > 180_000 ? 10_000 : 5_000;
    const id = setTimeout(() => {
      if (document.visibilityState === "visible") void refresh();
      else setOrder((o) => ({ ...o }));
    }, interval);
    return () => clearTimeout(id);
  }, [order, refresh]);

  async function copyPix() {
    if (!order.pix) return;
    try {
      await navigator.clipboard.writeText(order.pix.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const el = document.getElementById("pix-code") as HTMLTextAreaElement | null;
      el?.select();
      setNotice({ kind: "info", text: "Selecionamos o código: use “Copiar” do seu celular." });
    }
  }

  async function retryCharge() {
    setBusy(true);
    const r = await api(`/api/public/orders/${token}/charge`, { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) setNotice({ kind: "error", text: r.error.message });
    await refresh();
  }

  async function reportPaid() {
    setBusy(true);
    const r = await api<{ message: string }>(`/api/public/orders/${token}/report-paid`, { body: {} });
    setBusy(false);
    setNotice(r.ok ? { kind: "info", text: r.data.message } : { kind: "error", text: r.error.message });
    await refresh();
  }

  async function share() {
    const url = `${window.location.origin}/campanha/${order.campaign.slug}`;
    const text = `Estou participando da ${order.campaign.name}! ❤️ Participe também:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: order.campaign.name, text, url });
        return;
      } catch {
        // cancelado pelo usuário
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener,noreferrer");
  }

  const numbersBlock = (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Seus números">
      {order.numbers.map((n) => (
        <li key={n} className="rounded-lg bg-stone-100 px-3 py-1.5 font-mono text-lg font-bold tabular-nums">
          {n}
        </li>
      ))}
    </ul>
  );

  if (order.status === "PAID") {
    return (
      <div className="space-y-5">
        <section className="card border-green-300 bg-green-50 text-center" role="status">
          <p className="text-5xl" aria-hidden>
            ❤️
          </p>
          <h1 className="mt-2 text-2xl font-extrabold text-green-900">Pagamento confirmado!</h1>
          <p className="mt-1 text-green-900">Obrigado por participar, {order.customerShortName.replace(/\.$/, "")}.</p>
        </section>
        <section className="card">
          <dl className="space-y-3">
            <div>
              <dt className="text-sm font-semibold text-stone-500">Pedido</dt>
              <dd className="font-mono text-lg font-bold">{order.code}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-stone-500">Números</dt>
              <dd>{numbersBlock}</dd>
            </div>
            <div className="flex justify-between">
              <div>
                <dt className="text-sm font-semibold text-stone-500">Valor</dt>
                <dd className="text-lg font-bold">{formatBRL(order.totalCents)}</dd>
              </div>
              <div className="text-right">
                <dt className="text-sm font-semibold text-stone-500">Data</dt>
                <dd className="text-lg font-bold">{order.paidAt ? formatDate(order.paidAt) : "—"}</dd>
              </div>
            </div>
          </dl>
          <button type="button" className="btn-primary mt-5 w-full" onClick={() => void share()}>
            Compartilhar minha participação
          </button>
          <p className="mt-3 text-center text-sm text-stone-600">Guarde este link ou consulte depois com o código do pedido e seu WhatsApp.</p>
        </section>
      </div>
    );
  }

  if (order.status !== "PENDING_PAYMENT") {
    return (
      <section className="card text-center">
        <h1 className="text-xl font-bold">Pedido {order.code}</h1>
        <p className="mt-2 inline-block rounded-full bg-stone-200 px-3 py-1 text-sm font-semibold">{ORDER_STATUS_LABEL[order.status] ?? order.status}</p>
        <p className="mt-3 text-stone-700">
          {order.status === "EXPIRED" && "O prazo para pagamento terminou e os números foram liberados."}
          {order.status === "CANCELLED" && "Este pedido foi cancelado."}
          {order.status === "REFUNDED" && "O valor deste pedido foi devolvido."}
          {order.status === "ERROR" && "Não foi possível gerar a cobrança deste pedido. Os números foram liberados."}
        </p>
        <p className="mt-2 text-sm text-stone-600">Se você realizou um pagamento, fale com a organização informando o código do pedido.</p>
        <Link href={`/campanha/${order.campaign.slug}/numeros`} className="btn-primary mt-5 w-full">
          Escolher números novamente
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-stone-500">Pedido</p>
            <h1 className="break-all font-mono text-lg font-bold">{order.code}</h1>
          </div>
          <p className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-900">Aguardando pagamento</p>
        </div>
        <div className="mt-3">{numbersBlock}</div>
      </section>

      <section className="card text-center" aria-labelledby="pix-titulo">
        <h2 id="pix-titulo" className="text-lg font-bold">Pague com Pix</h2>
        <p className="mt-1 text-3xl font-extrabold">{formatBRL(order.totalCents)}</p>
        {order.pix?.kind === "STATIC" && (
          <p className="mx-auto mt-2 max-w-sm rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">
            Pix estático — confirmação manual. Após pagar, a organização confere o recebimento.
          </p>
        )}

        {order.pix ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={order.pix.qrDataUri} alt="QR Code Pix para pagamento" width={260} height={260} className="mx-auto mt-4 size-64 rounded-xl border border-stone-200 bg-white p-2" />
            <label htmlFor="pix-code" className="mt-4 block text-sm font-semibold text-stone-700">
              Pix copia e cola
            </label>
            <textarea id="pix-code" readOnly value={order.pix.copyPaste} rows={3} className="input mt-1 resize-none py-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn-primary mt-3 w-full text-lg uppercase tracking-wide" onClick={() => void copyPix()}>
              {copied ? "Copiado! ✓" : "Copiar Pix"}
            </button>
            <p className="mt-3 text-sm text-stone-600">
              Números reservados por <Countdown until={order.expiresAt} onExpire={() => void refresh()} className="font-bold" /> · válido até {formatDateTime(order.expiresAt)}
            </p>
          </>
        ) : order.chargeMissing ? (
          <div className="mt-4 space-y-3">
            <p className="text-stone-700">Estamos gerando seu Pix. Seus números continuam reservados.</p>
            <button type="button" className="btn-primary w-full" onClick={() => void retryCharge()} disabled={busy}>
              {busy ? "Gerando…" : "Gerar Pix"}
            </button>
          </div>
        ) : (
          <p className="mt-4 text-stone-700">Não foi possível exibir o Pix agora. Atualize a página em instantes.</p>
        )}
      </section>

      <section className="card space-y-3 text-sm text-stone-700">
        <h2 className="text-base font-bold text-stone-900">Como funciona</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Abra o app do seu banco e escolha pagar com Pix (QR Code ou copia e cola).</li>
          <li>Confira o valor de {formatBRL(order.totalCents)} e confirme.</li>
          <li>
            {order.paymentMode === "AUTOMATIC"
              ? "A confirmação aparece aqui automaticamente em alguns instantes."
              : "A organização confere o recebimento e confirma seu pedido."}
          </li>
        </ol>
        <p>Comprovante ou mensagem de “paguei” não confirmam a compra: a confirmação vem do sistema de pagamentos ou da conferência oficial.</p>
        {order.paymentMode === "MANUAL" &&
          (order.customerReportedPaidAt ? (
            <p className="rounded-xl bg-stone-100 px-3 py-2 font-medium">Aviso de pagamento enviado em {formatDateTime(order.customerReportedPaidAt)}. Aguardando conferência.</p>
          ) : (
            <button type="button" className="btn-secondary w-full" onClick={() => void reportPaid()} disabled={busy}>
              Já paguei
            </button>
          ))}
        <button type="button" className="btn-ghost w-full" onClick={() => void refresh()}>
          Atualizar status
        </button>
      </section>

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 font-medium ${notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-stone-100 text-stone-800"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
