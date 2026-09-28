import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicCampaignPage } from "@/server/campaigns/public";
import { getAdminPreviewAllowed } from "@/server/auth/preview";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { CAMPAIGN_STATUS_LABEL, DRAW_METHOD_LABEL, PRIZE_ORIGIN_LABEL } from "@/lib/labels";
import { StatusBadge } from "@/components/public/status-badge";
import { Paragraphs } from "@/components/public/paragraphs";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicCampaignPage(slug);
  if (!page || page.hidden) return { title: "Campanha" };
  return {
    title: page.campaign.name,
    description: page.campaign.shortDescription ?? `Participe da ${page.campaign.name}.`,
    openGraph: { title: page.campaign.name, description: page.campaign.shortDescription ?? undefined },
  };
}

export default async function CampaignPage({ params }: Props) {
  const { slug } = await params;
  const preview = await getAdminPreviewAllowed();
  const page = await getPublicCampaignPage(slug, { preview });
  if (!page) notFound();

  if (page.hidden) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{page.campaign.name}</h1>
        <p className="mt-3 text-stone-600">Esta campanha está em preparação e ainda não foi publicada.</p>
      </div>
    );
  }

  const { campaign, counts, prizes, legal, draw } = page;
  const soldPct = counts.total > 0 ? Math.floor((counts.sold / counts.total) * 1000) / 10 : 0;
  const prizeById = new Map(prizes.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
      {campaign.status === "DRAFT" && (
        <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">
          Pré-visualização do administrador: esta campanha ainda não está publicada.
        </p>
      )}

      <section aria-labelledby="titulo" className="card overflow-hidden p-0">
        {campaign.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={campaign.imageUrl} alt={`Foto do ${campaign.name}`} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-brand-50 text-7xl" role="img" aria-label="Foto ainda não cadastrada">
            🐱
          </div>
        )}
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
          </div>
          <h1 id="titulo" className="text-3xl font-extrabold tracking-tight text-stone-900">
            {campaign.name}
          </h1>
          {campaign.shortDescription && <p className="text-lg text-stone-700">{campaign.shortDescription}</p>}

          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs font-semibold uppercase text-stone-500">Valor</dt>
              <dd className="text-lg font-bold">{formatBRL(campaign.priceCents)}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs font-semibold uppercase text-stone-500">Vendidos</dt>
              <dd className="text-lg font-bold">{counts.sold.toLocaleString("pt-BR")}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs font-semibold uppercase text-stone-500">Disponíveis</dt>
              <dd className="text-lg font-bold">{counts.available.toLocaleString("pt-BR")}</dd>
            </div>
          </dl>

          <div>
            <div className="mb-1 flex justify-between text-sm font-medium text-stone-600">
              <span>
                {counts.sold.toLocaleString("pt-BR")} de {counts.total.toLocaleString("pt-BR")} números
              </span>
              <span>{soldPct.toLocaleString("pt-BR")}%</span>
            </div>
            <progress
              value={counts.sold}
              max={Math.max(counts.total, 1)}
              aria-label={`Progresso: ${counts.sold} de ${counts.total} números vendidos`}
              className="h-3 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-brand-600 [&::-webkit-progress-bar]:bg-stone-200 [&::-webkit-progress-value]:bg-brand-600"
            />
          </div>

          {campaign.salesOpen ? (
            <Link href={`/campanha/${campaign.slug}/numeros`} className="btn-primary w-full text-lg uppercase tracking-wide">
              Escolher números
            </Link>
          ) : (
            <p className="rounded-xl bg-stone-100 px-4 py-3 text-center font-semibold text-stone-700">
              {CAMPAIGN_STATUS_LABEL[campaign.status] ?? "Vendas indisponíveis"}
            </p>
          )}
        </div>
      </section>

      {draw && (
        <section aria-labelledby="resultado" className="card mt-6 border-brand-200 bg-brand-50">
          <h2 id="resultado" className="text-xl font-bold">Resultado do sorteio</h2>
          <ul className="mt-3 space-y-2">
            {draw.results.map((r) => (
              <li key={r.position} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3">
                <span className="font-medium">
                  {r.position}º prêmio — {prizeById.get(r.prizeId)?.name ?? "Prêmio"}
                </span>
                <span className="font-mono text-lg font-bold text-brand-700">{formatNumber(r.winnerNumber, campaign.numberDigits)}</span>
              </li>
            ))}
          </ul>
          <Link href={`/campanha/${campaign.slug}/resultado`} className="mt-3 inline-block font-semibold text-brand-700 underline">
            Ver detalhes e como conferir o sorteio
          </Link>
        </section>
      )}

      <section aria-labelledby="historia" className="card mt-6">
        <h2 id="historia" className="text-xl font-bold">História</h2>
        <Paragraphs text={campaign.story} className="prose-text mt-3 text-stone-700" />
      </section>

      <section aria-labelledby="premios" className="card mt-6">
        <h2 id="premios" className="text-xl font-bold">Prêmios</h2>
        <ol className="mt-3 space-y-3">
          {prizes.map((p) => (
            <li key={p.id} className="flex gap-4 rounded-xl border border-stone-200 p-4">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-extrabold text-brand-700" aria-hidden>
                  {p.position}º
                </div>
              )}
              <div>
                <p className="font-bold">
                  <span className="sr-only">{p.position}º prêmio: </span>
                  {p.name}
                </p>
                {p.description && <p className="text-sm text-stone-600">{p.description}</p>}
                <p className="mt-1 text-xs text-stone-500">
                  {PRIZE_ORIGIN_LABEL[p.origin]}
                  {p.originDetails ? ` — ${p.originDetails}` : ""}
                  {p.estimatedValueCents ? ` · Valor estimado: ${formatBRL(p.estimatedValueCents)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sorteio" className="card mt-6">
        <h2 id="sorteio" className="text-xl font-bold">Sorteio</h2>
        <dl className="mt-3 space-y-2 text-stone-700">
          <div>
            <dt className="font-semibold">Método oficial de apuração</dt>
            <dd>{legal?.officialDrawMethod ?? (campaign.drawMethod ? DRAW_METHOD_LABEL[campaign.drawMethod] : "Conforme o regulamento")}</dd>
          </div>
          {campaign.drawScheduledAt && (
            <div>
              <dt className="font-semibold">Data prevista</dt>
              <dd>{formatDateTime(campaign.drawScheduledAt)}</dd>
            </div>
          )}
          <div>
            <dt className="font-semibold">Transparência</dt>
            <dd>
              Antes do sorteio, a lista de números pagos é congelada e publicada com uma impressão digital (hash
              SHA-256), permitindo conferir que ela não foi alterada.
            </dd>
          </div>
        </dl>
        <Link href={`/campanha/${campaign.slug}/regulamento`} className="btn-secondary mt-4 w-full">
          Ler o regulamento
        </Link>
      </section>

      <section aria-labelledby="legal" className="card mt-6">
        <h2 id="legal" className="text-xl font-bold">Informações legais</h2>
        {legal ? (
          <dl className="mt-3 grid gap-3 text-sm text-stone-700 sm:grid-cols-2">
            {legal.operatorName && <Info label="Responsável pela operação" value={legal.operatorName} />}
            {legal.entityName && <Info label="Entidade responsável" value={legal.entityName} />}
            {legal.cnpj && <Info label="CNPJ" value={legal.cnpj} />}
            {legal.authorizationNumber && <Info label="Autorização/certificado" value={legal.authorizationNumber} />}
            {legal.modality && <Info label="Modalidade" value={legal.modality} />}
            {(legal.startDate || legal.endDate) && (
              <Info
                label="Período"
                value={`${legal.startDate ? formatDate(legal.startDate) : "—"} a ${legal.endDate ? formatDate(legal.endDate) : "—"}`}
              />
            )}
            {legal.additionalInfo && (
              <div className="sm:col-span-2">
                <dt className="font-semibold">Informações adicionais</dt>
                <dd>
                  <Paragraphs text={legal.additionalInfo} />
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-stone-600">Consulte o regulamento da campanha.</p>
        )}
      </section>

      {campaign.faq.length > 0 && (
        <section aria-labelledby="faq" className="card mt-6">
          <h2 id="faq" className="text-xl font-bold">Perguntas frequentes</h2>
          <div className="mt-3 divide-y divide-stone-200">
            {campaign.faq.map((f, i) => (
              <details key={i} className="group py-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                  {f.q}
                  <span aria-hidden className="text-brand-600 transition-transform group-open:rotate-45">+</span>
                </summary>
                <Paragraphs text={f.a} className="mt-2 text-stone-700" />
              </details>
            ))}
          </div>
        </section>
      )}

      {(campaign.contactWhatsapp || campaign.contactEmail || campaign.contactInstagram) && (
        <section aria-labelledby="contato" className="card mt-6">
          <h2 id="contato" className="text-xl font-bold">Contato</h2>
          <ul className="mt-3 space-y-2">
            {campaign.contactWhatsapp && (
              <li>
                <a className="font-semibold text-brand-700 underline" href={`https://wa.me/${campaign.contactWhatsapp.replace(/\D/g, "")}`} rel="noopener noreferrer" target="_blank">
                  WhatsApp da organização
                </a>
              </li>
            )}
            {campaign.contactEmail && (
              <li>
                <a className="font-semibold text-brand-700 underline" href={`mailto:${campaign.contactEmail}`}>
                  {campaign.contactEmail}
                </a>
              </li>
            )}
            {campaign.contactInstagram && (
              <li>
                <a className="font-semibold text-brand-700 underline" href={`https://instagram.com/${campaign.contactInstagram.replace(/^@/, "")}`} rel="noopener noreferrer" target="_blank">
                  Instagram {campaign.contactInstagram.startsWith("@") ? campaign.contactInstagram : `@${campaign.contactInstagram}`}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {campaign.salesOpen && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 p-3 backdrop-blur sm:hidden">
          <Link href={`/campanha/${campaign.slug}/numeros`} className="btn-primary w-full uppercase tracking-wide">
            Escolher números · {formatBRL(campaign.priceCents)}
          </Link>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
