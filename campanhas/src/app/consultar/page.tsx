import type { Metadata } from "next";
import { LookupForm } from "@/components/public/lookup-form";

export const metadata: Metadata = { title: "Consultar participação", robots: { index: false } };

export default function LookupPage() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-6">
      <h1 className="text-2xl font-extrabold">Consultar participação</h1>
      <p className="mb-6 text-stone-600">Informe o código do pedido e o WhatsApp usado na compra.</p>
      <LookupForm />
    </div>
  );
}
