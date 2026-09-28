/**
 * Cria (ou redefine) um usuário ADMINISTRADOR do painel.
 *
 *   npm run create-admin -- --email=voce@exemplo.org --name="Seu Nome"
 *   npm run create-admin -- --email=voce@exemplo.org --reset
 *
 * A senha NUNCA é passada como argumento (ficaria no histórico do shell e em
 * `ps`). Use a variável ADMIN_PASSWORD ou deixe o script gerar uma senha
 * forte, exibida uma única vez. Não existe usuário/senha padrão no sistema.
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { hashPassword, passwordProblem } from "../src/server/auth/password";
import { revokeAllSessions } from "../src/server/auth/session";
import { writeAudit, type Actor } from "../src/server/audit";
import { db, disconnectDb, transaction } from "../src/server/db";

const CLI_ACTOR: Actor = { type: "SYSTEM", label: "cli:create-admin" };

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#%";
  for (;;) {
    const pwd = Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
    if (!passwordProblem(pwd)) return pwd;
  }
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const reset = process.argv.includes("--reset");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe --email=... (ex.: npm run create-admin -- --email=voce@exemplo.org --name="Seu Nome")');
  }

  const provided = process.env.ADMIN_PASSWORD;
  const password = provided && provided.length > 0 ? provided : generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD inválida: ${problem}`);
  const passwordHash = await hashPassword(password);

  const existing = await db().user.findUnique({ where: { email } });
  if (existing && !reset) {
    throw new Error("Já existe um usuário com este e-mail. Use --reset para redefinir a senha e torná-lo administrador ativo.");
  }

  await transaction(async (tx) => {
    if (existing) {
      await tx.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", active: true, passwordHash, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
      });
      await writeAudit(tx, {
        actor: CLI_ACTOR,
        action: "USER_PASSWORD_RESET",
        entityType: "user",
        entityId: existing.id,
        before: { role: existing.role, active: existing.active },
        after: { role: "ADMIN", active: true },
        reason: "Redefinição pela linha de comando (create-admin --reset)",
      });
    } else {
      if (!name || name.length < 2) throw new Error('Informe --name="Seu Nome" para criar o usuário.');
      const u = await tx.user.create({ data: { email, name: name.slice(0, 100), role: "ADMIN", passwordHash } });
      await writeAudit(tx, {
        actor: CLI_ACTOR,
        action: "USER_CREATED",
        entityType: "user",
        entityId: u.id,
        after: { email, role: "ADMIN" },
        reason: "Criado pela linha de comando (create-admin)",
      });
    }
  });
  if (existing) await revokeAllSessions(existing.id);

  console.log(existing ? `Administrador ${email} redefinido.` : `Administrador ${email} criado.`);
  if (!provided) {
    console.log("\nSenha gerada (exibida só agora — guarde em um gerenciador de senhas e troque em 'Minha conta'):");
    console.log(`  ${password}\n`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(`Erro: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb());
