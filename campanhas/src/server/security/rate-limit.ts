import "server-only";
import { db } from "../db";
import { AppError } from "../errors";
import { logEvent } from "../logger";

/**
 * Rate limit por janela fixa armazenado no PostgreSQL — funciona com várias
 * instâncias da aplicação. Uma instrução atômica (INSERT … ON CONFLICT)
 * incrementa e devolve o contador.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const rows = await db().$queryRaw<{ count: number; retry_after: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count,
      GREATEST(1, ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSeconds}::int) - now()))))::int AS retry_after`;
  const row = rows[0];
  const count = Number(row?.count ?? 0);
  return { allowed: count <= limit, count, retryAfter: Number(row?.retry_after ?? windowSeconds) };
}

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 900 },
  loginEmail: { limit: 8, windowSeconds: 900 },
  reservation: { limit: 20, windowSeconds: 600 },
  order: { limit: 12, windowSeconds: 600 },
  lookup: { limit: 15, windowSeconds: 600 },
  lookupCode: { limit: 8, windowSeconds: 600 },
  orderStatus: { limit: 120, windowSeconds: 60 },
  webhook: { limit: 600, windowSeconds: 60 },
  publicRead: { limit: 300, windowSeconds: 60 },
  adminMutation: { limit: 120, windowSeconds: 60 },
} as const;

export async function enforceRateLimit(
  name: keyof typeof RATE_LIMITS,
  identifier: string,
  message = "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.",
): Promise<void> {
  const cfg = RATE_LIMITS[name];
  const res = await hitRateLimit(`${name}:${identifier}`, cfg.limit, cfg.windowSeconds);
  if (!res.allowed) {
    // Registra só a primeira violação da janela para não inundar os logs.
    if (res.count === cfg.limit + 1) {
      void logEvent("WARN", "SECURITY", `Rate limit excedido: ${name}`, { identifier: identifier.slice(0, 16) });
    }
    throw new AppError("RATE_LIMITED", message, { details: { retryAfter: res.retryAfter } });
  }
}

export async function cleanupRateLimits(): Promise<number> {
  return db().$executeRaw`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
}
