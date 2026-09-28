import "server-only";
import { db } from "../db";
import { getNumberCounts, getRaisedCents } from "../campaigns/queries";

export type DailyPoint = { day: string; orders: number; numbers: number; cents: number };

export type Dashboard = {
  counts: Awaited<ReturnType<typeof getNumberCounts>>;
  raisedCents: number;
  paidOrders: number;
  pendingOrders: number;
  awaitingManualCheck: number;
  buyers: number;
  attention: number;
  daily: DailyPoint[];
  pendingByAge: { label: string; count: number }[];
  lastSaleAt: string | null;
};

/**
 * Indicadores do painel. Tudo calculado no banco a partir dos registros
 * (nenhum contador paralelo que possa divergir).
 */
export async function getDashboard(campaignId: string): Promise<Dashboard> {
  const [counts, raisedCents, orderStats, buyers, attention, daily, pendingAge, lastSale] = await Promise.all([
    getNumberCounts(campaignId),
    getRaisedCents(campaignId),
    db().$queryRaw<{ paid: bigint; pending: bigint; awaiting: bigint }[]>`
      SELECT count(*) FILTER (WHERE status = 'PAID') AS paid,
             count(*) FILTER (WHERE status = 'PENDING_PAYMENT') AS pending,
             count(*) FILTER (WHERE status = 'PENDING_PAYMENT' AND payment_mode = 'MANUAL'
                              AND customer_reported_paid_at IS NOT NULL) AS awaiting
      FROM orders WHERE campaign_id = ${campaignId}::uuid`,
    db().$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT customer_id) AS n FROM orders WHERE campaign_id = ${campaignId}::uuid AND status = 'PAID'`,
    db().$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.campaign_id = ${campaignId}::uuid AND p.requires_attention AND p.resolved_at IS NULL`,
    db().$queryRaw<{ day: string; orders: bigint; numbers: bigint; cents: bigint }[]>`
      SELECT to_char(date_trunc('day', paid_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
             count(*) AS orders, sum(quantity)::bigint AS numbers, sum(total_cents)::bigint AS cents
      FROM orders WHERE campaign_id = ${campaignId}::uuid AND status = 'PAID'
      GROUP BY 1 ORDER BY 1`,
    db().$queryRaw<{ bucket: string; n: bigint }[]>`
      SELECT CASE
          WHEN payment_mode = 'MANUAL' AND customer_reported_paid_at IS NOT NULL THEN 'e_conferencia'
          WHEN created_at > now() - interval '10 minutes' THEN 'a_10'
          WHEN created_at > now() - interval '30 minutes' THEN 'b_30'
          WHEN created_at > now() - interval '60 minutes' THEN 'c_60'
          ELSE 'd_mais' END AS bucket, count(*) AS n
      FROM orders WHERE campaign_id = ${campaignId}::uuid AND status = 'PENDING_PAYMENT'
      GROUP BY 1`,
    db().order.findFirst({
      where: { campaignId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      select: { paidAt: true },
    }),
  ]);

  const byBucket = Object.fromEntries(pendingAge.map((r) => [r.bucket, Number(r.n)]));
  return {
    counts,
    raisedCents,
    paidOrders: Number(orderStats[0]?.paid ?? 0),
    pendingOrders: Number(orderStats[0]?.pending ?? 0),
    awaitingManualCheck: Number(orderStats[0]?.awaiting ?? 0),
    buyers: Number(buyers[0]?.n ?? 0),
    attention: Number(attention[0]?.n ?? 0),
    daily: fillDays(
      daily.map((d) => ({ day: d.day, orders: Number(d.orders), numbers: Number(d.numbers), cents: Number(d.cents) })),
    ),
    pendingByAge: [
      { label: "Até 10 min", count: byBucket.a_10 ?? 0 },
      { label: "10–30 min", count: byBucket.b_30 ?? 0 },
      { label: "30–60 min", count: byBucket.c_60 ?? 0 },
      { label: "Mais de 1 h", count: byBucket.d_mais ?? 0 },
      { label: "Aguardando conferência (Pix manual)", count: byBucket.e_conferencia ?? 0 },
    ],
    lastSaleAt: lastSale?.paidAt?.toISOString() ?? null,
  };
}

/** Preenche dias sem vendas com zero (eixo de tempo contínuo). */
export function fillDays(points: DailyPoint[]): DailyPoint[] {
  if (points.length === 0) return [];
  const byDay = new Map(points.map((p) => [p.day, p]));
  const out: DailyPoint[] = [];
  const start = new Date(`${points[0]!.day}T12:00:00Z`);
  const end = new Date(`${points[points.length - 1]!.day}T12:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, orders: 0, numbers: 0, cents: 0 });
  }
  return out.slice(-90);
}
