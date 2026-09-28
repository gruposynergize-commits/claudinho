"use client";

import { useId, useState } from "react";
import { Dialog, ErrorBox, useAdminAction } from "./ui";

export function ResolvePayment({ paymentId, canMarkRefunded }: { paymentId: string; canMarkRefunded: boolean }) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [notes, setNotes] = useState("");
  const [refunded, setRefunded] = useState(false);
  return (
    <Dialog trigger="Registrar tratamento" title="Registrar tratamento da pendência">
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(`/api/admin/payments/${paymentId}/resolve`, { notes, markRefunded: refunded });
            if (ok !== null) close();
          }}
        >
          <p className="text-sm text-stone-700">
            Descreva o que foi feito (ex.: “valor devolvido via Pix em 28/09 às 15h, comprovante no drive”). Isto não confirma nenhum pedido.
          </p>
          <div>
            <label className="label" htmlFor={`${id}-n`}>Descrição do tratamento</label>
            <textarea id={`${id}-n`} className="input py-2" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} required minLength={10} />
          </div>
          {canMarkRefunded && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 accent-brand-600" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} />
              O valor foi devolvido ao pagador (marcar pagamento como reembolsado).
            </label>
          )}
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy || notes.trim().length < 10}>Registrar</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
