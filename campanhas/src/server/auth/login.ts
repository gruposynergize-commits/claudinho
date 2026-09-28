import "server-only";
import { db, transaction } from "../db";
import { AppError } from "../errors";
import { logEvent } from "../logger";
import { writeAudit } from "../audit";
import { enforceRateLimit } from "../security/rate-limit";
import { clientIp, clientIpHash, userAgent } from "../security/request";
import { dummyVerify, verifyPassword } from "./password";
import { createSession } from "./session";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const INVALID = "E-mail ou senha inválidos, ou acesso temporariamente bloqueado.";

/**
 * Login do painel. Mensagem única para e-mail inexistente, senha errada e
 * conta bloqueada (não revela quais e-mails existem). Bloqueio temporário
 * após tentativas seguidas + rate limit por IP e por e-mail.
 */
export async function login(req: Request, emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  await enforceRateLimit("login", clientIpHash(req), "Muitas tentativas de login. Aguarde alguns minutos.");
  await enforceRateLimit("loginEmail", email, "Muitas tentativas de login. Aguarde alguns minutos.");

  const user = await db().user.findUnique({ where: { email } });
  if (!user || !user.active) {
    await dummyVerify(password);
    await logEvent("WARN", "AUTH", "Login recusado (usuário inexistente ou inativo)", { email });
    throw new AppError("UNAUTHENTICATED", INVALID);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyVerify(password);
    await logEvent("WARN", "AUTH", "Login recusado (conta bloqueada)", { email });
    throw new AppError("UNAUTHENTICATED", INVALID);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failures = user.failedLogins + 1;
    const lock = failures >= MAX_FAILURES;
    await db().user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    await logEvent(lock ? "ERROR" : "WARN", "SECURITY", lock ? "Conta bloqueada após tentativas de login" : "Senha incorreta no login", {
      email,
      failures,
    });
    throw new AppError("UNAUTHENTICATED", INVALID);
  }

  const session = await createSession(user.id, { ip: clientIp(req), userAgent: userAgent(req) });
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await writeAudit(tx, {
      actor: { type: "USER", id: user.id, label: user.email, ip: clientIp(req), userAgent: userAgent(req) },
      action: "USER_LOGIN",
      entityType: "user",
      entityId: user.id,
    });
  });
  return { ...session, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}
