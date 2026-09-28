import "server-only";
import type { Campaign } from "@/generated/prisma/client";
import { db } from "../db";
import { AppError } from "../errors";

/** Campanhas não removidas, mais recentes primeiro (seletor do painel). */
export async function listAdminCampaigns() {
  return db().campaign.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, name: true, status: true },
  });
}

/** Campanha em foco no painel: `?c=<slug>` ou a mais recente. */
export async function resolveAdminCampaign(slug?: string | null): Promise<Campaign | null> {
  if (slug) {
    const c = await db().campaign.findFirst({ where: { slug, deletedAt: null } });
    if (c) return c;
  }
  return db().campaign.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
}

export async function requireCampaignById(id: string): Promise<Campaign> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
  const c = await db().campaign.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
  return c;
}
