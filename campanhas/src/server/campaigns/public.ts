import "server-only";
import type { Campaign } from "@/generated/prisma/client";
import { db } from "../db";
import { findCampaignBySlug, getNumberCounts, isSalesOpen, type NumberCounts } from "./queries";

/** Campanhas em rascunho ou removidas não aparecem para o público. */
export function isPubliclyVisible(c: Pick<Campaign, "status" | "deletedAt">): boolean {
  return c.deletedAt === null && c.status !== "DRAFT";
}

export type FaqItem = { q: string; a: string };

function parseFaq(v: unknown): FaqItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is FaqItem => !!x && typeof x === "object" && typeof (x as FaqItem).q === "string" && typeof (x as FaqItem).a === "string")
    .slice(0, 50);
}

/**
 * Dados da página pública. Somente informações públicas: nada de dados de
 * compradores; vencedores aparecem apenas pelo número.
 */
export async function getPublicCampaignPage(slug: string, opts: { preview?: boolean } = {}) {
  const campaign = await findCampaignBySlug(slug);
  if (!campaign) return null;
  if (!isPubliclyVisible(campaign) && !opts.preview) return { hidden: true as const, campaign: { name: campaign.name, slug: campaign.slug } };

  const [counts, prizes, legal, draw] = await Promise.all([
    getNumberCounts(campaign.id),
    db().prize.findMany({ where: { campaignId: campaign.id, deletedAt: null }, orderBy: { position: "asc" } }),
    db().legalInformation.findUnique({ where: { campaignId: campaign.id } }),
    // Sorteio "vivo" (anulados ficam só no histórico da página de resultado).
    db().draw.findFirst({
      where: { campaignId: campaign.id, status: { not: "FAILED" } },
      include: {
        snapshot: { select: { eligibleNumbersCount: true, eligibleNumbersHash: true, officialReference: true, createdAt: true } },
        results: { select: { prizePosition: true, winnerNumber: true, prizeId: true }, orderBy: { prizePosition: "asc" } },
      },
    }),
  ]);

  return {
    hidden: false as const,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      shortDescription: campaign.shortDescription,
      story: campaign.story,
      imageUrl: campaign.imageUrl,
      status: campaign.status,
      salesOpen: isSalesOpen(campaign),
      priceCents: campaign.priceCents,
      totalNumbers: campaign.totalNumbers,
      numberDigits: campaign.numberDigits,
      maxNumbersPerOrder: campaign.maxNumbersPerOrder,
      salesEndAt: campaign.salesEndAt?.toISOString() ?? null,
      drawScheduledAt: campaign.drawScheduledAt?.toISOString() ?? null,
      drawMethod: campaign.drawMethod,
      contactWhatsapp: campaign.contactWhatsapp,
      contactEmail: campaign.contactEmail,
      contactInstagram: campaign.contactInstagram,
      faq: parseFaq(campaign.faq),
    },
    counts: counts satisfies NumberCounts,
    prizes: prizes.map((p) => ({
      id: p.id,
      position: p.position,
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl,
      estimatedValueCents: p.estimatedValueCents,
      origin: p.origin,
      originDetails: p.originDetails,
    })),
    legal:
      legal && legal.showOnPublicPage
        ? {
            operatorName: legal.operatorName,
            entityName: legal.entityName,
            cnpj: legal.cnpj,
            authorizationNumber: legal.authorizationNumber,
            modality: legal.modality,
            officialDrawMethod: legal.officialDrawMethod,
            startDate: legal.startDate?.toISOString() ?? null,
            endDate: legal.endDate?.toISOString() ?? null,
            additionalInfo: legal.additionalInfo,
            hasRegulation: !!legal.regulation || !!legal.regulationUrl,
            privacyContact: legal.privacyContact,
          }
        : null,
    // O hash da lista congelada é público desde o congelamento (antes do
    // resultado existir); os vencedores aparecem após a homologação.
    draw: draw?.snapshot
      ? {
          status: draw.status,
          frozenAt: draw.snapshot.createdAt.toISOString(),
          finalizedAt: draw.finalizedAt?.toISOString() ?? null,
          eligibleCount: draw.snapshot.eligibleNumbersCount,
          hash: draw.snapshot.eligibleNumbersHash,
          officialReference: draw.snapshot.officialReference,
          results:
            draw.status === "FINALIZED"
              ? draw.results.map((r) => ({ position: r.prizePosition, winnerNumber: r.winnerNumber, prizeId: r.prizeId }))
              : [],
        }
      : null,
  };
}

export type PublicCampaignPage = NonNullable<Awaited<ReturnType<typeof getPublicCampaignPage>>>;
