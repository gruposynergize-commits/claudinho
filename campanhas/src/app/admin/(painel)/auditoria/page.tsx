import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listAudit } from "@/server/admin/observability";
import { formatDateTime } from "@/lib/format";
import { NoPermission, PageTitle } from "@/components/admin/states";
import { AutoSubmitForm } from "@/components/admin/ui";
import { AuditVerify } from "@/components/admin/audit-verify";

function dateParam(v?: string, end = false) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00-03:00`);
  return end ? new Date(d.getTime() + 86_400_000) : d;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("audit.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  const page = Number(param(sp, "page") ?? 1) || 1;
  const result = await listAudit({
    action: param(sp, "action"),
    entityType: param(sp, "entity"),
    actor: param(sp, "actor"),
    from: dateParam(param(sp, "from")),
    to: dateParam(param(sp, "to"), true),
    page,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div>
      <PageTitle title="Auditoria" subtitle="Registro somente de inclusão, encadeado por hash SHA-256.">
        <AuditVerify />
        {ctx.campaign && ctx.can("export.data") && (
          <a href={`/api/admin/campaigns/${ctx.campaign.id}/export/auditoria`} className="btn-secondary min-h-10 text-sm">Exportar CSV</a>
        )}
      </PageTitle>
      <AutoSubmitForm className="card mb-4 grid gap-3 sm:grid-cols-5">
        <input name="action" type="search" className="input" placeholder="Ação (ex.: PAYMENT)" aria-label="Ação" defaultValue={param(sp, "action")} />
        <input name="actor" type="search" className="input" placeholder="Usuário" aria-label="Usuário" defaultValue={param(sp, "actor")} />
        <select name="entity" className="input" aria-label="Registro" defaultValue={param(sp, "entity") ?? ""}>
          <option value="">Todos os registros</option>
          {["order", "payment", "campaign", "campaign_number", "reservation", "customer", "prize", "legal_information", "payment_settings", "user", "draw", "export"].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input name="from" type="date" className="input" aria-label="De" defaultValue={param(sp, "from")} />
        <input name="to" type="date" className="input" aria-label="Até" defaultValue={param(sp, "to")} />
      </AutoSubmitForm>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-600">
            <tr>{["#", "Data", "Usuário", "Ação", "Registro", "Motivo", "Antes → depois", "IP"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.map((a) => (
              <tr key={a.id.toString()} className="border-t border-stone-100 align-top">
                <td className="px-3 py-2 font-mono text-xs">{a.id.toString()}</td>
                <td className="px-3 py-2 text-xs">{formatDateTime(a.createdAt)}</td>
                <td className="px-3 py-2">{a.actorLabel}<span className="block text-xs text-stone-500">{a.actorType}</span></td>
                <td className="px-3 py-2 font-semibold">{a.action}</td>
                <td className="px-3 py-2 text-xs">
                  {a.entityType === "order" && a.entityId ? <Link href={`/admin/pedidos/${a.entityId}`} className="text-brand-700 underline">pedido</Link> : a.entityType}
                  {a.entityId && a.entityType !== "order" && <span className="block font-mono">{a.entityId.slice(0, 12)}</span>}
                </td>
                <td className="max-w-60 px-3 py-2 text-xs">{a.reason ?? "—"}</td>
                <td className="max-w-80 px-3 py-2 font-mono text-[11px] text-stone-600">
                  {a.before ? <span className="block break-all">− {JSON.stringify(a.before).slice(0, 300)}</span> : null}
                  {a.after ? <span className="block break-all">+ {JSON.stringify(a.after).slice(0, 300)}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">{a.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="mt-4 flex justify-between" aria-label="Paginação">
          {page > 1 ? <Link className="btn-ghost" href={`?page=${page - 1}`}>← Anterior</Link> : <span />}
          <span className="text-sm text-stone-600">Página {page} de {pages}</span>
          {page < pages ? <Link className="btn-ghost" href={`?page=${page + 1}`}>Próxima →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
