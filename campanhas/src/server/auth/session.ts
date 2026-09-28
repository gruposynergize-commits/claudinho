import "server-only";
import type { UserRole } from "@/generated/prisma/client";
import { db } from "../db";
import { appUrl } from "../env";
import { randomToken, sha256Hex } from "../crypto";

/** Sessão absoluta de 12 h; expira após 2 h sem atividade. */
export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_IDLE_MINUTES = 120;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
};

export function isSecureOrigin(): boolean {
  return appUrl().protocol === "https:";
}

/** `__Host-` exige Secure + Path=/ + sem Domain: impede sobrescrita por subdomínios. */
export function sessionCookieName(): string {
  return isSecureOrigin() ? "__Host-campanhas_session" : "campanhas_session";
}

export function sessionCookie(token: string, expires: Date): string {
  const attrs = [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (isSecureOrigin()) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearedSessionCookie(): string {
  const attrs = [`${sessionCookieName()}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureOrigin()) attrs.push("Secure");
  return attrs.join("; ");
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_HOURS * 3600_000);
  await db().session.create({
    data: { id: sha256Hex(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
  });
  return { token, expiresAt };
}

/** Valida o token do cookie. Sessões vencidas/ociosas ou de usuário inativo são recusadas. */
export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 30 || token.length > 100) return null;
  const id = sha256Hex(token);
  const session = await db().session.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true, role: true, active: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + SESSION_IDLE_MINUTES * 60_000;
  if (session.expiresAt.getTime() <= now || idleLimit <= now || !session.user.active) {
    await db().session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  if (now - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db().session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, sessionId: id };
}

export async function revokeSessionToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db().session.deleteMany({ where: { id: sha256Hex(token) } });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db().session.deleteMany({ where: { userId } });
}
