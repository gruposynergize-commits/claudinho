import "server-only";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../errors";
import { logEvent } from "../logger";
import type { Actor } from "../audit";
import { enforceRateLimit } from "../security/rate-limit";
import { assertSameOrigin, clientIp, userAgent } from "../security/request";
import { can, type Permission } from "./rbac";
import { getSessionUser, sessionCookieName, type SessionUser } from "./session";

export type AdminContext = {
  user: SessionUser;
  actor: Actor & { type: "USER" };
};

function actorFor(user: SessionUser, req?: Request): AdminContext["actor"] {
  return {
    type: "USER",
    id: user.id,
    label: user.email,
    ip: req ? clientIp(req) : null,
    userAgent: req ? userAgent(req) : null,
  };
}

/**
 * Autenticação + autorização para Route Handlers do painel. Mutações exigem
 * mesma origem (CSRF) e passam por rate limit por usuário.
 */
export async function requireAdmin(req: NextRequest, permission: Permission): Promise<AdminContext> {
  const method = req.method.toUpperCase();
  const mutation = method !== "GET" && method !== "HEAD";
  if (mutation) assertSameOrigin(req);
  const token = req.cookies.get(sessionCookieName())?.value;
  const user = await getSessionUser(token);
  if (!user) throw new AppError("UNAUTHENTICATED", "Sua sessão expirou. Entre novamente.");
  if (!can(user.role, permission)) {
    await logEvent("WARN", "SECURITY", "Acesso negado a função do painel", {
      user: user.email,
      role: user.role,
      permission,
      path: req.nextUrl.pathname,
    });
    throw new AppError("FORBIDDEN", "Você não tem permissão para esta ação.");
  }
  if (mutation) await enforceRateLimit("adminMutation", user.id);
  return { user, actor: actorFor(user, req) };
}

/** Usuário logado (Server Components). */
export async function currentAdmin(): Promise<SessionUser | null> {
  const jar = await cookies();
  return getSessionUser(jar.get(sessionCookieName())?.value);
}

/** Protege páginas do painel: sem sessão → login; sem permissão → aviso. */
export async function requireAdminPage(permission: Permission): Promise<SessionUser> {
  const user = await currentAdmin();
  if (!user) redirect("/admin/login");
  if (!can(user.role, permission)) {
    throw new AppError("FORBIDDEN", "Você não tem permissão para acessar esta página.");
  }
  return user;
}
