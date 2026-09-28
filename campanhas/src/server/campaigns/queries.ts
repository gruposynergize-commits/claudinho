import "server-only";
import type { Campaign, NumberStatus } from "@/generated/prisma/client";
import { db, type Db } from "../db";
import { AppError } from "../errors";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function findCampaignBySlug(slug: string, client: Db = db()): Promise<Campaign | null> {
  if (!SLUG_RE.test(slug) || slug.length > 60) return null;
  return client.campaign.findFirst({ where: { slug, deletedAt: null } });
}

export async function requireCampaignBySlug(slug: string, client: Db = db()): Promise<Campaign> {
  const c = await findCampaignBySlug(slug, client);
  if (!c) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
  return c;
}

export function lastNumber(c: Pick<Campaign, "firstNumber" | "totalNumbers">): number {
  return c.firstNumber + c.totalNumbers - 1;
}

/** Vendas abertas: status ACTIVE e dentro da janela configurada. */
export function isSalesOpen(
  c: Pick<Campaign, "status" | "salesStartAt" | "salesEndAt">,
  now: Date = new Date(),
): boolean {
  if (c.status !== "ACTIVE") return false;
  if (c.salesStartAt && now < c.salesStartAt) return false;
  if (c.salesEndAt && now >= c.salesEndAt) return false;
  return true;
}

export type NumberCounts = {
  total: number;
  available: number;
  reserved: number;
  pendingPayment: number;
  /** Pagos (inclui sorteados/vencedores). */
  sold: number;
  cancelled: number;
};

export async function getNumberCounts(campaignId: string, client: Db = db()): Promise<NumberCounts> {
  const rows = await client.$queryRaw<{ status: NumberStatus; n: bigint }[]>`
    SELECT status, count(*) AS n FROM campaign_numbers WHERE campaign_id = ${campaignId}::uuid GROUP BY status`;
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<NumberStatus, number>>;
  const counts = {
    available: by.AVAILABLE ?? 0,
    reserved: by.RESERVED ?? 0,
    pendingPayment: by.PENDING_PAYMENT ?? 0,
    sold: (by.PAID ?? 0) + (by.DRAWN ?? 0) + (by.WINNER ?? 0),
    cancelled: by.CANCELLED ?? 0,
  };
  return {
    total: counts.available + counts.reserved + counts.pendingPayment + counts.sold + counts.cancelled,
    ...counts,
  };
}

export async function getRaisedCents(campaignId: string, client: Db = db()): Promise<number> {
  const rows = await client.$queryRaw<{ total: bigint | null }[]>`
    SELECT sum(total_cents)::bigint AS total FROM orders WHERE campaign_id = ${campaignId}::uuid AND status = 'PAID'`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Mapa compacto de estados para a grade pública: um caractere por número,
 * na ordem da numeração. A = disponível, R = reservado, P = aguardando
 * pagamento, S = pago/vendido, X = indisponível (bloqueado).
 * Nenhum dado pessoal é exposto.
 */
const STATUS_CHAR: Record<NumberStatus, string> = {
  AVAILABLE: "A",
  RESERVED: "R",
  PENDING_PAYMENT: "P",
  PAID: "S",
  DRAWN: "S",
  WINNER: "S",
  CANCELLED: "X",
};

const statusCache = new Map<string, { at: number; value: string }>();
const STATUS_CACHE_MS = 1000;

export async function getNumberStatusString(campaignId: string): Promise<string> {
  const cached = statusCache.get(campaignId);
  const now = Date.now();
  if (cached && now - cached.at < STATUS_CACHE_MS) return cached.value;
  const rows = await db().$queryRaw<{ status: NumberStatus }[]>`
    SELECT status FROM campaign_numbers WHERE campaign_id = ${campaignId}::uuid ORDER BY number`;
  const value = rows.map((r) => STATUS_CHAR[r.status]).join("");
  statusCache.set(campaignId, { at: now, value });
  return value;
}

export function invalidateStatusCache(campaignId: string): void {
  statusCache.delete(campaignId);
}
