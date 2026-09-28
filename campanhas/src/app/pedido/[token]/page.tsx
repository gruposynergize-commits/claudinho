import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderViewByToken } from "@/server/orders/view";
import { refreshOrderPaymentIfStale } from "@/server/payments/status-check";
import { OrderStatus } from "@/components/public/order-status";

export const metadata: Metadata = { title: "Seu pedido", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await refreshOrderPaymentIfStale(token).catch(() => undefined);
  const view = await getOrderViewByToken(token);
  if (!view) notFound();
  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
      <p className="mb-3 text-sm font-semibold text-stone-500">{view.campaign.name}</p>
      <OrderStatus token={token} initial={view} />
    </div>
  );
}
