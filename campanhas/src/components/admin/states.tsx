export function NoPermission() {
  return (
    <div className="card text-center">
      <h1 className="text-xl font-bold">Sem permissão</h1>
      <p className="mt-2 text-stone-600">Seu papel não permite acessar esta área. Fale com um administrador.</p>
    </div>
  );
}

export function NoCampaign() {
  return (
    <div className="card text-center">
      <h1 className="text-xl font-bold">Nenhuma campanha cadastrada</h1>
      <p className="mt-2 text-stone-600">Rode o seed inicial (npm run db:seed) ou cadastre uma campanha.</p>
    </div>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-stone-600">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

const ORDER_BADGE: Record<string, string> = {
  PENDING_PAYMENT: "bg-blue-100 text-blue-900",
  PAID: "bg-green-100 text-green-900",
  EXPIRED: "bg-stone-200 text-stone-800",
  CANCELLED: "bg-stone-200 text-stone-800",
  REFUNDED: "bg-amber-100 text-amber-900",
  ERROR: "bg-red-100 text-red-900",
};

export function OrderBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge ${ORDER_BADGE[status] ?? "bg-stone-200 text-stone-800"}`}>{label}</span>;
}
