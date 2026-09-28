import Link from "next/link";
import { adminPage, param, type SearchParams } from "@/server/admin/page-context";
import { listLogs } from "@/server/admin/observability";
import { formatDateTime } from "@/lib/format";
import { NoPermission, PageTitle } from "@/components/admin/states";
import { AutoSubmitForm } from "@/components/admin/ui";
import type { LogLevel } from "@/generated/prisma/client";

const LEVELS: LogLevel[] = ["INFO", "WARN", "ERROR", "CRITICAL"];
const CATEGORIES = ["ERROR", "WEBHOOK", "PAYMENT", "ORDER", "RESERVATION", "ADMIN", "AUTH", "DRAW", "SECURITY", "JOB", "SYSTEM"];
const LEVEL_STYLE: Record<string, string> = {
  INFO: "bg-stone-100 text-stone-800",
  WARN: "bg-amber-100 text-amber-900",
  ERROR: "bg-red-100 text-red-900",
  CRITICAL: "bg-red-700 text-white",
  DEBUG: "bg-stone-100 text-stone-600",
};

function dateParam(v?: string, end = false) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00-03:00`);
  return end ? new Date(d.getTime() + 86_400_000) : d;
}

export default async function LogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("system.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  const level = LEVELS.find((l) => l === param(sp, "level"));
  const category = CATEGORIES.find((c) => c === param(sp, "category"));
  const page = Number(param(sp, "page") ?? 1) || 1;
  const result = await listLogs({ level, category, q: param(sp, "q"), from: dateParam(param(sp, "from")), to: dateParam(param(sp, "to"), true), page });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div>
      <PageTitle title="Sistema → Logs" subtitle="Erros, webhooks, falhas de pagamento, mudanças administrativas, sorteio e tentativas suspeitas." />
      <AutoSubmitForm className="card mb-4 grid gap-3 sm:grid-cols-5">
        <select name="level" className="input" aria-label="Nível" defaultValue={level ?? ""}>
          <option value="">Todos os níveis</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select name="category" className="input" aria-label="Categoria" defaultValue={category ?? ""}>
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input name="q" type="search" className="input" placeholder="Texto" aria-label="Texto" defaultValue={param(sp, "q")} />
        <input name="from" type="date" className="input" aria-label="De" defaultValue={param(sp, "from")} />
        <input name="to" type="date" className="input" aria-label="Até" defaultValue={param(sp, "to")} />
      </AutoSubmitForm>
      <ul className="space-y-2">
        {result.rows.map((l) => (
          <li key={l.id.toString()} className="card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
              <span className="badge bg-stone-100 text-stone-700">{l.category}</span>
              <span className="text-xs text-stone-500">{formatDateTime(l.createdAt)}</span>
            </div>
            <p className="mt-1 font-medium">{l.message}</p>
            {l.context && <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-stone-50 p-2 text-[11px] text-stone-700">{JSON.stringify(l.context, null, 2)}</pre>}
          </li>
        ))}
        {result.rows.length === 0 && <li className="card text-stone-500">Nenhum registro.</li>}
      </ul>
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
