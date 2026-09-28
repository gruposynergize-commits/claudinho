"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

/** Só redireciona para páginas internas do painel (evita open redirect). */
function safeNext(next: string | null): string {
  if (!next || !/^\/(admin(\/[\w\-/]*)?|status)$/.test(next)) return "/admin";
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api("/api/admin/auth/login", { body: { email, password } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card mt-6 space-y-4">
      {params.get("senha") === "alterada" && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 font-medium text-green-900">
          Senha alterada. Entre novamente com a nova senha.
        </p>
      )}
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">Senha</label>
        <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 font-medium text-red-800">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
