import "server-only";
import { z } from "zod";
import type { UserRole } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "../db";
import { isUniqueViolation } from "../db-errors";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { revokeAllSessions } from "../auth/session";
import { logEvent } from "../logger";
import { enforceRateLimit } from "../security/rate-limit";

export const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "E-mail inválido." })),
  name: z.string().trim().min(2).max(100),
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]),
  password: z.string().min(1).max(200),
});

export async function listUsers() {
  return db().user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, lockedUntil: true, createdAt: true },
  });
}

export async function createUser(input: z.infer<typeof createUserSchema>, actor: Actor & { type: "USER" }) {
  const problem = passwordProblem(input.password);
  if (problem) throw new AppError("VALIDATION", problem);
  const passwordHash = await hashPassword(input.password);
  try {
    await transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, name: input.name, role: input.role, passwordHash } });
      await writeAudit(tx, { actor, action: "USER_CREATED", entityType: "user", entityId: u.id, after: { email: u.email, role: u.role } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe um usuário com este e-mail.");
    throw e;
  }
}

async function activeAdminCount(tx: Tx): Promise<number> {
  return tx.user.count({ where: { role: "ADMIN", active: true } });
}

export async function updateUser(
  userId: string,
  input: { role?: UserRole; active?: boolean; name?: string },
  actor: Actor & { type: "USER" },
) {
  await transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
    if (userId === actor.id && (input.active === false || (input.role && input.role !== u.role))) {
      throw new AppError("INVALID_STATE", "Você não pode desativar ou mudar o próprio papel.");
    }
    const losesAdmin = u.role === "ADMIN" && u.active && (input.active === false || (input.role !== undefined && input.role !== "ADMIN"));
    if (losesAdmin && (await activeAdminCount(tx)) <= 1) {
      throw new AppError("INVALID_STATE", "É preciso manter ao menos um administrador ativo.");
    }
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.name ? { name: input.name.trim().slice(0, 100) } : {}),
      },
    });
    await writeAudit(tx, {
      actor,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: userId,
      before: { role: u.role, active: u.active, name: u.name },
      after: { role: updated.role, active: updated.active, name: updated.name },
    });
  });
  if (input.active === false || input.role) await revokeAllSessions(userId);
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  actor: Actor & { type: "USER" },
  action: "USER_PASSWORD_RESET" | "USER_PASSWORD_CHANGED" = "USER_PASSWORD_RESET",
) {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AppError("VALIDATION", problem);
  const passwordHash = await hashPassword(newPassword);
  await transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await writeAudit(tx, { actor, action, entityType: "user", entityId: userId });
  });
  // Encerra todas as sessões (inclusive a atual): quem tinha a senha antiga perde o acesso.
  await revokeAllSessions(userId);
}

/**
 * Troca da própria senha. Exige a senha atual (uma sessão roubada não basta
 * para tomar a conta) e tem limite próprio de tentativas.
 */
export async function changeOwnPassword(userId: string, current: string, next: string, actor: Actor & { type: "USER" }) {
  await enforceRateLimit("loginEmail", `own-password:${userId}`, "Muitas tentativas. Aguarde alguns minutos.");
  const u = await db().user.findUnique({ where: { id: userId } });
  if (!u || !(await verifyPassword(current, u.passwordHash))) {
    await logEvent("WARN", "SECURITY", "Senha atual incorreta ao trocar a própria senha", { user: actor.label });
    throw new AppError("VALIDATION", "Senha atual incorreta.");
  }
  if (current === next) throw new AppError("VALIDATION", "A nova senha deve ser diferente da atual.");
  await resetUserPassword(userId, next, actor, "USER_PASSWORD_CHANGED");
}
