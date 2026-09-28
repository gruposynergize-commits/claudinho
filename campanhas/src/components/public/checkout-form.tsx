"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { api, safeStorage } from "@/lib/api-client";
import { useStoredValue } from "@/lib/use-stored-value";
import { formatBRL } from "@/lib/money";
import { Countdown } from "./countdown";

type ReservationView = {
  campaignSlug: string;
  numbers: string[];
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  expiresAt: string;
  usable: boolean;
  requireCpf: boolean;
  requireEmail: boolean;
};

type Fields = { name: string; phone: string; email: string; cpf: string };

function maskPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function CheckoutForm({ slug, campaignName }: { slug: string; campaignName: string }) {
  const router = useRouter();
  const id = useId();
  const [res, setRes] = useState<ReservationView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "expired">("loading");
  const [fields, setFields] = useState<Fields>({ name: "", phone: "", email: "", cpf: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // undefined = ainda hidratando; null = nenhuma reserva nesta aba.
  const token = useStoredValue("session", `res:${slug}`);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api<ReservationView>("/api/public/reservations/current", { body: { token } }).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setState("missing");
        return;
      }
      setRes(r.data);
      setState(r.data.usable ? "ready" : "expired");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);
  const view = token === null ? "missing" : state;

  function idempotencyKey(): string {
    const k = `idem:${slug}:${token ?? ""}`;
    let v = safeStorage.get("session", k);
    if (!v) {
      v = crypto.randomUUID();
      safeStorage.set("session", k, v);
    }
    return v;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    const local: Record<string, string> = {};
    if (fields.name.trim().split(/\s+/).length < 2) local["customer.name"] = "Informe nome e sobrenome.";
    if (fields.phone.replace(/\D/g, "").length < 10) local["customer.phone"] = "Informe seu WhatsApp com DDD.";
    if (res?.requireEmail && !fields.email.trim()) local["customer.email"] = "Informe seu e-mail.";
    if (res?.requireCpf && fields.cpf.replace(/\D/g, "").length !== 11) local["customer.cpf"] = "Informe seu CPF.";
    if (!acceptTerms) local.acceptTerms = "É preciso aceitar o regulamento.";
    if (!acceptPrivacy) local.acceptPrivacy = "É preciso aceitar a política de privacidade.";
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setFormError("Revise os campos destacados.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const r = await api<{ token: string; code: string; chargeReady: boolean }>("/api/public/orders", {
      body: {
        reservationToken: token,
        customer: {
          name: fields.name,
          phone: fields.phone,
          ...(fields.email.trim() ? { email: fields.email.trim() } : {}),
          ...(fields.cpf.trim() ? { cpf: fields.cpf } : {}),
        },
        acceptTerms: true,
        acceptPrivacy: true,
        idempotencyKey: idempotencyKey(),
      },
    });
    if (r.ok) {
      safeStorage.remove("session", `res:${slug}`);
      safeStorage.remove("session", `sel:${slug}`);
      const saved = JSON.parse(safeStorage.get("local", "orders") ?? "[]") as { token: string; code: string; campaign: string }[];
      safeStorage.set("local", "orders", JSON.stringify([{ token: r.data.token, code: r.data.code, campaign: campaignName }, ...saved].slice(0, 20)));
      router.replace(`/pedido/${r.data.token}`);
      return;
    }
    setSubmitting(false);
    setErrors(r.error.details?.fields ?? {});
    setFormError(r.error.message);
    if (r.error.code === "RESERVATION_EXPIRED") setState("expired");
  }

  async function backToNumbers() {
    if (token) await api("/api/public/reservations/release", { body: { token } });
    safeStorage.remove("session", `res:${slug}`);
    router.push(`/campanha/${slug}/numeros`);
  }

  if (view === "loading") {
    return <div className="mt-6 h-40 animate-pulse rounded-2xl bg-stone-200" aria-label="Carregando reserva" />;
  }
  if (view === "missing" || view === "expired" || !res) {
    return (
      <div className="card mt-6 text-center">
        <p className="font-semibold">{view === "expired" ? "Sua reserva expirou." : "Nenhuma reserva ativa encontrada."}</p>
        <p className="mt-1 text-stone-600">Os números voltaram para a disputa. Escolha novamente — eles podem ainda estar disponíveis.</p>
        <Link href={`/campanha/${slug}/numeros`} className="btn-primary mt-4 w-full">
          Escolher números
        </Link>
      </div>
    );
  }

  const field = (name: keyof Fields) => `${id}-${name}`;
  const err = (k: string) => errors[k] ?? errors[k.replace("customer.", "")];

  return (
    <form className="mt-6 space-y-6" onSubmit={(e) => void submit(e)} noValidate>
      <section className="card" aria-labelledby={`${id}-resumo`}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-resumo`} className="text-lg font-bold">Seus números</h2>
          <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
            Reservados por <Countdown until={res.expiresAt} onExpire={() => setState("expired")} />
          </p>
        </div>
        <p className="mt-3 font-mono text-lg font-bold tracking-wide">{res.numbers.join(" · ")}</p>
        <p className="mt-2 text-stone-700">
          {formatBRL(res.unitPriceCents)} × {res.quantity} = <strong>{formatBRL(res.totalCents)}</strong>
        </p>
        <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline" onClick={() => void backToNumbers()}>
          Trocar números
        </button>
      </section>

      <section className="card space-y-4" aria-labelledby={`${id}-dados`}>
        <h2 id={`${id}-dados`} className="text-lg font-bold">Seus dados</h2>
        <div>
          <label className="label" htmlFor={field("name")}>Nome completo</label>
          <input id={field("name")} className="input" autoComplete="name" value={fields.name} maxLength={100}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            aria-invalid={!!err("customer.name")} aria-describedby={err("customer.name") ? `${field("name")}-e` : undefined} />
          {err("customer.name") && <p id={`${field("name")}-e`} className="field-error">{err("customer.name")}</p>}
        </div>
        <div>
          <label className="label" htmlFor={field("phone")}>WhatsApp</label>
          <input id={field("phone")} className="input" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(41) 99999-8888"
            value={fields.phone} onChange={(e) => setFields({ ...fields, phone: maskPhone(e.target.value) })}
            aria-invalid={!!err("customer.phone")} aria-describedby={`${field("phone")}-h`} />
          <p id={`${field("phone")}-h`} className="mt-1 text-xs text-stone-500">Usado para consultar seu pedido e receber a confirmação.</p>
          {err("customer.phone") && <p className="field-error">{err("customer.phone")}</p>}
        </div>
        <div>
          <label className="label" htmlFor={field("email")}>
            E-mail {res.requireEmail ? "" : <span className="font-normal text-stone-500">(opcional)</span>}
          </label>
          <input id={field("email")} className="input" type="email" inputMode="email" autoComplete="email" value={fields.email} maxLength={254}
            onChange={(e) => setFields({ ...fields, email: e.target.value })} aria-invalid={!!err("customer.email")} />
          {res.requireEmail && <p className="mt-1 text-xs text-stone-500">Exigido pelo processador de pagamentos para gerar o Pix.</p>}
          {err("customer.email") && <p className="field-error">{err("customer.email")}</p>}
        </div>
        {res.requireCpf && (
          <div>
            <label className="label" htmlFor={field("cpf")}>CPF</label>
            <input id={field("cpf")} className="input" inputMode="numeric" value={fields.cpf}
              onChange={(e) => setFields({ ...fields, cpf: maskCpf(e.target.value) })} aria-invalid={!!err("customer.cpf")} />
            {err("customer.cpf") && <p className="field-error">{err("customer.cpf")}</p>}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-brand-600" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} aria-invalid={!!errors.acceptTerms} />
          <span>
            Li e aceito o{" "}
            <Link href={`/campanha/${slug}/regulamento`} target="_blank" className="font-semibold text-brand-700 underline">
              regulamento da campanha
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && <p className="field-error">{errors.acceptTerms}</p>}
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-brand-600" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} aria-invalid={!!errors.acceptPrivacy} />
          <span>
            Li e aceito a{" "}
            <Link href="/privacidade" target="_blank" className="font-semibold text-brand-700 underline">
              política de privacidade
            </Link>{" "}
            e o tratamento dos meus dados para esta participação.
          </span>
        </label>
        {errors.acceptPrivacy && <p className="field-error">{errors.acceptPrivacy}</p>}
      </section>

      {formError && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 font-medium text-red-800">
          {formError}
        </p>
      )}

      <button type="submit" className="btn-primary w-full text-lg" disabled={submitting}>
        {submitting ? "Gerando Pix…" : `Gerar Pix de ${formatBRL(res.totalCents)}`}
      </button>
    </form>
  );
}
