"use client";

import { useId, useState } from "react";
import { DELIVERY_STATUS_LABEL } from "@/lib/labels";
import { Dialog, ErrorBox, useAdminAction } from "./ui";

// ---------------------------------------------------------------------------
// Congelamento
// ---------------------------------------------------------------------------

export function FreezeForm({ campaignId, needsReference }: { campaignId: string; needsReference: boolean }) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [reference, setReference] = useState("");
  const [referenceAt, setReferenceAt] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(`/api/admin/campaigns/${campaignId}/draw/freeze`, {
          officialReference: reference,
          ...(needsReference ? { referenceAt } : {}),
          confirmFreeze: confirm,
        });
      }}
    >
      <div>
        <label className="label" htmlFor={`${id}-r`}>Referência oficial (definida antes do resultado)</label>
        <textarea
          id={`${id}-r`}
          className="input py-2"
          rows={2}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={needsReference ? "Ex.: Loteria Federal, extração nº 5.912 de 10/10/2026" : "Ex.: Sorteio eletrônico ao vivo em 10/10/2026 às 20h"}
          required
          minLength={5}
        />
      </div>
      {needsReference && (
        <div>
          <label className="label" htmlFor={`${id}-t`}>Data e hora do evento oficial (horário de Brasília)</label>
          <input id={`${id}-t`} className="input" type="datetime-local" value={referenceAt} onChange={(e) => setReferenceAt(e.target.value)} required />
          <p className="mt-1 text-xs text-stone-500">Precisa ser futura: a lista é publicada antes de o resultado existir. A apuração só é liberada depois deste horário.</p>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span>
          Entendo que, ao congelar, <strong>nenhuma venda, pagamento ou alteração</strong> muda mais a lista de participantes, e que a
          lista e seu hash SHA-256 ficam públicos.
        </span>
      </label>
      <ErrorBox error={error} />
      <button type="submit" className="btn-primary" disabled={busy || !confirm || reference.trim().length < 5}>
        {busy ? "Congelando…" : "Congelar vendas e publicar lista"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Apuração
// ---------------------------------------------------------------------------

type Preview = { prizePosition: number; prizeName?: string; winnerNumber: number; steps: string[] }[];

export function ExecuteForm({
  drawId,
  method,
  prizes,
  numberDigits,
}: {
  drawId: string;
  method: "FEDERAL_LOTTERY" | "VERIFIABLE_HASH" | "CSPRNG";
  prizes: { position: number; name: string }[];
  numberDigits: number;
}) {
  const { run, busy, error, setError } = useAdminAction();
  const id = useId();
  const [a, setA] = useState<string[]>(prizes.map(() => ""));
  const [b, setB] = useState<string[]>(prizes.map(() => ""));
  const [input, setInput] = useState("");
  const [inputConfirm, setInputConfirm] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const body =
    method === "FEDERAL_LOTTERY"
      ? { lotteryPrizes: a, lotteryPrizesConfirm: b }
      : method === "VERIFIABLE_HASH"
        ? { publicInput: input, publicInputConfirm: inputConfirm }
        : {};
  const pad = (n: number) => String(n).padStart(numberDigits, "0");

  const edit = (fn: () => void) => {
    fn();
    setPreview(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      {method === "FEDERAL_LOTTERY" && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm text-stone-700">
            Digite o resultado oficial da Loteria Federal <strong>duas vezes</strong> (cada coluna separadamente). Confira no site da CAIXA.
          </legend>
          {prizes.map((p, i) => (
            <div key={p.position} className="contents">
              <div>
                <label className="label" htmlFor={`${id}-a${i}`}>{i + 1}º prêmio da Loteria (para: {p.name})</label>
                <input id={`${id}-a${i}`} className="input font-mono" inputMode="numeric" autoComplete="off" value={a[i]} onChange={(e) => edit(() => setA(a.map((v, j) => (j === i ? e.target.value : v))))} />
              </div>
              <div>
                <label className="label" htmlFor={`${id}-b${i}`}>Repita o {i + 1}º prêmio</label>
                <input id={`${id}-b${i}`} className="input font-mono" inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} value={b[i]} onChange={(e) => edit(() => setB(b.map((v, j) => (j === i ? e.target.value : v))))} />
              </div>
            </div>
          ))}
        </fieldset>
      )}
      {method === "VERIFIABLE_HASH" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`${id}-i`}>Entrada pública (exatamente como anunciada)</label>
            <input id={`${id}-i`} className="input font-mono" autoComplete="off" value={input} onChange={(e) => edit(() => setInput(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-j`}>Repita a entrada pública</label>
            <input id={`${id}-j`} className="input font-mono" autoComplete="off" onPaste={(e) => e.preventDefault()} value={inputConfirm} onChange={(e) => edit(() => setInputConfirm(e.target.value))} />
          </div>
        </div>
      )}
      {method === "CSPRNG" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          O gerador criptográfico produz um resultado novo a cada execução e <strong>não pode ser refeito nem anulado</strong> depois de
          registrado. Execute uma única vez, de preferência em transmissão pública.
        </p>
      )}

      {method !== "CSPRNG" && (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            const r = await run<Preview>(`/api/admin/draws/${drawId}/preview`, body);
            if (r) setPreview(r);
          }}
        >
          Conferir cálculo (não grava nada)
        </button>
      )}

      {preview && (
        <div className="rounded-xl border border-stone-200 p-3">
          <p className="font-semibold">Pré-visualização</p>
          <ol className="mt-2 space-y-2 text-sm">
            {preview.map((r) => (
              <li key={r.prizePosition}>
                <strong>{r.prizePosition}º prêmio{r.prizeName ? ` (${r.prizeName})` : ""}:</strong> número <span className="font-mono font-bold">{pad(r.winnerNumber)}</span>
                <ul className="ml-4 list-disc text-xs text-stone-600">
                  {r.steps.map((s) => <li key={s} className="break-all">{s}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ErrorBox error={error} />

      {(method === "CSPRNG" || preview) && (
        <Dialog trigger="Registrar resultado oficial" title="Registrar a apuração?" triggerClassName="btn-primary">
          {(close) => (
            <div className="space-y-3">
              <p className="text-sm text-stone-700">
                O resultado fica gravado de forma <strong>imutável</strong> e os números contemplados passam a “sorteado”. Depois disso, só é
                possível homologar{method === "CSPRNG" ? "" : " ou anular com motivo público"}.
              </p>
              <ErrorBox error={error} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    const r = await run(`/api/admin/draws/${drawId}/execute`, { ...body, confirmExecution: true });
                    if (r !== null) close();
                  }}
                >
                  {busy ? "Registrando…" : "Registrar"}
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Homologação
// ---------------------------------------------------------------------------

export function FinalizeButton({ drawId }: { drawId: string }) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog trigger="Homologar resultado" title="Homologar o resultado do sorteio?" triggerClassName="btn-primary">
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(`/api/admin/draws/${drawId}/finalize`, { confirmFinalize: confirm, notes });
            if (r !== null) close();
          }}
        >
          <p className="text-sm text-stone-700">
            O sistema confere se cada número contemplado está na lista congelada e pertence a um pedido pago. Depois da homologação o
            resultado é definitivo, a campanha fica como “Sorteio realizado” e nada volta a ser vendido.
          </p>
          <div>
            <label className="label" htmlFor={`${id}-n`}>Observações (opcional, ficam na auditoria)</label>
            <textarea id={`${id}-n`} className="input py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>Conferi a entrada oficial e o cálculo publicado.</span>
          </label>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy || !confirm}>{busy ? "Homologando…" : "Homologar"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

const NEXT: Record<string, string[]> = {
  PENDING_CONTACT: ["CONTACTED", "FAILED"],
  CONTACTED: ["DELIVERED", "FAILED", "PENDING_CONTACT"],
  FAILED: ["CONTACTED", "PENDING_CONTACT"],
  DELIVERED: [],
};

export function DeliveryControl({ resultId, status }: { resultId: string; status: string }) {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const options = NEXT[status] ?? [];
  const [next, setNext] = useState(options[0] ?? "");
  const [notes, setNotes] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  if (options.length === 0) return null;
  return (
    <form
      className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(`/api/admin/draw-results/${resultId}/delivery`, { status: next, notes, proofUrl });
        if (r !== null) {
          setNotes("");
          setProofUrl("");
        }
      }}
    >
      <select aria-label="Nova situação da entrega" className="input min-h-10 py-1 text-sm" value={next} onChange={(e) => setNext(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{DELIVERY_STATUS_LABEL[o]}</option>)}
      </select>
      <input aria-label="Observações" id={`${id}-n`} className="input min-h-10 py-1 text-sm" placeholder="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <input aria-label="Comprovante (https://)" className="input min-h-10 py-1 text-sm" placeholder="Comprovante (https://, opcional)" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} />
      <button type="submit" className="btn-secondary min-h-10 text-sm" disabled={busy}>Salvar</button>
      <div className="sm:col-span-4"><ErrorBox error={error} /></div>
    </form>
  );
}

export function RunJobButton({ job, label }: { job: "reconcile" | "expire"; label: string }) {
  const { run, busy, error } = useAdminAction();
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary min-h-10 text-sm"
        disabled={busy}
        onClick={async () => {
          const r = await run(`/api/admin/jobs/${job}`, {});
          setDone(r !== null);
        }}
      >
        {busy ? "Executando…" : label}
      </button>
      {done && <p role="status" className="text-sm text-green-800">Concluído.</p>}
      <ErrorBox error={error} />
    </div>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      Imprimir / salvar em PDF
    </button>
  );
}
