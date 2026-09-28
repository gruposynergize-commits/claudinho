import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicDrawPage } from "@/server/draw/service";
import { CANONICAL_FORMAT_DESCRIPTION } from "@/lib/draw/methods";
import { formatDateTime, formatNumber } from "@/lib/format";
import { DRAW_METHOD_LABEL, DRAW_STATUS_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicDrawPage(slug);
  return { title: page ? `Resultado — ${page.campaign.name}` : "Resultado" };
}

export default async function ResultPage({ params }: Props) {
  const { slug } = await params;
  const page = await getPublicDrawPage(slug);
  if (!page) notFound();
  const { campaign } = page;
  const live = page.draws.find((d) => d.status !== "FAILED");
  const annulled = page.draws.filter((d) => d.status === "FAILED");
  const fmt = (n: number) => formatNumber(n, campaign.numberDigits);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <Link href={`/campanha/${campaign.slug}`} className="text-sm font-semibold text-brand-700 underline">← {campaign.name}</Link>
        <h1 className="mt-2 text-2xl font-extrabold">Sorteio e transparência</h1>
        <p className="text-stone-600">
          Método oficial: {campaign.officialDrawMethod ?? (campaign.drawMethod ? DRAW_METHOD_LABEL[campaign.drawMethod] : "conforme o regulamento")}
        </p>
      </div>

      {!live && (
        <section className="card">
          <h2 className="text-lg font-bold">O sorteio ainda não aconteceu</h2>
          <p className="mt-2 text-stone-700">
            Quando as vendas forem encerradas, a lista de números pagos será congelada e publicada aqui com uma impressão digital (hash
            SHA-256) <strong>antes</strong> do resultado oficial existir. Assim, qualquer pessoa pode conferir que a lista não mudou.
          </p>
          {campaign.drawScheduledAt && <p className="mt-2 text-stone-700">Data prevista: {formatDateTime(campaign.drawScheduledAt)}</p>}
        </section>
      )}

      {live && (
        <section className="card space-y-4" aria-labelledby="atual">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="atual" className="text-lg font-bold">{live.results.length > 0 ? "Resultado" : "Lista congelada"}</h2>
            <span className="badge bg-brand-100 text-brand-900">{DRAW_STATUS_LABEL[live.status]}</span>
          </div>

          {live.results.length > 0 && (
            <ul className="space-y-2">
              {live.results.map((r) => (
                <li key={r.position} className="rounded-xl bg-brand-50 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{r.position}º prêmio — {r.prizeName}</span>
                    <span className="font-mono text-2xl font-extrabold text-brand-700">{fmt(r.winnerNumber)}</span>
                  </div>
                  {r.steps.length > 0 && (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer font-semibold text-stone-700">Como este número foi obtido</summary>
                      <ul className="ml-4 list-disc text-xs text-stone-600">{r.steps.map((s) => <li key={s} className="break-all">{s}</li>)}</ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {live.status === "EXECUTED" && <p className="text-sm text-stone-600">Apuração realizada em {formatDateTime(live.executedAt!)}; aguardando homologação.</p>}
          {live.status === "FINALIZED" && <p className="text-sm text-stone-600">Resultado homologado em {formatDateTime(live.finalizedAt!)}.</p>}

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold text-stone-600">Lista congelada em</dt><dd>{formatDateTime(live.frozenAt)}</dd></div>
            <div><dt className="font-semibold text-stone-600">Números participantes (pagos)</dt><dd className="text-lg font-bold">{live.eligibleCount.toLocaleString("pt-BR")}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Hash {live.hashAlgorithm} da lista</dt><dd className="break-all font-mono text-xs">{live.hash}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Referência oficial</dt><dd>{live.officialReference}{live.referenceAt ? ` — ${formatDateTime(live.referenceAt)}` : ""}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-stone-600">Regra de apuração</dt><dd>{live.rule}</dd></div>
          </dl>
          <a className="btn-secondary" href={`/api/public/draws/${live.id}/eligible`}>Baixar a lista de números participantes</a>
        </section>
      )}

      {live && (
        <section className="card space-y-2 text-sm text-stone-700" aria-labelledby="conferir">
          <h2 id="conferir" className="text-lg font-bold text-stone-900">Como conferir</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Baixe a lista de números participantes (arquivo de texto).</li>
            <li>
              Calcule o SHA-256 do arquivo e compare com o hash acima. Linux: <code>sha256sum arquivo.txt</code> · macOS:{" "}
              <code>shasum -a 256 arquivo.txt</code> · Windows (PowerShell): <code>Get-FileHash arquivo.txt -Algorithm SHA256</code>.
            </li>
            <li>Procure o seu número na lista: todos os números pagos até o congelamento estão nela.</li>
            <li>Confira a entrada oficial (ex.: resultado da Loteria Federal no site da CAIXA) e aplique a regra descrita acima.</li>
          </ol>
          <p className="text-xs text-stone-500">Formato do arquivo: {CANONICAL_FORMAT_DESCRIPTION}</p>
        </section>
      )}

      {annulled.length > 0 && (
        <section className="card space-y-3" aria-labelledby="anulados">
          <h2 id="anulados" className="text-lg font-bold">Sorteios anulados</h2>
          {annulled.map((d) => (
            <div key={d.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p><strong>Anulado em {formatDateTime(d.failedAt!)}:</strong> {d.failureReason}</p>
              <p className="text-stone-600">Lista congelada em {formatDateTime(d.frozenAt)} · {d.eligibleCount} números · hash <span className="break-all font-mono text-xs">{d.hash}</span></p>
              {d.results.length > 0 && <p className="text-stone-600">Apuração anulada: {d.results.map((r) => `${r.position}º → ${fmt(r.winnerNumber)}`).join(" · ")}</p>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
