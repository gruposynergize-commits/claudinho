import "server-only";
import type { ActorType } from "@/generated/prisma/client";
import type { Db } from "./db";
import { redact } from "./logger";

export type Actor =
  | { type: "USER"; id: string; label: string; ip?: string | null; userAgent?: string | null }
  | { type: "SYSTEM"; label?: string }
  | { type: "CUSTOMER"; label?: string; ip?: string | null }
  | { type: "GATEWAY"; label?: string };

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", label: "sistema" };

export type AuditEntry = {
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  campaignId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

function toJson(v: unknown): object | undefined {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(redact(v))) as object;
}

/**
 * Grava uma entrada de auditoria. Deve ser chamada dentro da MESMA transação
 * da alteração auditada, para que ambas sejam confirmadas (ou desfeitas)
 * juntas. A tabela é append-only e encadeada por hash (ver migração).
 */
export async function writeAudit(tx: Db, entry: AuditEntry): Promise<void> {
  const actor = entry.actor;
  const actorType: ActorType = actor.type;
  const actorId = actor.type === "USER" ? actor.id : null;
  const actorLabel = actor.type === "USER" ? actor.label : (actor.label ?? actor.type.toLowerCase());
  const ip = actor.type === "USER" || actor.type === "CUSTOMER" ? (actor.ip ?? null) : null;
  const userAgent = actor.type === "USER" ? (actor.userAgent?.slice(0, 300) ?? null) : null;

  await tx.auditLog.create({
    data: {
      actorType,
      actorId,
      actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      campaignId: entry.campaignId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason?.slice(0, 2000) ?? null,
      ip,
      userAgent,
    },
  });
}
