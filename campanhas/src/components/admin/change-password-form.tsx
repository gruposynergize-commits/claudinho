"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/api-client";
import { ErrorBox } from "./ui";

/** Troca da própria senha. Ao concluir, todas as sessões são encerradas. */
export function ChangePasswordForm() {
  const router = useRouter();
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    const r = await api("/api/admin/me/password", { body: { current, next } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.replace("/admin/login?senha=alterada");
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card max-w-lg space-y-4">
      <h2 className="text-lg font-bold">Trocar minha senha</h2>
      <div>
        <label className="label" htmlFor={`${id}-c`}>Senha atual</label>
        <input id={`${id}-c`} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-n`}>Nova senha</label>
        <input id={`${id}-n`} className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required aria-describedby={`${id}-h`} />
        <p id={`${id}-h`} className="mt-1 text-xs text-stone-500">Mínimo 12 caracteres, com 3 tipos (minúsculas, maiúsculas, números, símbolos).</p>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-r`}>Repita a nova senha</label>
        <input
          id={`${id}-r`}
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          aria-invalid={mismatch}
          aria-describedby={mismatch ? `${id}-m` : undefined}
        />
        {mismatch && <p id={`${id}-m`} className="field-error">As senhas não conferem.</p>}
      </div>
      <p className="text-sm text-stone-600">Depois da troca, todas as sessões abertas (inclusive esta) são encerradas e você entra de novo com a nova senha.</p>
      <ErrorBox error={error} />
      <button type="submit" className="btn-primary" disabled={busy || mismatch || !current || !next}>
        {busy ? "Salvando…" : "Trocar senha"}
      </button>
    </form>
  );
}
