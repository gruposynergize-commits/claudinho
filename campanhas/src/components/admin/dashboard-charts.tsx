"use client";

import { formatBRL } from "@/lib/money";
import { ColumnChart, CumulativeChart, HBarList, StackedBar } from "./charts";

type Daily = { day: string; orders: number; numbers: number; cents: number };

const int = (v: number) => v.toLocaleString("pt-BR");
const brlAxis = (reais: number) => formatBRL(Math.round(reais * 100)).replace(",00", "");
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function DashboardCharts({
  daily,
  total,
  counts,
  pendingByAge,
}: {
  daily: Daily[];
  total: number;
  counts: { available: number; reserved: number; pendingPayment: number; sold: number; cancelled: number };
  pendingByAge: { label: string; count: number }[];
}) {
  const cumulative = daily.map((d, i) => ({
    label: dayLabel(d.day),
    value: daily.slice(0, i + 1).reduce((sum, x) => sum + x.numbers, 0),
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ColumnChart title="Vendas por dia (pedidos pagos)" data={daily.map((d) => ({ label: dayLabel(d.day), value: d.orders }))} format={int} />
      <ColumnChart
        title="Arrecadação por dia (R$)"
        data={daily.map((d) => ({ label: dayLabel(d.day), value: d.cents / 100 }))}
        format={brlAxis}
        integer={false}
      />
      <CumulativeChart title={`Evolução dos números vendidos até ${int(total)}`} data={cumulative} target={total} format={int} />
      <StackedBar
        title="Números por situação"
        format={int}
        segments={[
          { label: "Pagos", value: counts.sold, color: "#e34948" },
          { label: "Aguardando pagamento", value: counts.pendingPayment, color: "#2a78d6" },
          { label: "Reservados", value: counts.reserved, color: "#eda100" },
          { label: "Disponíveis", value: counts.available, color: "#008300" },
        ]}
      />
      <HBarList title="Pagamentos pendentes por tempo de espera" items={pendingByAge.map((p) => ({ label: p.label, value: p.count }))} format={int} />
    </div>
  );
}
