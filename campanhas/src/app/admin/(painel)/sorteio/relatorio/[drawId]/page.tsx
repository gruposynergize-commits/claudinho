import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminPage } from "@/server/admin/page-context";
import { drawReport } from "@/server/draw/service";
import { AppError } from "@/server/errors";
import { formatDateTime, shortName } from "@/lib/format";
import { DELIVERY_STATUS_LABEL, DRAW_METHOD_LABEL, DRAW_STATUS_LABEL } from "@/lib/labels";
import { CANONICAL_FORMAT_DESCRIPTION } from "@/lib/draw/methods";
import { NoPermission } from "@/components/admin/states";
import { PrintButton } from "@/components/admin/draw-controls";

export const metadata: Metadata = { title: "Relatório do sorteio" };

const when = (d: Date | string | null) => (d ? formatDateTime(d) : "—");

export default async function DrawReportPage({ params }: { params: Promise<{ drawId: string }> }) {
  const ctx = await adminPage("draw.view");
  if (!ctx.allowed) return <NoPermission />;
  const { drawId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(drawId)) notFound();
  let report: Awaited<ReturnType<typeof drawReport>>;
  try {
    report = await drawReport(drawId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const pii = ctx.can("customers.viewPII");
  const { campaign, draw, snapshot, results } = report;

  return (
    <article className="mx-auto max-w-3xl space-y-5 bg-white p-2 text-sm print:max-w-none print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Relatório do sorteio</h1>
          <p className="text-stone-600">{campaign.name} · gerado em {when(report.generatedAt)}</p>
        </div>
        <PrintButton />
      </div>

      <section>
        <h2 className="border-b border-stone-300 font-bold">Sorteio</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <dt className="text-stone-600">Situação</dt><dd>{DRAW_STATUS_LABEL[draw.status]}</dd>
          <dt className="text-stone-600">Método</dt><dd>{DRAW_METHOD_LABEL[draw.method]}</dd>
          <dt className="text-stone-600">Congelado</dt><dd>{when(draw.createdAt)} — {draw.createdBy}</dd>
          <dt className="text-stone-600">Apurado</dt><dd>{when(draw.executedAt)}{draw.executedBy ? ` — ${draw.executedBy}` : ""}</dd>
          <dt className="text-stone-600">Homologado</dt><dd>{when(draw.finalizedAt)}{draw.finalizedBy ? ` — ${draw.finalizedBy}` : ""}</dd>
          {draw.failedAt && (<><dt className="text-stone-600">Anulado</dt><dd>{when(draw.failedAt)} — {draw.failureReason}</dd></>)}
        </dl>
      </section>

      <section>
        <h2 className="border-b border-stone-300 font-bold">Lista elegível (snapshot)</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <dt className="text-stone-600">Números elegíveis</dt><dd>{snapshot.eligibleNumbersCount}</dd>
          <dt className="text-stone-600">Hash ({snapshot.hashAlgorithm})</dt><dd className="break-all font-mono text-xs">{snapshot.eligibleNumbersHash}</dd>
          <dt className="text-stone-600">Hash recalculado agora</dt>
          <dd className={snapshot.hashMatches ? "font-semibold text-green-800" : "font-semibold text-red-800"}>{snapshot.hashMatches ? "confere" : "NÃO CONFERE"}</dd>
          <dt className="text-stone-600">Formato canônico</dt><dd>{CANONICAL_FORMAT_DESCRIPTION}</dd>
          <dt className="text-stone-600">Referência oficial</dt><dd>{snapshot.officialReference}</dd>
          <dt className="text-stone-600">Regra</dt><dd>{snapshot.officialMethodDescription}</dd>
        </dl>
        <p className="mt-2 break-words font-mono text-[11px] leading-5 text-stone-700">{snapshot.eligibleNumbers.join(" ")}</p>
      </section>

      <section>
        <h2 className="border-b border-stone-300 font-bold">Resultado</h2>
        {results.length === 0 ? (
          <p className="mt-2 text-stone-600">Ainda não apurado.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {results.map((r) => {
              const steps = Array.isArray((r.computation as { steps?: unknown })?.steps) ? (r.computation as { steps: string[] }).steps : [];
              return (
                <li key={r.prizePosition} className="break-inside-avoid">
                  <p className="font-semibold">
                    {r.prizePosition}º prêmio — {r.prizeName}: número <span className="font-mono text-base">{r.winnerNumber}</span>
                  </p>
                  <p>Pedido {r.orderCode} · {pii ? r.buyerName : shortName(r.buyerName)} · elegibilidade {when(r.eligibilityVerifiedAt)} · entrega: {DELIVERY_STATUS_LABEL[r.deliveryStatus]}</p>
                  <ul className="ml-4 list-disc text-xs text-stone-600">{steps.map((s) => <li key={s} className="break-all">{s}</li>)}</ul>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <h2 className="border-b border-stone-300 font-bold">Trilha de auditoria</h2>
        <ul className="mt-2 space-y-1">
          {report.auditTrail.map((a) => (
            <li key={a.id}>
              #{a.id} · {when(a.createdAt)} · {a.actorLabel} · <strong>{a.action}</strong>{a.reason ? ` — ${a.reason}` : ""}
              <span className="block break-all font-mono text-[10px] text-stone-500">{a.hash}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
