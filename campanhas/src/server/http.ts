import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { AppError, GENERIC_ERROR_MESSAGE } from "./errors";
import { logError } from "./logger";

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

type Handler<C> = (req: NextRequest, ctx: C, requestId: string) => Promise<Response>;

/**
 * Envolve um Route Handler: converte AppError em resposta JSON amigável,
 * esconde erros inesperados (sem stack trace para o cliente) e registra
 * detalhes técnicos somente no servidor.
 */
export function handler<C = RouteContext>(fn: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const res = await fn(req, ctx, requestId);
      res.headers.set("x-request-id", requestId);
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      return res;
    } catch (e) {
      return errorResponse(e, requestId, req);
    }
  };
}

export function errorResponse(e: unknown, requestId: string, req?: NextRequest): Response {
  if (e instanceof AppError) {
    if (e.status >= 500) {
      void logError("ERROR", e.message, e.cause ?? e, { path: req?.nextUrl.pathname, ...e.internal }, requestId);
    }
    const res = NextResponse.json(
      {
        ok: false,
        error: { code: e.code, message: e.userMessage, ...(e.details ? { details: e.details } : {}) },
        requestId,
      },
      { status: e.status },
    );
    if (e.code === "RATE_LIMITED" && typeof e.details?.retryAfter === "number") {
      res.headers.set("retry-after", String(e.details.retryAfter));
    }
    res.headers.set("x-request-id", requestId);
    res.headers.set("cache-control", "no-store");
    return res;
  }
  void logError("ERROR", "Erro inesperado em rota", e, { path: req?.nextUrl.pathname, method: req?.method }, requestId);
  const res = NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: GENERIC_ERROR_MESSAGE }, requestId },
    { status: 500 },
  );
  res.headers.set("x-request-id", requestId);
  res.headers.set("cache-control", "no-store");
  return res;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

/**
 * Lê e valida o corpo JSON com limite de tamanho. Campos desconhecidos são
 * rejeitados pelos schemas estritos (ex.: tentativa de enviar preço/status).
 */
export async function parseJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number } = {},
): Promise<z.infer<S>> {
  const maxBytes = opts.maxBytes ?? 16_384;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Requisição muito grande.");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Requisição muito grande.");
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION", "Dados inválidos. Revise o formulário e tente novamente.");
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_";
      if (!fields[key]) fields[key] = issue.code === "unrecognized_keys" ? "Campo não permitido." : issue.message;
    }
    throw new AppError("VALIDATION", "Dados inválidos. Revise o formulário e tente novamente.", {
      details: { fields },
    });
  }
  return result.data;
}
