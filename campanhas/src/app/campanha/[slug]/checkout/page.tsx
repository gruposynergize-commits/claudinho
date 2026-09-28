import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findCampaignBySlug } from "@/server/campaigns/queries";
import { isPubliclyVisible } from "@/server/campaigns/public";
import { getAdminPreviewAllowed } from "@/server/auth/preview";
import { CheckoutForm } from "@/components/public/checkout-form";

export const metadata: Metadata = { title: "Finalizar", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await findCampaignBySlug(slug);
  if (!campaign || (!isPubliclyVisible(campaign) && !(await getAdminPreviewAllowed()))) notFound();
  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
      <h1 className="text-2xl font-extrabold">Finalizar participação</h1>
      <p className="text-stone-600">{campaign.name}</p>
      <CheckoutForm slug={campaign.slug} campaignName={campaign.name} />
    </div>
  );
}
