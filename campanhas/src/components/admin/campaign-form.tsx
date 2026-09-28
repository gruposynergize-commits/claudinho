"use client";

import { useState } from "react";
import { centsToDecimalString, parseBRLToCents } from "@/lib/money";
import { ErrorBox, useAdminAction } from "./ui";

export type CampaignFormData = {
  id: string;
  version: number;
  hasOrders: boolean;
  locked: boolean;
  name: string;
  shortDescription: string | null;
  story: string;
  imageUrl: string | null;
  priceCents: number;
  totalNumbers: number;
  numberDigits: number;
  minNumbersPerOrder: number;
  maxNumbersPerOrder: number;
  maxNumbersPerCustomer: number | null;
  reservationMinutes: number;
  paymentMinutes: number;
  requireCpf: boolean;
  requireEmail: boolean;
  salesStartAt: string | null;
  salesEndAt: string | null;
  drawScheduledAt: string | null;
  drawMethod: "FEDERAL_LOTTERY" | "VERIFIABLE_HASH" | "CSPRNG" | null;
  drawMethodParams: { digits?: number; unsoldRule?: "NEXT_HIGHER" | "NEXT_LOWER" } | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  contactInstagram: string | null;
  faq: { q: string; a: string }[];
  confirmationMessage: string | null;
  orderCodePrefix: string;
};

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  return v ? new Date(v).toISOString() : "";
}

export function CampaignForm({ initial }: { initial: CampaignFormData }) {
  const { run, busy, error, setError } = useAdminAction();
  const [f, setF] = useState(initial);
  const [price, setPrice] = useState(centsToDecimalString(initial.priceCents).replace(".", ","));
  const [confirmCritical, setConfirmCritical] = useState(false);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof CampaignFormData>(k: K, v: CampaignFormData[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)));

  let priceCents = initial.priceCents;
  try {
    priceCents = parseBRLToCents(price);
  } catch {
    // validado no envio
  }
  const critical = initial.hasOrders && (priceCents !== initial.priceCents || f.totalNumbers < initial.totalNumbers);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    let cents: number;
    try {
      cents = parseBRLToCents(price);
    } catch {
      setError({ code: "VALIDATION", message: "Preço inválido (ex.: 4,90)." });
      return;
    }
    const ok = await run(`/api/admin/campaigns/${f.id}`, {
      version: f.version,
      name: f.name,
      shortDescription: f.shortDescription ?? "",
      story: f.story,
      imageUrl: f.imageUrl ?? "",
      priceCents: cents,
      totalNumbers: f.totalNumbers,
      numberDigits: f.numberDigits,
      minNumbersPerOrder: f.minNumbersPerOrder,
      maxNumbersPerOrder: f.maxNumbersPerOrder,
      maxNumbersPerCustomer: f.maxNumbersPerCustomer,
      reservationMinutes: f.reservationMinutes,
      paymentMinutes: f.paymentMinutes,
      requireCpf: f.requireCpf,
      requireEmail: f.requireEmail,
      salesStartAt: f.salesStartAt ?? "",
      salesEndAt: f.salesEndAt ?? "",
      drawScheduledAt: f.drawScheduledAt ?? "",
      drawMethod: f.drawMethod,
      drawMethodParams: f.drawMethod === "FEDERAL_LOTTERY" ? { digits: f.drawMethodParams?.digits ?? 4, unsoldRule: f.drawMethodParams?.unsoldRule ?? "NEXT_HIGHER" } : null,
      contactWhatsapp: f.contactWhatsapp ?? "",
      contactEmail: f.contactEmail ?? "",
      contactInstagram: f.contactInstagram ?? "",
      faq: f.faq.filter((x) => x.q.trim() && x.a.trim()),
      confirmationMessage: f.confirmationMessage ?? "",
      orderCodePrefix: f.orderCodePrefix,
      ...(critical ? { confirmCritical, reason } : {}),
    }, "PUT");
    if (ok !== null) {
      setSaved(true);
      setF((prev) => ({ ...prev, version: prev.version + 1 }));
    }
  }

  const input = (label: string, k: keyof CampaignFormData, type = "text", extra: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`cf-${String(k)}`}>{label}</label>
      <input
        id={`cf-${String(k)}`}
        className="input"
        type={type}
        value={(f[k] as string | number | null) ?? ""}
        onChange={(e) => set(k, (type === "number" ? num(e.target.value) : e.target.value) as never)}
        {...extra}
      />
    </div>
  );

  return (
    <form className="space-y-5" onSubmit={(e) => void submit(e)}>
      {f.locked && (
        <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
          Campanha congelada/sorteada: preço, quantidade e método do sorteio não podem mais ser alterados.
        </p>
      )}
      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">Apresentação</h2>
        {input("Nome", "name")}
        {input("Descrição curta", "shortDescription")}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="cf-story">História</label>
          <textarea id="cf-story" className="input py-2" rows={6} value={f.story} onChange={(e) => set("story", e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">Texto simples; linhas em branco separam parágrafos.</p>
        </div>
        {input("Imagem (URL https://)", "imageUrl", "url")}
        {input("Prefixo do pedido", "orderCodePrefix", "text", { disabled: initial.hasOrders })}
      </section>

      <section className="card grid gap-4 sm:grid-cols-3">
        <h2 className="font-bold sm:col-span-3">Números, preço e limites</h2>
        <div>
          <label className="label" htmlFor="cf-price">Preço por número (R$)</label>
          <input id="cf-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={f.locked} />
        </div>
        {input("Quantidade de números", "totalNumbers", "number", { min: 1, disabled: f.locked })}
        {input("Dígitos exibidos", "numberDigits", "number", { min: 1, max: 7, disabled: f.locked })}
        {input("Mínimo por pedido", "minNumbersPerOrder", "number", { min: 1 })}
        {input("Máximo por pedido", "maxNumbersPerOrder", "number", { min: 1 })}
        <div>
          <label className="label" htmlFor="cf-mpc">Máximo por comprador (vazio = sem limite)</label>
          <input id="cf-mpc" className="input" type="number" min={1} value={f.maxNumbersPerCustomer ?? ""} onChange={(e) => set("maxNumbersPerCustomer", e.target.value === "" ? null : num(e.target.value))} />
        </div>
        {input("Reserva do carrinho (min)", "reservationMinutes", "number", { min: 1 })}
        {input("Prazo de pagamento (min)", "paymentMinutes", "number", { min: 1 })}
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-5 accent-brand-600" checked={f.requireCpf} onChange={(e) => set("requireCpf", e.target.checked)} /> Exigir CPF</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-5 accent-brand-600" checked={f.requireEmail} onChange={(e) => set("requireEmail", e.target.checked)} /> Exigir e-mail</label>
        </div>
      </section>

      <section className="card grid gap-4 sm:grid-cols-3">
        <h2 className="font-bold sm:col-span-3">Datas e sorteio</h2>
        {(["salesStartAt", "salesEndAt", "drawScheduledAt"] as const).map((k) => (
          <div key={k}>
            <label className="label" htmlFor={`cf-${k}`}>{k === "salesStartAt" ? "Início das vendas" : k === "salesEndAt" ? "Fim das vendas" : "Data prevista do sorteio"}</label>
            <input id={`cf-${k}`} className="input" type="datetime-local" value={toLocalInput(f[k])} onChange={(e) => set(k, fromLocalInput(e.target.value) || null)} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="cf-dm">Método do sorteio no sistema (deve corresponder ao regulamento)</label>
          <select id="cf-dm" className="input" value={f.drawMethod ?? ""} disabled={f.locked} onChange={(e) => set("drawMethod", (e.target.value || null) as CampaignFormData["drawMethod"])}>
            <option value="">— selecione —</option>
            <option value="FEDERAL_LOTTERY">Loteria Federal (derivação documentada)</option>
            <option value="VERIFIABLE_HASH">Hash verificável com referência pública</option>
            <option value="CSPRNG">Gerador criptográfico do servidor</option>
          </select>
        </div>
        {f.drawMethod === "FEDERAL_LOTTERY" && (
          <>
            <div>
              <label className="label" htmlFor="cf-dig">Dígitos finais do prêmio usados</label>
              <input id="cf-dig" className="input" type="number" min={1} max={6} disabled={f.locked} value={f.drawMethodParams?.digits ?? 4} onChange={(e) => set("drawMethodParams", { ...f.drawMethodParams, digits: num(e.target.value) })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="cf-unsold">Se o número derivado não estiver pago</label>
              <select id="cf-unsold" className="input" disabled={f.locked} value={f.drawMethodParams?.unsoldRule ?? "NEXT_HIGHER"} onChange={(e) => set("drawMethodParams", { ...f.drawMethodParams, unsoldRule: e.target.value as "NEXT_HIGHER" | "NEXT_LOWER" })}>
                <option value="NEXT_HIGHER">Próximo número pago acima (circular)</option>
                <option value="NEXT_LOWER">Próximo número pago abaixo (circular)</option>
              </select>
            </div>
          </>
        )}
      </section>

      <section className="card grid gap-4 sm:grid-cols-3">
        <h2 className="font-bold sm:col-span-3">Contato e comunicação</h2>
        {input("WhatsApp da organização", "contactWhatsapp")}
        {input("E-mail de contato", "contactEmail", "email")}
        {input("Instagram", "contactInstagram")}
        <div className="sm:col-span-3">
          <label className="label" htmlFor="cf-msg">Mensagem de confirmação (WhatsApp)</label>
          <textarea id="cf-msg" className="input py-2 font-mono text-sm" rows={6} value={f.confirmationMessage ?? ""} onChange={(e) => set("confirmationMessage", e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">Marcadores: {"{campanha}"} {"{pedido}"} {"{numeros}"} {"{link}"}.</p>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">Perguntas frequentes</h2>
        {f.faq.map((item, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-stone-200 p-3">
            <input className="input" aria-label={`Pergunta ${i + 1}`} value={item.q} onChange={(e) => set("faq", f.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
            <textarea className="input py-2" aria-label={`Resposta ${i + 1}`} rows={2} value={item.a} onChange={(e) => set("faq", f.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
            <button type="button" className="btn-ghost justify-self-end text-sm" onClick={() => set("faq", f.faq.filter((_, j) => j !== i))}>Remover</button>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => set("faq", [...f.faq, { q: "", a: "" }])}>Adicionar pergunta</button>
      </section>

      {critical && (
        <section className="card space-y-3 border-amber-300 bg-amber-50">
          <h2 className="font-bold text-amber-900">Alteração crítica com vendas existentes</h2>
          <p className="text-sm text-amber-900">
            Esta campanha já tem pedidos. Pedidos existentes mantêm o preço pago; números já usados nunca são removidos. A alteração fica na auditoria.
          </p>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-5 accent-brand-600" checked={confirmCritical} onChange={(e) => setConfirmCritical(e.target.checked)} />
            Confirmo a alteração de preço/quantidade.
          </label>
          <textarea className="input py-2" rows={2} placeholder="Motivo (mínimo 10 caracteres)" aria-label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        </section>
      )}

      <ErrorBox error={error} />
      {saved && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 font-medium text-green-900">Alterações salvas.</p>}
      <button type="submit" className="btn-primary" disabled={busy || (critical && (!confirmCritical || reason.trim().length < 10))}>
        {busy ? "Salvando…" : "Salvar campanha"}
      </button>
    </form>
  );
}
