import "server-only";
import { randomInt } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";
import { dbErrorInfo } from "./db-errors";

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  const e = env();
  const adapter = new PrismaPg({
    connectionString: e.DATABASE_URL,
    max: e.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter, log: ["error"] });
}

/** Cliente único por processo (reutilizado entre hot reloads em desenvolvimento). */
export function db(): PrismaClient {
  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createClient();
  }
  return globalForPrisma.__prisma;
}

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
    globalForPrisma.__prisma = undefined;
  }
}

const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]);

/**
 * Executa uma transação READ COMMITTED com nova tentativa automática em
 * deadlock/serialização. As funções passadas devem ser idempotentes em
 * relação a efeitos externos (não chamar APIs de terceiros aqui dentro).
 */
export async function transaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: opts.timeoutMs ?? 20_000,
      });
    } catch (e) {
      const info = dbErrorInfo(e);
      const retryable = info && (RETRYABLE_PG_CODES.has(info.pgCode ?? "") || info.prismaCode === "P2034");
      if (!retryable || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, (20 + randomInt(80)) * (attempt + 1)));
    }
  }
}

/**
 * Ativa, somente dentro da transação corrente, a flag exigida pelos triggers
 * para operações administrativas excepcionais (sempre acompanhadas de AuditLog).
 */
export async function allowExceptionalOperation(tx: Tx, reason: string): Promise<void> {
  const value = reason.trim().slice(0, 200) || "exceptional";
  await tx.$executeRaw`SELECT set_config('app.exceptional_reason', ${value}, true)`;
}

/** Ativa a flag das transições de números exclusivas do sorteio. */
export async function allowDrawOperation(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.draw_operation', 'on', true)`;
}
