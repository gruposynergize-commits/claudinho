import type { Metadata } from "next";
import Link from "next/link";
import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { getDrawOverview, methodDescription } from "@/server/draw/service";
import { CANONICAL_FORMAT_DESCRIPTION } from "@/lib/draw/methods";
import { formatDateTime, formatNumber, formatPhone, maskPhone, shortName } from "@/lib/format";
import { CAMPAIGN_STATUS_LABEL, DELIVERY_STATUS_LABEL, DRAW_METHOD_LABEL, DRAW_STATUS_LABEL } from "@/lib/labels";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";
import { ReasonAction } from "@/components/admin/ui";
import { DeliveryControl, ExecuteForm, FinalizeButton, FreezeForm, RunJobButton } from "@/components/admin/draw-controls";

export const metadata: Metadata = { title: "Sorteio" };

type Overview = Awaited<ReturnType<typeof getDrawOverview>>;
type DrawRow = Overview["draws"][number];

function referenceAtOf(d: DrawRow): string | null {
  const p = d.methodParams as Record<string, unknown> | null;
  return typeof p?.referenceAt === "string" ? p.referenceAt : null;
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "current" | "todo"; children?: React.ReactNode }) {
  const style = state === "done" ? "bg-green-700 text-white" : state === "current" ? "bg-brand-600 text-white" : "bg-stone-200 text-stone-700";
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${style}`}>{state === "done" ? "✓" : n}</span>
      <div>
        <p className="font-semibold">
          {title} <span className="sr-only">({state === "done" ? "concluído" : state === "current" ? "etapa atual" : "pendente"})</span>
        </p>
        {children && <div className="text-sm text-stone-600">{children}</div>}
      </div>
    </li>
  );
}

function SnapshotCard({ d, digits }: { d: DrawRow; digits: number }) {
  const s = d.snapshot!;
  const refAt = referenceAtOf(d);
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold text-stone-600">Congelada em</dt><dd>{formatDateTime(s.createdAt)} por {d.createdBy.email}</dd></div>
      <div><dt className="font-semibold text-stone-600">Números elegíveis (pagos)</dt><dd className="text-lg font-bold">{s.eligibleNumbersCount.toLocaleString("pt-BR")}</dd></div>
      <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Hash SHA-256 da lista</dt><dd className="break-all font-mono text-xs">{s.eligibleNumbersHash}</dd></div>
      <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Formato canônico</dt><dd>{CANONICAL_FORMAT_DESCRIPTION}</dd></div>
      <div><dt className="font-semibold text-stone-600">Método</dt><dd>{DRAW_METHOD_LABEL[d.method]}</dd></div>
      <div><dt className="font-semibold text-stone-600">Referência oficial</dt><dd>{s.officialReference}{refAt ? ` — ${formatDateTime(refAt)}` : ""}</dd></div>
      <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Regra de apuração</dt><dd>{s.officialMethodDescription}</dd></div>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <a className="font-semibold text-brand-700 underline" href={`/api/public/draws/${d.id}/eligible`}>Baixar lista elegível (.txt)</a>
        <a className="font-semibold text-brand-700 underline" href={`/api/admin/draws/${d.id}/report`}>Relatório (JSON)</a>
        <Link className="font-semibold text-brand-700 underline" href={`/admin/sorteio/relatorio/${d.id}`}>Relatório para impressão</Link>
      </div>
      <p className="sr-only">Números com {digits} dígitos.</p>
    </dl>
  );
}

export default async function DrawPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await adminPage("draw.view", sp);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  const ov = await getDrawOverview(ctx.campaign.id);
  const { campaign } = ov;
  const manage = ctx.can("draw.manage");
  const pii = ctx.can("customers.viewPII");
  const live = ov.draws.find((d) => d.status !== "FAILED");
  const annulled = ov.draws.filter((d) => d.status === "FAILED");
  const digits = campaign.numberDigits;
  const salesClosed = ["CLOSED", "FROZEN", "DRAWN"].includes(campaign.status);
  const refAt = live ? referenceAtOf(live) : null;
  const refPending = !!refAt && new Date(refAt).getTime() > ov.serverNow.getTime();
  const allDelivered = !!live && live.results.length > 0 && live.results.every((r) => r.deliveryStatus === "DELIVERED");
  const needsReference = campaign.drawMethod === "FEDERAL_LOTTERY" || campaign.drawMethod === "VERIFIABLE_HASH";

  return (
    <div className="space-y-5">
      <PageTitle title="Sorteio" subtitle={`${campaign.name} · ${CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}`}>
        <Link href={`/campanha/${campaign.slug}/resultado`} className="btn-ghost min-h-10 text-sm">Página pública do resultado</Link>
      </PageTitle>

      <section className="card">
        <h2 className="mb-3 font-bold">Etapas</h2>
        <ol className="space-y-3">
          <Step n={1} title="Encerrar as vendas" state={salesClosed ? "done" : "current"}>
            {!salesClosed && (
              <>Use <Link className="font-semibold text-brand-700 underline" href="/admin/configuracoes/campanha">Configurações → Campanha</Link> → “Encerrar vendas”.</>
            )}
          </Step>
          <Step n={2} title="Congelar e publicar a lista elegível (hash SHA-256)" state={live ? "done" : salesClosed ? "current" : "todo"} />
          <Step n={3} title="Apurar pelo método oficial" state={live && live.status !== "SNAPSHOT_CREATED" ? "done" : live ? "current" : "todo"}>
            {live?.status === "SNAPSHOT_CREATED" && refPending && <>Liberada após {formatDateTime(refAt!)}.</>}
          </Step>
          <Step n={4} title="Homologar (conferir elegibilidade)" state={live?.status === "FINALIZED" ? "done" : live?.status === "EXECUTED" ? "current" : "todo"} />
          <Step n={5} title="Entregar os prêmios" state={allDelivered ? "done" : live?.status === "FINALIZED" ? "current" : "todo"} />
        </ol>
      </section>

      {!live && (
        <section className="card space-y-4">
          <h2 className="font-bold">Pré-requisitos para congelar</h2>
          <p className="text-sm text-stone-700">
            Método configurado: <strong>{campaign.drawMethod ? DRAW_METHOD_LABEL[campaign.drawMethod] : "não definido"}</strong>
          </p>
          {campaign.drawMethod && (
            <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-700">
              {methodDescription(campaign.drawMethod, campaign.drawMethodParams, campaign)}
            </p>
          )}
          {ov.blockers.length > 0 ? (
            <ul role="list" className="space-y-1 text-sm">
              {ov.blockers.map((b) => (
                <li key={b} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-950"><span aria-hidden>!</span>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-900">
              ✓ Pronto para congelar: {ov.counts.paid.toLocaleString("pt-BR")} números pagos, {ov.counts.prizes} prêmio(s).
            </p>
          )}
          {manage && ctx.can("system.view") && (
            <div>
              <p className="mb-2 text-sm text-stone-600">Antes de congelar, confira no gateway pagamentos cujo aviso ainda não chegou:</p>
              <RunJobButton job="reconcile" label="Conciliar pagamentos agora" />
            </div>
          )}
          {manage && ov.blockers.length === 0 && <FreezeForm campaignId={campaign.id} needsReference={needsReference} />}
        </section>
      )}

      {live && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Sorteio atual</h2>
            <span className="badge bg-brand-100 text-brand-900">{DRAW_STATUS_LABEL[live.status]}</span>
          </div>
          <SnapshotCard d={live} digits={digits} />
        </section>
      )}

      {live?.status === "SNAPSHOT_CREATED" && manage && (
        <section className="card space-y-3">
          <h2 className="font-bold">Apuração</h2>
          {refPending ? (
            <p className="text-sm text-stone-700">A apuração será liberada depois do evento oficial: {formatDateTime(refAt!)}.</p>
          ) : (
            <ExecuteForm
              drawId={live.id}
              method={live.method}
              prizes={ov.prizes.map((p) => ({ position: p.position, name: p.name }))}
              numberDigits={digits}
            />
          )}
        </section>
      )}

      {live && live.results.length > 0 && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Resultado</h2>
            <div className="flex flex-wrap gap-2">
              {manage && live.status === "EXECUTED" && <FinalizeButton drawId={live.id} />}
            </div>
          </div>
          <ul className="space-y-3">
            {live.results.map((r) => {
              const steps = Array.isArray((r.computation as { steps?: unknown }).steps) ? ((r.computation as { steps: string[] }).steps) : [];
              const phone = r.order.customerPhone;
              return (
                <li key={r.id} className="rounded-xl border border-stone-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{r.prizePosition}º prêmio — {r.prize.name}</p>
                    <p className="font-mono text-2xl font-extrabold text-brand-700">{formatNumber(r.winnerNumber, digits)}</p>
                  </div>
                  <p className="text-sm text-stone-700">
                    Pedido <Link className="font-semibold underline" href={`/admin/pedidos/${r.order.id}`}>{r.order.code}</Link> ·{" "}
                    {pii ? r.order.customerName : shortName(r.order.customerName)} · {pii ? formatPhone(phone) : maskPhone(phone)}
                    {pii && live.status === "FINALIZED" && (
                      <>
                        {" · "}
                        <a
                          className="font-semibold text-brand-700 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={`https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Aqui é da ${campaign.name}. Seu número ${formatNumber(r.winnerNumber, digits)} foi contemplado com o ${r.prizePosition}º prêmio (${r.prize.name}). Vamos combinar a entrega?`)}`}
                        >
                          Chamar no WhatsApp
                        </a>
                      </>
                    )}
                  </p>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer font-semibold text-stone-700">Cálculo</summary>
                    <ul className="ml-4 list-disc text-xs text-stone-600">{steps.map((s) => <li key={s} className="break-all">{s}</li>)}</ul>
                  </details>
                  <p className="mt-1 text-sm">
                    Elegibilidade: {r.eligibilityVerifiedAt ? `verificada em ${formatDateTime(r.eligibilityVerifiedAt)}` : "a verificar na homologação"} · Entrega:{" "}
                    <strong>{DELIVERY_STATUS_LABEL[r.deliveryStatus]}</strong>
                    {r.deliveryNotes ? ` — ${r.deliveryNotes}` : ""}
                  </p>
                  {manage && live.status === "FINALIZED" && <DeliveryControl resultId={r.id} status={r.deliveryStatus} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {live && manage && (live.status === "SNAPSHOT_CREATED" || (live.status === "EXECUTED" && live.method !== "CSPRNG")) && (
        <section className="card space-y-2">
          <h2 className="font-bold">Anular este sorteio</h2>
          <p className="text-sm text-stone-700">
            Use somente se a referência oficial foi cancelada/adiada ou se o resultado oficial foi digitado errado. A anulação é
            <strong> pública</strong> (aparece na página de resultado com o motivo) e fica na auditoria. A lista congelada é mantida e um novo
            sorteio pode ser criado.
          </p>
          <ReasonAction
            label="Anular sorteio"
            title="Anular este sorteio?"
            description="Informe o motivo. Ele será exibido publicamente."
            url={`/api/admin/draws/${live.id}/annul`}
            confirmLabel="Anular"
            danger
            minLength={10}
          />
        </section>
      )}

      {annulled.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-bold">Sorteios anulados</h2>
          {annulled.map((d) => (
            <div key={d.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p><strong>Anulado em {formatDateTime(d.failedAt!)}</strong> — {d.failureReason}</p>
              <p className="text-stone-600">Congelado em {formatDateTime(d.createdAt)} · hash <span className="break-all font-mono text-xs">{d.snapshot?.eligibleNumbersHash}</span></p>
              {d.results.length > 0 && (
                <p className="text-stone-600">Apuração anulada: {d.results.map((r) => `${r.prizePosition}º → ${formatNumber(r.winnerNumber, digits)}`).join(" · ")}</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
