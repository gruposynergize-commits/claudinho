"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBox, useAdminAction } from "./ui";

/** "Reservar número": pedido Pix manual criado pelo operador em nome do comprador. */
export function AdminOrderForm({ campaignId, maxPerOrder }: { campaignId: string; maxPerOrder: number }) {
  const router = useRouter();
  const { run, busy, error } = useAdminAction();
  const [numbers, setNumbers] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);

  const parsed = numbers
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const valid = parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n >= 0) && parsed.length <= maxPerOrder;

  return (
    <form
      className="card max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run<{ orderId: string }>("/api/admin/orders", {
          campaignId,
          numbers: parsed,
          customer: { name, phone, ...(email ? { email } : {}) },
          customerAcceptedTerms: accepted,
        });
        if (r) router.push(`/admin/pedidos/${r.orderId}`);
      }}
    >
      <div>
        <label className="label" htmlFor="nums">Números (separados por vírgula ou espaço)</label>
        <input id="nums" className="input font-mono" placeholder="10, 345, 782" value={numbers} onChange={(e) => setNumbers(e.target.value)} required />
        <p className="mt-1 text-xs text-stone-500">{parsed.length} número(s). Máximo por pedido: {maxPerOrder}. A reserva é tudo ou nada.</p>
      </div>
      <div>
        <label className="label" htmlFor="name">Nome completo do comprador</label>
        <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="phone">WhatsApp</label>
        <input id="phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="email">E-mail (opcional)</label>
        <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 accent-brand-600" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        O comprador leu e aceitou o regulamento e a política de privacidade (fica registrado na auditoria em seu nome).
      </label>
      <ErrorBox error={error} />
      <button type="submit" className="btn-primary w-full" disabled={busy || !valid || !accepted}>
        {busy ? "Reservando…" : "Reservar e gerar Pix manual"}
      </button>
      <p className="text-xs text-stone-500">O pedido fica aguardando pagamento; a confirmação exige a conferência manual auditada.</p>
    </form>
  );
}
