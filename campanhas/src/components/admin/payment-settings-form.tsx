"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { parseBRLToCents } from "@/lib/money";
import { ErrorBox, useAdminAction } from "./ui";

export type PaymentSettingsView = {
  version: number;
  mode: "AUTOMATIC" | "MANUAL";
  pixKeyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";
  pixKey: string;
  receiverName: string;
  receiverCity: string;
  gateway: "MERCADO_PAGO" | null;
  environment: "SANDBOX" | "PRODUCTION";
  webhookEnabled: boolean;
  apiKey: { configured: boolean; source: string | null; hint: string | null };
  webhookSecret: { configured: boolean; source: string | null; hint: string | null };
  envOverrides: boolean;
  webhookUrl: string;
  states: Record<string, unknown>;
};

const when = (v: unknown) => (typeof v === "string" ? formatDateTime(v) : "nunca");

export function PaymentSettingsForm({ campaignId, view, readOnly }: { campaignId: string; view: PaymentSettingsView; readOnly: boolean }) {
  const { run, busy, error } = useAdminAction();
  const [f, setF] = useState({
    mode: view.mode,
    pixKeyType: view.pixKeyType,
    pixKey: view.pixKey,
    receiverName: view.receiverName,
    receiverCity: view.receiverCity,
    gateway: view.gateway,
    environment: view.environment,
    webhookEnabled: view.webhookEnabled,
    apiKey: "",
    webhookSecret: "",
  });
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-5">
      <section className="card grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-stone-500">Modo</p>
          <p className="text-lg font-bold">{view.mode === "AUTOMATIC" ? "Automático (gateway)" : "Manual (Pix estático)"}</p>
        </div>
        <div>
          <p className="text-stone-500">Chave Pix</p>
          <p className="font-mono text-lg font-bold">{view.pixKey}</p>
        </div>
        <div>
          <p className="text-stone-500">Gateway</p>
          <p className="font-bold">{view.apiKey.configured ? `Configurado (${view.apiKey.source === "env" ? "variável de ambiente" : "painel"}, ${view.apiKey.hint ?? ""})` : "Não configurado"}</p>
        </div>
        <div>
          <p className="text-stone-500">Webhook</p>
          <p className="font-bold">{view.webhookEnabled && view.webhookSecret.configured ? "Ativo" : "Inativo"}</p>
          <p className="text-xs text-stone-500">Último recebido: {when(view.states["webhook.lastValidAt"])}</p>
        </div>
        <div>
          <p className="text-stone-500">Última sincronização (conciliação)</p>
          <p className="font-bold">{when(view.states["jobs.reconcile.lastRunAt"])}</p>
        </div>
        <div>
          <p className="text-stone-500">URL do webhook</p>
          <p className="break-all font-mono text-xs">{view.webhookUrl}</p>
        </div>
      </section>

      <form
        className="card space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(false);
          const ok = await run(`/api/admin/campaigns/${campaignId}/payment-settings`, { version: view.version, ...f }, "PUT");
          if (ok !== null) {
            setSaved(true);
            setF((p) => ({ ...p, apiKey: "", webhookSecret: "" }));
          }
        }}
      >
        <fieldset disabled={readOnly} className="space-y-4">
          <div>
            <p className="label">Modo de pagamento</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`rounded-xl border-2 p-3 ${f.mode === "AUTOMATIC" ? "border-brand-600" : "border-stone-200"}`}>
                <input type="radio" name="mode" className="mr-2 accent-brand-600" checked={f.mode === "AUTOMATIC"} onChange={() => setF({ ...f, mode: "AUTOMATIC" })} />
                <strong>Automático</strong> — cobrança Pix individual pelo gateway; confirmação por webhook/conciliação. <em>Recomendado.</em>
              </label>
              <label className={`rounded-xl border-2 p-3 ${f.mode === "MANUAL" ? "border-brand-600" : "border-stone-200"}`}>
                <input type="radio" name="mode" className="mr-2 accent-brand-600" checked={f.mode === "MANUAL"} onChange={() => setF({ ...f, mode: "MANUAL" })} />
                <strong>Manual</strong> — Pix estático com a chave abaixo; cada pagamento exige conferência e confirmação no painel.
              </label>
            </div>
            <p className="mt-1 text-xs text-stone-500">A mudança vale para novos pedidos; pedidos existentes mantêm o modo em que foram criados.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ps-kt">Tipo de chave</label>
              <select id="ps-kt" className="input" value={f.pixKeyType} onChange={(e) => setF({ ...f, pixKeyType: e.target.value as typeof f.pixKeyType })}>
                {["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"].map((t) => <option key={t} value={t}>{t === "EVP" ? "Aleatória" : t === "PHONE" ? "Telefone" : t === "EMAIL" ? "E-mail" : t}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ps-k">Chave Pix</label>
              <input id="ps-k" className="input font-mono" value={f.pixKey} onChange={(e) => setF({ ...f, pixKey: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="ps-n">Nome do recebedor (até 25 caracteres no QR)</label>
              <input id="ps-n" className="input" value={f.receiverName} onChange={(e) => setF({ ...f, receiverName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="ps-c">Cidade (até 15 caracteres no QR)</label>
              <input id="ps-c" className="input" value={f.receiverCity} onChange={(e) => setF({ ...f, receiverCity: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ps-g">Gateway</label>
              <select id="ps-g" className="input" value={f.gateway ?? ""} onChange={(e) => setF({ ...f, gateway: e.target.value ? "MERCADO_PAGO" : null })}>
                <option value="">Nenhum</option>
                <option value="MERCADO_PAGO">Mercado Pago</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ps-e">Ambiente</label>
              <select id="ps-e" className="input" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as typeof f.environment })}>
                <option value="SANDBOX">Teste (sandbox)</option>
                <option value="PRODUCTION">Produção</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ps-ak">Access token (API key)</label>
              <input id="ps-ak" className="input font-mono" type="password" autoComplete="off" placeholder={view.apiKey.configured ? `configurado ${view.apiKey.hint ?? ""} — deixe vazio para manter` : "não configurado"} value={f.apiKey} disabled={view.envOverrides} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
              {view.envOverrides && <p className="mt-1 text-xs text-stone-500">Definido por variável de ambiente (tem precedência).</p>}
            </div>
            <div>
              <label className="label" htmlFor="ps-ws">Segredo do webhook (assinatura)</label>
              <input id="ps-ws" className="input font-mono" type="password" autoComplete="off" placeholder={view.webhookSecret.configured ? `configurado ${view.webhookSecret.hint ?? ""} — deixe vazio para manter` : "não configurado"} value={f.webhookSecret} disabled={view.webhookSecret.source === "env"} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-5 accent-brand-600" checked={f.webhookEnabled} onChange={(e) => setF({ ...f, webhookEnabled: e.target.checked })} />
            Webhook ativo
          </label>
          <p className="text-xs text-stone-500">As credenciais são criptografadas no servidor e nunca voltam para o navegador; apenas os 4 últimos caracteres são exibidos.</p>
        </fieldset>
        <ErrorBox error={error} />
        {saved && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 font-medium text-green-900">Configuração salva.</p>}
        {!readOnly && <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Salvando…" : "Salvar configuração"}</button>}
      </form>
    </div>
  );
}

/** QR Code estático avulso: sempre rotulado como confirmação manual. */
export function StaticQrTool({ campaignId }: { campaignId: string }) {
  const { run, busy, error, setError } = useAdminAction();
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [qr, setQr] = useState<{ copyPaste: string; qrDataUri: string; label: string } | null>(null);
  return (
    <section className="card space-y-3">
      <h2 className="font-bold">Gerar QR Code estático</h2>
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Pix estático — confirmação manual. Não gera pedido e nunca é confirmado automaticamente.</p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          let cents: number | null = null;
          if (amount.trim()) {
            try {
              cents = parseBRLToCents(amount);
            } catch {
              setError({ code: "VALIDATION", message: "Valor inválido." });
              return;
            }
          }
          setQr(await run(`/api/admin/campaigns/${campaignId}/static-qr`, { amountCents: cents, description: desc.trim() || null }));
        }}
      >
        <input className="input" aria-label="Valor (opcional)" placeholder="Valor (opcional)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="input" aria-label="Descrição (opcional)" placeholder="Descrição (opcional)" value={desc} maxLength={60} onChange={(e) => setDesc(e.target.value)} />
        <button type="submit" className="btn-secondary" disabled={busy}>Gerar</button>
      </form>
      <ErrorBox error={error} />
      {qr && (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.qrDataUri} alt="QR Code Pix estático" className="size-48 rounded-xl border border-stone-200 p-2" />
          <div>
            <p className="font-semibold">{qr.label}</p>
            <textarea readOnly className="input mt-2 py-2 font-mono text-xs" rows={4} value={qr.copyPaste} />
          </div>
        </div>
      )}
    </section>
  );
}
