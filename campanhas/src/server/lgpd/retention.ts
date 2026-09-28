import "server-only";
import { allowExceptionalOperation, db, transaction } from "../db";
import { AppError } from "../errors";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "../audit";
import { logEvent } from "../logger";

export const ANONYMIZED_NAME = "Titular anonimizado";

/** Dias após os quais dados de quem nunca concluiu uma compra são anonimizados. */
export const UNPAID_RETENTION_DAYS = 90;

/**
 * Motivos que impedem anonimizar agora (dados ainda necessários para a
 * operação: participação em sorteio pendente, prêmio a entregar, pedido
 * aguardando pagamento).
 */
export async function anonymizationBlockers(customerId: string): Promise<string[]> {
  const reasons: string[] = [];
  const pending = await db().order.count({ where: { customerId, status: "PENDING_PAYMENT" } });
  if (pending > 0) reasons.push("há pedido aguardando pagamento");
  const activePaid = await db().order.count({
    where: { customerId, status: "PAID", campaign: { status: { in: ["ACTIVE", "PAUSED", "CLOSED", "FROZEN"] } } },
  });
  if (activePaid > 0) reasons.push("há participação paga em campanha ainda não sorteada");
  const prizes = await db().drawResult.count({
    where: { order: { customerId }, deliveryStatus: { in: ["PENDING_CONTACT", "CONTACTED"] } },
  });
  if (prizes > 0) reasons.push("há prêmio pendente de entrega");
  return reasons;
}

/**
 * Anonimiza os dados pessoais do titular, preservando os registros de
 * pedidos/pagamentos (valores, números, datas) exigidos para prestação de
 * contas e auditoria.
 */
export async function anonymizeCustomer(customerId: string, actor: Actor, reason: string): Promise<void> {
  const blockers = await anonymizationBlockers(customerId);
  if (blockers.length > 0) {
    throw new AppError("INVALID_STATE", `Não é possível anonimizar agora: ${blockers.join("; ")}.`);
  }
  await transaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c) throw new AppError("NOT_FOUND", "Comprador não encontrado.");
    if (c.anonymizedAt) return;
    await allowExceptionalOperation(tx, "lgpd-anonymization");
    await tx.$executeRaw`
      UPDATE customers SET name = ${ANONYMIZED_NAME}, phone = ${`anon-${customerId}`}, email = NULL,
        cpf_encrypted = NULL, cpf_hash = NULL, anonymized_at = now()
      WHERE id = ${customerId}::uuid`;
    await tx.$executeRaw`
      UPDATE orders SET customer_name = ${ANONYMIZED_NAME}, customer_phone = 'anonimizado', customer_email = NULL,
        customer_payment_note = NULL, ip_hash = NULL
      WHERE customer_id = ${customerId}::uuid`;
    await writeAudit(tx, {
      actor,
      action: "CUSTOMER_ANONYMIZED",
      entityType: "customer",
      entityId: customerId,
      reason,
    });
  });
}

/** Rotina de retenção: anonimiza quem nunca pagou após o prazo. */
export async function runRetention(days = UNPAID_RETENTION_DAYS): Promise<number> {
  const candidates = await db().$queryRaw<{ id: string }[]>`
    SELECT c.id FROM customers c
    WHERE c.anonymized_at IS NULL AND c.created_at < now() - make_interval(days => ${days}::int)
      AND NOT EXISTS (
        SELECT 1 FROM orders o WHERE o.customer_id = c.id
          AND (o.status IN ('PENDING_PAYMENT', 'PAID', 'REFUNDED') OR o.updated_at > now() - make_interval(days => ${days}::int)))
      AND NOT EXISTS (
        SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.customer_id = c.id AND p.requires_attention AND p.resolved_at IS NULL)
    LIMIT 200`;
  let done = 0;
  for (const c of candidates) {
    try {
      await anonymizeCustomer(c.id, SYSTEM_ACTOR, `Retenção: sem compra concluída há mais de ${days} dias`);
      done++;
    } catch (e) {
      await logEvent("WARN", "JOB", "Retenção: anonimização adiada", { error: (e as Error).message });
    }
  }
  return done;
}
