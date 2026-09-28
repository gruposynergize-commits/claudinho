import "server-only";
import type { LogLevel } from "@/generated/prisma/client";
import { db } from "./db";

export type LogCategory =
  | "ERROR"
  | "WEBHOOK"
  | "PAYMENT"
  | "ORDER"
  | "RESERVATION"
  | "ADMIN"
  | "AUTH"
  | "DRAW"
  | "SECURITY"
  | "JOB"
  | "SYSTEM";

const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|cpf|signature/i;

/** Remove segredos e dados pessoais antes de registrar. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[profundidade]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) out[k] = "[redigido]";
      else if (/phone|telefone|whatsapp/i.test(k) && typeof v === "string") out[k] = v.replace(/\d(?=\d{4})/g, "*");
      else if (/email/i.test(k) && typeof v === "string") out[k] = v.replace(/^(.).*(@.*)$/, "$1***$2");
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function consoleLine(level: LogLevel, category: LogCategory, message: string, context?: unknown) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...(context !== undefined ? { context } : {}),
  });
  if (level === "ERROR" || level === "CRITICAL") console.error(line);
  else if (level === "WARN") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}

/**
 * Registra no console (JSON estruturado) e na tabela system_logs.
 * Falhas ao gravar o log nunca interrompem o fluxo principal.
 */
export async function logEvent(
  level: LogLevel,
  category: LogCategory,
  message: string,
  context?: Record<string, unknown>,
  requestId?: string,
): Promise<void> {
  const safe = context ? (redact(context) as Record<string, unknown>) : undefined;
  consoleLine(level, category, message, safe);
  if (level === "DEBUG") return;
  try {
    await db().systemLog.create({
      data: {
        level,
        category,
        message: message.slice(0, 1000),
        context: safe as object | undefined,
        requestId: requestId ?? null,
      },
    });
  } catch (e) {
    consoleLine("ERROR", "SYSTEM", "falha ao gravar system_log", { error: (e as Error).message });
  }
}

export function logError(category: LogCategory, message: string, error: unknown, context?: Record<string, unknown>, requestId?: string) {
  const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 8).join("\n") } : { value: String(error) };
  return logEvent("ERROR", category, message, { ...context, error: err }, requestId);
}
