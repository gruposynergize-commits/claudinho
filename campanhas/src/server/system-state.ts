import "server-only";
import { db } from "./db";

/** Chaves conhecidas de estado operacional (exibidas em /status). */
export type StateKey =
  | "jobs.expire.lastRunAt"
  | "jobs.reconcile.lastRunAt"
  | "jobs.cleanup.lastRunAt"
  | "gateway.lastSuccessAt"
  | "gateway.lastErrorAt"
  | "gateway.lastError"
  | "webhook.lastReceivedAt"
  | "webhook.lastValidAt"
  | "webhook.lastInvalidAt";

export async function setState(key: StateKey, value: unknown): Promise<void> {
  const json = JSON.parse(JSON.stringify(value ?? null)) as object;
  try {
    await db().systemState.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  } catch {
    // Estado operacional é informativo; nunca derruba o fluxo principal.
  }
}

export async function getStates(keys: StateKey[]): Promise<Record<string, unknown>> {
  const rows = await db().systemState.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function markNow(key: StateKey): Promise<void> {
  await setState(key, new Date().toISOString());
}
