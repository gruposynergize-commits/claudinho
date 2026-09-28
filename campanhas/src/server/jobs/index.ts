import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { logError, logEvent } from "../logger";
import { markNow } from "../system-state";
import { expireCartReservations } from "../numbers/reservations";
import { expireManualOrders } from "../orders/lifecycle";
import { expireAutomaticOrders } from "../payments/expire";
import { reconcilePayments } from "../payments/reconcile";
import { cleanupRateLimits } from "../security/rate-limit";
import { runRetention } from "../lgpd/retention";

export const JOBS = ["expire", "reconcile", "cleanup"] as const;
export type JobName = (typeof JOBS)[number];

/**
 * Lease no banco: garante que a mesma rotina não rode em paralelo em várias
 * instâncias (worker + cron, múltiplos containers).
 */
async function acquireLease(job: JobName, owner: string, seconds: number): Promise<boolean> {
  const rows = await db().$queryRaw<{ key: string }[]>`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (${`lease:${job}`}, jsonb_build_object('until', now() + make_interval(secs => ${seconds}::int), 'owner', ${owner}::text), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE (system_state.value->>'until')::timestamptz < now() OR system_state.value->>'owner' = ${owner}
    RETURNING key`;
  return rows.length > 0;
}

async function releaseLease(job: JobName, owner: string): Promise<void> {
  await db().$executeRaw`
    UPDATE system_state SET value = jsonb_build_object('until', now(), 'owner', ${owner}::text)
    WHERE key = ${`lease:${job}`} AND value->>'owner' = ${owner}`;
}

async function execute(job: JobName): Promise<unknown> {
  switch (job) {
    case "expire": {
      const reservations = await expireCartReservations();
      const manual = await expireManualOrders();
      const automatic = await expireAutomaticOrders();
      await markNow("jobs.expire.lastRunAt");
      return { reservations, manual, automatic };
    }
    case "reconcile":
      return reconcilePayments();
    case "cleanup": {
      const rateLimits = await cleanupRateLimits();
      const sessions = await db().$executeRaw`DELETE FROM sessions WHERE expires_at < now()`;
      const logs = await db().$executeRaw`
        DELETE FROM system_logs
        WHERE (level IN ('DEBUG','INFO') AND created_at < now() - interval '60 days')
           OR created_at < now() - interval '365 days'`;
      const retention = await runRetention();
      await markNow("jobs.cleanup.lastRunAt");
      return { rateLimits, sessions, logs, retention };
    }
  }
}

export async function runJob(job: JobName): Promise<{ ran: boolean; result?: unknown }> {
  const owner = randomUUID();
  if (!(await acquireLease(job, owner, 300))) return { ran: false };
  const started = Date.now();
  try {
    const result = await execute(job);
    const ms = Date.now() - started;
    if (ms > 30_000) await logEvent("WARN", "JOB", `Rotina ${job} lenta`, { ms });
    return { ran: true, result };
  } catch (e) {
    await logError("JOB", `Rotina ${job} falhou`, e);
    throw e;
  } finally {
    await releaseLease(job, owner).catch(() => undefined);
  }
}
