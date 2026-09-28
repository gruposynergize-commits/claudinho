"use client";

import { useState } from "react";
import { CAMPAIGN_STATUS_LABEL } from "@/lib/labels";
import { Dialog, ErrorBox, ReasonAction, useAdminAction } from "./ui";

export function CampaignStatusPanel({
  campaignId,
  status,
  missing,
  declaration,
}: {
  campaignId: string;
  status: string;
  missing: string[];
  declaration: string;
}) {
  const url = `/api/admin/campaigns/${campaignId}/status`;
  const simple = useAdminAction();
  const activate = useAdminAction();
  const [declared, setDeclared] = useState(false);

  return (
    <section className="card space-y-3">
      <h2 className="font-bold">Situação: {CAMPAIGN_STATUS_LABEL[status] ?? status}</h2>
      {status === "DRAFT" && (
        <>
          {missing.length > 0 ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Antes de ativar, complete:</p>
              <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          ) : (
            <p className="text-sm text-green-800">Checklist completo. A campanha pode ser ativada.</p>
          )}
          <Dialog trigger="Ativar campanha" title="Ativar campanha (publicar e abrir vendas)" triggerClassName="btn-primary" disabled={missing.length > 0}>
            {(close) => (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await activate.run(url, { action: "activate", complianceDeclaration: declared });
                  if (ok !== null) close();
                }}
              >
                <p className="text-sm text-stone-700">
                  O software não torna uma operação legal por si só. A ativação fica registrada na auditoria com a declaração abaixo.
                </p>
                <label className="flex items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-600" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
                  {declaration}
                </label>
                <ErrorBox error={activate.error} />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
                  <button type="submit" className="btn-primary" disabled={!declared || activate.busy}>Ativar</button>
                </div>
              </form>
            )}
          </Dialog>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && (
          <button type="button" className="btn-secondary" disabled={simple.busy} onClick={() => void simple.run(url, { action: "pause" })}>
            Pausar vendas
          </button>
        )}
        {status === "PAUSED" && (
          <button type="button" className="btn-secondary" disabled={simple.busy} onClick={() => void simple.run(url, { action: "resume" })}>
            Retomar vendas
          </button>
        )}
        {(status === "ACTIVE" || status === "PAUSED") && (
          <button type="button" className="btn-secondary" disabled={simple.busy} onClick={() => void simple.run(url, { action: "close" })}>
            Encerrar vendas
          </button>
        )}
        {status === "CLOSED" && (
          <ReasonAction label="Reabrir vendas" title="Reabrir vendas" description="Volta a aceitar reservas e pedidos." url={url} extraBody={{ action: "reopen" }} confirmLabel="Reabrir" minLength={10} />
        )}
        {["DRAFT", "ACTIVE", "PAUSED", "CLOSED"].includes(status) && (
          <ReasonAction
            label="Cancelar campanha"
            title="Cancelar campanha"
            description="Só é possível sem pedidos pagos (trate reembolsos antes). A campanha deixa de receber pedidos definitivamente."
            url={url}
            extraBody={{ action: "cancel" }}
            confirmLabel="Cancelar campanha"
            danger
            minLength={10}
          />
        )}
      </div>
      <ErrorBox error={simple.error} />
      {status === "CLOSED" && <p className="text-sm text-stone-600">Próximo passo: congelar a lista e realizar o sorteio em “Sorteio”.</p>}
    </section>
  );
}
