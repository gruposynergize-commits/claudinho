"use client";

import { useId, useState } from "react";
import { centsToDecimalString, formatBRL, parseBRLToCents } from "@/lib/money";
import { PRIZE_ORIGIN_LABEL } from "@/lib/labels";
import { Dialog, ErrorBox, useAdminAction } from "./ui";

export type PrizeRow = {
  id: string;
  position: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  estimatedValueCents: number | null;
  origin: string;
  originDetails: string | null;
  documentationUrl: string | null;
};

function PrizeDialog({ campaignId, prize, nextPosition }: { campaignId: string; prize: PrizeRow | null; nextPosition: number }) {
  const { run, busy, error, setError } = useAdminAction();
  const id = useId();
  const [f, setF] = useState({
    position: prize?.position ?? nextPosition,
    name: prize?.name ?? "",
    description: prize?.description ?? "",
    imageUrl: prize?.imageUrl ?? "",
    value: prize?.estimatedValueCents ? centsToDecimalString(prize.estimatedValueCents).replace(".", ",") : "",
    origin: prize?.origin ?? "NOT_INFORMED",
    originDetails: prize?.originDetails ?? "",
    documentationUrl: prize?.documentationUrl ?? "",
  });
  return (
    <Dialog trigger={prize ? "Editar" : "Adicionar prêmio"} title={prize ? `Editar ${prize.position}º prêmio` : "Novo prêmio"} triggerClassName={prize ? "btn-ghost min-h-10 text-sm" : "btn-primary"}>
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            let value: number | null = null;
            if (f.value.trim()) {
              try {
                value = parseBRLToCents(f.value);
              } catch {
                setError({ code: "VALIDATION", message: "Valor estimado inválido." });
                return;
              }
            }
            const ok = await run(`/api/admin/campaigns/${campaignId}/prizes`, {
              prizeId: prize?.id ?? null,
              prize: {
                position: f.position,
                name: f.name,
                description: f.description,
                imageUrl: f.imageUrl,
                estimatedValueCents: value,
                origin: f.origin,
                originDetails: f.originDetails,
                documentationUrl: f.documentationUrl,
              },
            });
            if (ok !== null) close();
          }}
        >
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <div>
              <label className="label" htmlFor={`${id}-p`}>Ordem</label>
              <input id={`${id}-p`} className="input" type="number" min={1} value={f.position} onChange={(e) => setF({ ...f, position: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-n`}>Nome</label>
              <input id={`${id}-n`} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`${id}-d`}>Descrição</label>
            <textarea id={`${id}-d`} className="input py-2" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-i`}>Imagem (URL https://)</label>
            <input id={`${id}-i`} className="input" type="url" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${id}-v`}>Valor estimado (opcional, R$)</label>
              <input id={`${id}-v`} className="input" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-o`}>Origem</label>
              <select id={`${id}-o`} className="input" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })}>
                {Object.entries(PRIZE_ORIGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`${id}-od`}>Detalhes da origem (ex.: doador)</label>
            <input id={`${id}-od`} className="input" value={f.originDetails} onChange={(e) => setF({ ...f, originDetails: e.target.value })} />
            <p className="mt-1 text-xs text-stone-500">Registre “Doação” somente se a doação for confirmada.</p>
          </div>
          <div>
            <label className="label" htmlFor={`${id}-doc`}>Documentação (URL https://, opcional)</label>
            <input id={`${id}-doc`} className="input" type="url" value={f.documentationUrl} onChange={(e) => setF({ ...f, documentationUrl: e.target.value })} />
          </div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy}>Salvar</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function PrizesManager({ campaignId, prizes, locked }: { campaignId: string; prizes: PrizeRow[]; locked: boolean }) {
  const del = useAdminAction();
  const next = Math.max(0, ...prizes.map((p) => p.position)) + 1;
  return (
    <div className="space-y-3">
      {locked && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">Prêmios travados: a campanha foi congelada para o sorteio.</p>}
      <ul className="space-y-3">
        {prizes.map((p) => (
          <li key={p.id} className="card flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-bold">{p.position}º — {p.name}</p>
              {p.description && <p className="text-sm text-stone-600">{p.description}</p>}
              <p className="text-xs text-stone-500">
                {PRIZE_ORIGIN_LABEL[p.origin]}
                {p.originDetails ? ` — ${p.originDetails}` : ""}
                {p.estimatedValueCents ? ` · ${formatBRL(p.estimatedValueCents)}` : ""}
              </p>
            </div>
            {!locked && (
              <div className="flex gap-2">
                <PrizeDialog campaignId={campaignId} prize={p} nextPosition={next} />
                <button
                  type="button"
                  className="btn-ghost min-h-10 text-sm text-red-700"
                  disabled={del.busy}
                  onClick={() => {
                    if (window.confirm(`Remover o prêmio “${p.name}”?`)) void del.run(`/api/admin/campaigns/${campaignId}/prizes/${p.id}`, undefined, "DELETE");
                  }}
                >
                  Remover
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={del.error} />
      {!locked && <PrizeDialog campaignId={campaignId} prize={null} nextPosition={next} />}
    </div>
  );
}
