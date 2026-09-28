import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findCampaignBySlug } from "@/server/campaigns/queries";
import { isPubliclyVisible } from "@/server/campaigns/public";
import { getAdminPreviewAllowed } from "@/server/auth/preview";
import { NumberPicker } from "@/components/public/number-picker";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Escolher números" };

export default async function NumbersPage({ params }: Props) {
  const { slug } = await params;
  const campaign = await findCampaignBySlug(slug);
  if (!campaign || (!isPubliclyVisible(campaign) && !(await getAdminPreviewAllowed()))) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <Link href={`/campanha/${campaign.slug}`} className="text-sm font-semibold text-brand-700">
        ← {campaign.name}
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold">Escolha seus números</h1>
      <p className="text-stone-600">Toque nos números disponíveis. Você pode escolher quantos quiser (até {campaign.maxNumbersPerOrder} por pedido).</p>
      <NumberPicker
        slug={campaign.slug}
        priceCents={campaign.priceCents}
        firstNumber={campaign.firstNumber}
        totalNumbers={campaign.totalNumbers}
        numberDigits={campaign.numberDigits}
        maxPerOrder={campaign.maxNumbersPerOrder}
        minPerOrder={campaign.minNumbersPerOrder}
      />
    </div>
  );
}
