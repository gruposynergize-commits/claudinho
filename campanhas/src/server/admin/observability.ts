import "server-only";
import os from "node:os";
import type { LogLevel, Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { getStates } from "../system-state";
import { resolveGatewayCredentials } from "../payments/settings";
import { env } from "../env";

export type AuditFilters = { action?: string; entityType?: string; actor?: string; from?: Date; to?: Date; page?: number };

export async function listAudit(f: AuditFilters) {
  const pageSize = 50;
  const page = Math.max(f.page ?? 1, 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(f.action ? { action: { contains: f.action.toUpperCase() } } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.actor ? { actorLabel: { contains: f.actor, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    db().auditLog.count({ where }),
    db().auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, rows };
}

/** Recalcula a cadeia de hash inteira no banco (evidência de adulteração). */
export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; firstBrokenId: string | null }> {
  const [r] = await db().$queryRaw<{ ok: boolean; checked: bigint; first_broken_id: bigint | null }[]>`SELECT * FROM verify_audit_chain()`;
  return { ok: !!r?.ok, checked: Number(r?.checked ?? 0), firstBrokenId: r?.first_broken_id?.toString() ?? null };
}

export type LogFilters = { level?: LogLevel; category?: string; q?: string; from?: Date; to?: Date; page?: number };

export async function listLogs(f: LogFilters) {
  const pageSize = 50;
  const page = Math.max(f.page ?? 1, 1);
  const where: Prisma.SystemLogWhereInput = {
    ...(f.level ? { level: f.level } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.q ? { message: { contains: f.q, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    db().systemLog.count({ where }),
    db().systemLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, rows };
}

function minutesSince(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 60_000);
}

/** Saúde do sistema para /status (restrito a administradores). */
export async function getSystemStatus() {
  const started = Date.now();
  let dbOk = true;
  let dbLatencyMs: number | null = null;
  try {
    await db().$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - started;
  } catch {
    dbOk = false;
  }

  const states = await getStates([
    "jobs.expire.lastRunAt",
    "jobs.reconcile.lastRunAt",
    "jobs.cleanup.lastRunAt",
    "gateway.lastSuccessAt",
    "gateway.lastErrorAt",
    "gateway.lastError",
    "webhook.lastReceivedAt",
    "webhook.lastValidAt",
    "webhook.lastInvalidAt",
  ]).catch(() => ({}) as Record<string, unknown>);

  const settings = await db().paymentSettings.findMany({ include: { campaign: { select: { name: true, slug: true, status: true } } } }).catch(() => []);
  const gateways = settings.map((s) => {
    let configured = false;
    try {
      configured = !!resolveGatewayCredentials(s);
    } catch {
      configured = false;
    }
    return { campaign: s.campaign.name, mode: s.mode, configured, webhookEnabled: s.webhookEnabled };
  });

  const [pending, reservations, attention, lastSale, recentErrors] = await Promise.all([
    db().order.count({ where: { status: "PENDING_PAYMENT" } }),
    db().reservation.count({ where: { status: "ACTIVE" } }),
    db().payment.count({ where: { requiresAttention: true, resolvedAt: null } }),
    db().order.findFirst({ where: { status: "PAID" }, orderBy: { paidAt: "desc" }, select: { paidAt: true, code: true } }),
    db().systemLog.findMany({
      where: { level: { in: ["ERROR", "CRITICAL"] }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { id: "desc" },
      take: 10,
    }),
  ]);

  const expireAge = minutesSince(states["jobs.expire.lastRunAt"]);
  const reconcileAge = minutesSince(states["jobs.reconcile.lastRunAt"]);
  const warnings: string[] = [];
  if (!dbOk) warnings.push("Banco de dados indisponível");
  if (expireAge === null || expireAge > 5) warnings.push("Rotina de expiração sem execução recente (worker/cron parado?)");
  if (reconcileAge === null || reconcileAge > 10) warnings.push("Conciliação sem execução recente (worker/cron parado?)");
  if (gateways.some((g) => g.mode === "AUTOMATIC" && !g.configured)) warnings.push("Campanha no modo automático sem credenciais do gateway");
  if (attention > 0) warnings.push(`${attention} pagamento(s) aguardando tratamento administrativo`);
  if (process.env.NODE_ENV === "production" && env().TRUST_PROXY_HOPS === 0) {
    warnings.push("TRUST_PROXY_HOPS=0 em produção: rode atrás de um proxy HTTPS e use 1 (limites por IP ficam imprecisos)");
  }

  return {
    overall: !dbOk ? "DOWN" : warnings.length > 0 ? "DEGRADED" : "OPERATIONAL",
    warnings,
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    gateways,
    states,
    counts: { pendingOrders: pending, activeReservations: reservations, attentionPayments: attention },
    lastSale: lastSale ? { at: lastSale.paidAt?.toISOString() ?? null, code: lastSale.code } : null,
    recentErrors: recentErrors.map((e) => ({ at: e.createdAt.toISOString(), level: e.level, category: e.category, message: e.message })),
    runtime: {
      node: process.version,
      platform: `${os.type()} ${os.release()} (${process.arch})`,
      uptimeMinutes: Math.round(process.uptime() / 60),
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
    },
  };
}
