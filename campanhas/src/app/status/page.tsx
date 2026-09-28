import Link from "next/link";
import { currentAdmin } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { getSystemStatus } from "@/server/admin/observability";
import { formatDateTime } from "@/lib/format";
import { NoPermission, PageTitle } from "@/components/admin/states";
import { JobRunner, RefreshButton } from "@/components/admin/job-runner";

export const dynamic = "force-dynamic";

const OVERALL = {
  OPERATIONAL: { icon: "✓", label: "Sistema operacional", style: "bg-green-50 text-green-900 border-green-200" },
  DEGRADED: { icon: "!", label: "Operando com alertas", style: "bg-amber-50 text-amber-950 border-amber-300" },
  DOWN: { icon: "✕", label: "Fora do ar", style: "bg-red-50 text-red-900 border-red-300" },
} as const;

function when(v: unknown): string {
  if (typeof v !== "string") return "nunca";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "—";
  const min = Math.round((Date.now() - t.getTime()) / 60_000);
  const rel = min < 1 ? "agora há pouco" : min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`;
  return `${formatDateTime(t)} (${rel})`;
}

function Row({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-stone-100 py-2 first:border-t-0">
      <dt className="text-sm text-stone-600">{label}</dt>
      <dd className={`text-sm font-semibold ${bad ? "text-red-800" : "text-stone-900"}`}>{value}</dd>
    </div>
  );
}

export default async function StatusPage() {
  const user = await currentAdmin();
  if (!user || !can(user.role, "system.view")) return <NoPermission />;
  const s = await getSystemStatus();
  const o = OVERALL[s.overall as keyof typeof OVERALL];

  return (
    <div className="space-y-4">
      <PageTitle title="Status do sistema" subtitle="Visível apenas para administradores.">
        <RefreshButton />
      </PageTitle>

      <section className={`rounded-2xl border p-4 ${o.style}`} aria-live="polite">
        <p className="flex items-center gap-2 text-lg font-extrabold">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-white/70 text-base">{o.icon}</span>
          {o.label}
        </p>
        {s.warnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm font-medium">
            {s.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-bold">Banco de dados</h2>
          <dl>
            <Row label="Conexão" value={s.db.ok ? "OK" : "FALHA"} bad={!s.db.ok} />
            <Row label="Latência" value={s.db.latencyMs !== null ? `${s.db.latencyMs} ms` : "—"} />
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-2 font-bold">Gateway de pagamento</h2>
          <dl>
            {s.gateways.map((g) => (
              <Row
                key={g.campaign}
                label={g.campaign}
                value={g.mode === "AUTOMATIC" ? (g.configured ? `Automático · credenciais OK${g.webhookEnabled ? " · webhook ativo" : " · webhook desligado"}` : "Automático · SEM credenciais") : "Manual (Pix estático)"}
                bad={g.mode === "AUTOMATIC" && !g.configured}
              />
            ))}
            <Row label="Última chamada bem-sucedida" value={when(s.states["gateway.lastSuccessAt"])} />
            <Row label="Última falha" value={when(s.states["gateway.lastErrorAt"])} bad={typeof s.states["gateway.lastErrorAt"] === "string"} />
            {typeof s.states["gateway.lastError"] === "string" && <Row label="Erro" value={s.states["gateway.lastError"]} bad />}
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-2 font-bold">Webhook Pix</h2>
          <dl>
            <Row label="Último recebido" value={when(s.states["webhook.lastReceivedAt"])} />
            <Row label="Último válido (assinatura OK)" value={when(s.states["webhook.lastValidAt"])} />
            <Row label="Último inválido (recusado)" value={when(s.states["webhook.lastInvalidAt"])} bad={typeof s.states["webhook.lastInvalidAt"] === "string"} />
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-2 font-bold">Rotinas automáticas</h2>
          <dl>
            <Row label="Última sincronização (conciliação)" value={when(s.states["jobs.reconcile.lastRunAt"])} />
            <Row label="Última expiração" value={when(s.states["jobs.expire.lastRunAt"])} />
            <Row label="Última limpeza/retenção" value={when(s.states["jobs.cleanup.lastRunAt"])} />
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-2 font-bold">Vendas</h2>
          <dl>
            <Row label="Última venda" value={s.lastSale ? `${s.lastSale.code} · ${when(s.lastSale.at)}` : "nenhuma"} />
            <Row label="Pedidos aguardando pagamento" value={s.counts.pendingOrders} />
            <Row label="Reservas ativas" value={s.counts.activeReservations} />
            <Row label="Pagamentos que exigem atenção" value={s.counts.attentionPayments} bad={s.counts.attentionPayments > 0} />
          </dl>
          {s.counts.attentionPayments > 0 && <Link href="/admin/pagamentos" className="mt-2 inline-block text-sm font-semibold text-brand-700 underline">Tratar pagamentos</Link>}
        </section>

        <section className="card">
          <h2 className="mb-2 font-bold">Servidor</h2>
          <dl>
            <Row label="Versão" value={s.runtime.version} />
            <Row label="Node.js" value={s.runtime.node} />
            <Row label="Sistema" value={s.runtime.platform} />
            <Row label="No ar há" value={`${s.runtime.uptimeMinutes} min`} />
          </dl>
        </section>
      </div>

      <section className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Erros recentes (24 h)</h2>
          <Link href="/admin/sistema/logs?level=ERROR" className="text-sm font-semibold text-brand-700 underline">Ver todos os logs</Link>
        </div>
        {s.recentErrors.length === 0 ? (
          <p className="text-sm text-stone-600">Nenhum erro nas últimas 24 horas.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {s.recentErrors.map((e, i) => (
              <li key={i} className="rounded-xl bg-red-50 p-2">
                <span className="font-semibold text-red-900">{e.level} · {e.category}</span>{" "}
                <span className="text-xs text-stone-600">{formatDateTime(e.at)}</span>
                <p>{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="mb-2 font-bold">Executar rotinas agora</h2>
        <JobRunner />
      </section>
    </div>
  );
}
