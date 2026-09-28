"use client";

import { useId, useState } from "react";
import { Dialog, ErrorBox, ReasonAction, useAdminAction } from "./ui";

export function CustomerActions({
  customerId,
  initial,
  perms,
  anonymized,
  blockers,
}: {
  customerId: string;
  initial: { name: string; phone: string; email: string };
  perms: { manage: boolean; export: boolean; anonymize: boolean };
  anonymized: boolean;
  blockers: string[];
}) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [form, setForm] = useState({ ...initial, reason: "" });
  if (anonymized) return <p className="text-sm text-stone-600">Cadastro anonimizado.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {perms.export && (
        <a className="btn-secondary" href={`/api/admin/customers/${customerId}/export`}>
          Exportar dados do titular (LGPD)
        </a>
      )}
      {perms.manage && (
        <Dialog trigger="Corrigir cadastro" title="Corrigir cadastro do comprador">
          {(close) => (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(`/api/admin/customers/${customerId}`, form);
                if (ok !== null) close();
              }}
            >
              {(["name", "phone", "email"] as const).map((k) => (
                <div key={k}>
                  <label className="label" htmlFor={`${id}-${k}`}>{k === "name" ? "Nome" : k === "phone" ? "WhatsApp" : "E-mail"}</label>
                  <input id={`${id}-${k}`} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="label" htmlFor={`${id}-r`}>Motivo (ex.: solicitação do titular)</label>
                <textarea id={`${id}-r`} className="input py-2" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={5} />
              </div>
              <p className="text-xs text-stone-500">Pedidos já existentes mantêm os dados do momento da compra; corrija-os pela tela do pedido se necessário.</p>
              <ErrorBox error={error} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={busy}>Salvar</button>
              </div>
            </form>
          )}
        </Dialog>
      )}
      {perms.anonymize && (
        <ReasonAction
          label="Anonimizar"
          title="Anonimizar dados pessoais"
          description={
            blockers.length > 0
              ? `Ainda não é possível: ${blockers.join("; ")}.`
              : "Remove nome, WhatsApp, e-mail e CPF deste titular (irreversível). Pedidos e valores são preservados para prestação de contas."
          }
          url={`/api/admin/customers/${customerId}/anonymize`}
          confirmLabel="Anonimizar"
          danger
          disabled={blockers.length > 0}
        />
      )}
    </div>
  );
}
