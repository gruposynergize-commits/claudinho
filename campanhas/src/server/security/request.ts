import "server-only";
import { isIP } from "node:net";
import { env, appUrl } from "../env";
import { AppError } from "../errors";
import { hashIdentifier } from "../crypto";

/**
 * IP do cliente a partir do X-Forwarded-For.
 *
 * Com TRUST_PROXY_HOPS = N, usa a N-ésima entrada a partir da direita — a que
 * foi escrita pelo proxy confiável mais externo (Nginx anexa, Vercel
 * sobrescreve; em ambos os casos, N=1). Entradas mais à esquerda podem ter sido
 * forjadas pelo cliente e são ignoradas.
 *
 * Com N = 0 (sem proxy), o Next.js preenche o header com o IP do socket
 * apenas se ele não vier na requisição; o valor pode ser forjado. Por isso a
 * produção deve rodar atrás de um proxy HTTPS com N ≥ 1 (ver README).
 */
export function clientIp(req: Request): string {
  const hops = env().TRUST_PROXY_HOPS;
  const entries = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - Math.max(hops, 1)];
  if (candidate && isIP(candidate)) return candidate;
  const real = req.headers.get("x-real-ip")?.trim();
  if (hops > 0 && real && isIP(real)) return real;
  return "unknown";
}

export function clientIpHash(req: Request): string {
  return hashIdentifier("ip", clientIp(req));
}

export function userAgent(req: Request): string | null {
  return req.headers.get("user-agent")?.slice(0, 300) ?? null;
}

/**
 * Proteção CSRF para rotas autenticadas por cookie: mutações precisam vir da
 * mesma origem da aplicação (Origin ou, na ausência, Referer).
 */
export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const expected = appUrl().origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw new AppError("CSRF", "Requisição bloqueada por segurança.");
    return;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin === expected) return;
    } catch {
      // cai no erro abaixo
    }
  }
  throw new AppError("CSRF", "Requisição bloqueada por segurança.");
}
