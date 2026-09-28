"use client";

import { useState } from "react";
import { ErrorBox, useAdminAction } from "./ui";

export function AuditVerify() {
  const { run, busy, error } = useAdminAction();
  const [result, setResult] = useState<{ ok: boolean; checked: number; firstBrokenId: string | null } | null>(null);
  return (
    <div className="space-y-2">
      <button type="button" className="btn-secondary min-h-10 text-sm" disabled={busy} onClick={async () => setResult(await run("/api/admin/audit/verify", {}))}>
        {busy ? "Verificando…" : "Verificar integridade da auditoria"}
      </button>
      {result && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm font-semibold ${result.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
          {result.ok
            ? `Cadeia íntegra: ${result.checked} registros verificados.`
            : `ATENÇÃO: cadeia quebrada no registro #${result.firstBrokenId} (possível adulteração direta no banco).`}
        </p>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
