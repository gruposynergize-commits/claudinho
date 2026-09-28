"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorBox, useAdminAction } from "./ui";

const JOBS = [
  { job: "expire", label: "Expirar reservas e pedidos vencidos", hint: "Consulta o gateway antes de liberar qualquer número." },
  { job: "reconcile", label: "Conciliar pagamentos agora", hint: "Busca no gateway pagamentos cujo webhook não chegou." },
  { job: "cleanup", label: "Limpeza e retenção (LGPD)", hint: "Sessões vencidas, logs antigos e anonimização por prazo." },
] as const;

/** Execução manual das rotinas (as mesmas do worker/cron, com lease no banco). */
export function JobRunner() {
  const { run, busy, error } = useAdminAction();
  const [result, setResult] = useState<{ job: string; data: unknown } | null>(null);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {JOBS.map((j) => (
          <li key={j.job} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 p-3">
            <div>
              <p className="font-semibold">{j.label}</p>
              <p className="text-xs text-stone-500">{j.hint}</p>
            </div>
            <button
              type="button"
              className="btn-secondary min-h-10 text-sm"
              disabled={busy}
              onClick={async () => {
                const data = await run(`/api/admin/jobs/${j.job}`, {});
                if (data !== null) setResult({ job: j.job, data });
              }}
            >
              Executar
            </button>
          </li>
        ))}
      </ul>
      {result && (
        <div role="status" className="rounded-xl bg-stone-50 p-3 text-sm">
          <p className="font-semibold">Resultado — {result.job}</p>
          <pre className="mt-1 max-h-60 overflow-auto text-[11px]">{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

export function RefreshButton() {
  const router = useRouter();
  return (
    <button type="button" className="btn-secondary min-h-10 text-sm" onClick={() => router.refresh()}>
      Atualizar
    </button>
  );
}
