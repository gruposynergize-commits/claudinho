"use client";

import { useId, useState } from "react";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { Dialog, ErrorBox, ReasonAction, useAdminAction } from "./ui";

type Props = {
  orderId: string;
  status: string;
  paymentMode: "AUTOMATIC" | "MANUAL";
  totalCents: number;
  customer: { name: string; phone: string; email: string | null };
  perms: { manage: boolean; confirm: boolean; check: boolean; refund: boolean; editPaid: boolean };
};

/** "Você verificou o pagamento na conta?" — Cancelar / Confirmar pagamento. */
function ConfirmPaymentDialog({ orderId, totalCents, late }: { orderId: string; totalCents: number; late: boolean }) {
  const { run, busy, error, setError } = useAdminAction();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("Pagamento identificado na conta.");
  const [verified, setVerified] = useState(false);
  return (
    <Dialog trigger="Confirmar pagamento manualmente" title="Você verificou o pagamento na conta?" triggerClassName="btn-primary">
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            let cents: number;
            try {
              cents = parseBRLToCents(amount);
            } catch {
              setError({ code: "VALIDATION", message: "Informe o valor identificado (ex.: 14,70)." });
              return;
            }
            const ok = await run(`/api/admin/orders/${orderId}/confirm-payment`, {
              verifiedAmountCents: cents,
              reference,
              reason,
              confirmedVerification: verified,
            });
            if (ok !== null) close();
          }}
        >
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Confirme somente depois de ver o crédito no extrato. Comprovante enviado pelo comprador não é suficiente. Total do pedido:{" "}
            <strong>{formatBRL(totalCents)}</strong>.
            {late && " O pedido já expirou: a confirmação só é possível se todos os números ainda estiverem livres."}
          </p>
          <div>
            <label className="label" htmlFor={`${id}-a`}>Valor identificado na conta (R$)</label>
            <input id={`${id}-a`} className="input" inputMode="decimal" placeholder="14,70" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-r`}>Referência no extrato (ID da transação, horário, nome do pagador)</label>
            <input id={`${id}-r`} className="input" value={reference} onChange={(e) => setReference(e.target.value)} required minLength={3} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-m`}>Motivo</label>
            <textarea id={`${id}-m`} className="input py-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
          </div>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-5 accent-brand-600" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            Verifiquei o pagamento na conta de recebimento.
          </label>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !verified}>
              {busy ? "Confirmando…" : "Confirmar pagamento"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function CorrectCustomerDialog({ orderId, customer, paid }: { orderId: string; customer: Props["customer"]; paid: boolean }) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email ?? "");
  const [reason, setReason] = useState("");
  return (
    <Dialog trigger="Corrigir dados" title="Corrigir dados do comprador">
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(`/api/admin/orders/${orderId}/customer`, { name, phone, email: email || null, reason });
            if (ok !== null) close();
          }}
        >
          {paid && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Pedido pago: a correção fica registrada com valores anteriores e novos.</p>}
          <div>
            <label className="label" htmlFor={`${id}-n`}>Nome completo</label>
            <input id={`${id}-n`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-p`}>WhatsApp</label>
            <input id={`${id}-p`} className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-e`}>E-mail</label>
            <input id={`${id}-e`} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-r`}>Motivo da correção</label>
            <textarea id={`${id}-r`} className="input py-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
          </div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              Salvar correção
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ConfirmationMessage({ orderId }: { orderId: string }) {
  const { run, busy, error } = useAdminAction();
  const [data, setData] = useState<{ message: string; whatsappUrl: string } | null>(null);
  return (
    <Dialog trigger="Reenviar confirmação" title="Mensagem de confirmação (WhatsApp)">
      {(close) => (
        <div className="space-y-3">
          {!data ? (
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={async () => setData(await run(`/api/admin/orders/${orderId}/confirmation`, {}))}>
              {busy ? "Gerando…" : "Gerar mensagem"}
            </button>
          ) : (
            <>
              <textarea readOnly className="input py-2 text-sm" rows={9} value={data.message} />
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => void navigator.clipboard.writeText(data.message)}>
                  Copiar
                </button>
                <a href={data.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                  Abrir no WhatsApp
                </a>
              </div>
              <p className="text-xs text-stone-500">Envio manual e individual: o sistema não dispara mensagens em massa.</p>
            </>
          )}
          <ErrorBox error={error} />
          <button type="button" className="btn-ghost w-full" onClick={close}>
            Fechar
          </button>
        </div>
      )}
    </Dialog>
  );
}

export function OrderActions(p: Props) {
  const check = useAdminAction();
  const note = useAdminAction();
  const [noteText, setNoteText] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const pending = p.status === "PENDING_PAYMENT";
  const paid = p.status === "PAID";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {p.perms.confirm && p.paymentMode === "MANUAL" && ["PENDING_PAYMENT", "EXPIRED", "CANCELLED"].includes(p.status) && (
          <ConfirmPaymentDialog orderId={p.orderId} totalCents={p.totalCents} late={!pending} />
        )}
        {p.perms.check && p.paymentMode === "AUTOMATIC" && pending && (
          <button
            type="button"
            className="btn-secondary"
            disabled={check.busy}
            onClick={async () => {
              const r = await check.run<{ outcome: string }>(`/api/admin/orders/${p.orderId}/check`, {});
              if (r) setCheckResult(r.outcome);
            }}
          >
            {check.busy ? "Consultando…" : "Verificar no gateway agora"}
          </button>
        )}
        {p.perms.manage && pending && (
          <ReasonAction
            label="Cancelar pedido"
            title="Cancelar pedido"
            description={
              p.paymentMode === "AUTOMATIC"
                ? "A cobrança será cancelada no gateway antes de liberar os números. Se já estiver paga, o pedido será confirmado."
                : "Os números voltarão a ficar disponíveis. Confirme que não há pagamento a conferir."
            }
            url={`/api/admin/orders/${p.orderId}/cancel`}
            confirmLabel="Cancelar pedido"
            danger
          />
        )}
        {p.perms.manage && (!paid || p.perms.editPaid) && <CorrectCustomerDialog orderId={p.orderId} customer={p.customer} paid={paid} />}
        {p.perms.manage && paid && <ConfirmationMessage orderId={p.orderId} />}
        {p.perms.refund && paid && p.paymentMode === "MANUAL" && (
          <ReasonAction
            label="Registrar reembolso"
            title="Registrar reembolso"
            description="Use somente após devolver o valor ao comprador. Os números ficarão indisponíveis (não voltam automaticamente para venda)."
            url={`/api/admin/orders/${p.orderId}/refund`}
            confirmLabel="Registrar reembolso"
            danger
            minLength={10}
          />
        )}
      </div>
      {checkResult && <p className="text-sm text-stone-700">Resultado da verificação: <strong>{checkResult}</strong></p>}
      <ErrorBox error={check.error} />

      {p.perms.manage && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await note.run(`/api/admin/orders/${p.orderId}/notes`, { body: noteText });
            if (ok !== null) setNoteText("");
          }}
        >
          <label className="label" htmlFor="note">Adicionar observação</label>
          <textarea id="note" className="input py-2" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={2000} />
          <ErrorBox error={note.error} />
          <button type="submit" className="btn-secondary" disabled={note.busy || noteText.trim().length < 2}>
            Salvar observação
          </button>
        </form>
      )}
    </div>
  );
}
