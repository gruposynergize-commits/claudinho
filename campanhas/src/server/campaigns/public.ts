import type { Campaign } from "@/generated/prisma/client";

/** Campanhas em rascunho ou removidas não aparecem para o público. */
export function isPubliclyVisible(c: Pick<Campaign, "status" | "deletedAt">): boolean {
  return c.deletedAt === null && c.status !== "DRAFT";
}
