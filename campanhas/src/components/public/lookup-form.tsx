"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, safeStorage } from "@/lib/api-client";

type Saved = { token: string; code: string; campaign: string };

export function LookupForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);

  useEffect(() => {
    try {
      setSaved(JSON.parse(safeStorage.get("local", "orders") ?? "[]") as Saved[]);
    } catch {
      setSaved([]);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api<{ token: string }>("/api/public/lookup", { body: { code: code.trim(), phone } });
    setBusy(false);
    if (r.ok) router.push(`/pedido/${r.data.token}`);
    else setError(r.error.message);
  }

  return (
    <div className="space-y-6">
      <form className="card space-y-4" onSubmit={(e) => void submit(e)}>
        <div>
          <label className="label" htmlFor="code">Código do pedido</label>
          <input id="code" className="input font-mono uppercase" placeholder="ALEK-20260928-000001" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} />
        </div>
        <div>
          <label className="label" htmlFor="phone">WhatsApp usado na compra</label>
          <input id="phone" className="input" type="tel" inputMode="tel" placeholder="(41) 99999-8888" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={30} />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 font-medium text-red-800">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Consultando…" : "Consultar"}
        </button>
        <p className="text-xs text-stone-500">Por segurança, mostramos apenas o pedido que corresponde ao código e ao WhatsApp informados.</p>
      </form>

      {saved.length > 0 && (
        <section className="card">
          <h2 className="font-bold">Pedidos feitos neste aparelho</h2>
          <ul className="mt-2 divide-y divide-stone-200">
            {saved.map((s) => (
              <li key={s.token}>
                <Link href={`/pedido/${s.token}`} className="flex min-h-12 items-center justify-between gap-3 py-2 font-medium text-brand-700">
                  <span className="font-mono">{s.code}</span>
                  <span className="text-sm text-stone-500">{s.campaign}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
