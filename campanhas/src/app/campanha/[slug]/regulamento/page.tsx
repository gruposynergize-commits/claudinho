import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { findCampaignBySlug } from "@/server/campaigns/queries";
import { isPubliclyVisible } from "@/server/campaigns/public";
import { getAdminPreviewAllowed } from "@/server/auth/preview";
import { Paragraphs } from "@/components/public/paragraphs";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Regulamento" };

export default async function RegulationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await findCampaignBySlug(slug);
  if (!campaign || (!isPubliclyVisible(campaign) && !(await getAdminPreviewAllowed()))) notFound();
  const legal = await db().legalInformation.findUnique({ where: { campaignId: campaign.id } });

  return (
    <article className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <Link href={`/campanha/${campaign.slug}`} className="text-sm font-semibold text-brand-700">← {campaign.name}</Link>
      <h1 className="mt-2 text-2xl font-extrabold">Regulamento — {campaign.name}</h1>
      {legal?.updatedAt && <p className="text-sm text-stone-500">Atualizado em {formatDate(legal.updatedAt)}</p>}
      <div className="card mt-6">
        {legal?.regulation ? (
          <Paragraphs text={legal.regulation} className="prose-text text-stone-800" />
        ) : (
          <p className="text-stone-600">O organizador ainda não publicou o texto do regulamento nesta página.</p>
        )}
        {legal?.regulationUrl && (
          <p className="mt-4">
            <a href={legal.regulationUrl} className="font-semibold text-brand-700 underline" rel="noopener noreferrer" target="_blank">
              Documento oficial do regulamento
            </a>
          </p>
        )}
      </div>
    </article>
  );
}
