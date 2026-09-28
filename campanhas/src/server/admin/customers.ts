import "server-only";
import { digitsOnly } from "@/lib/format";
import { db, transaction } from "../db";
import { isUniqueViolation } from "../db-errors";
import { AppError } from "../errors";
import { decryptSecret } from "../crypto";
import { writeAudit, type Actor } from "../audit";
import { customerInputSchema } from "../validation/customer";

export async function listCustomers(campaignId: string, opts: { q?: string; page?: number }) {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = 30;
  const q = opts.q?.trim() ?? "";
  const phone = digitsOnly(q);
  const rows = await db().$queryRaw<
    {
      id: string;
      name: string;
      phone: string;
      email: string | null;
      anonymized_at: Date | null;
      paid_orders: bigint;
      paid_numbers: bigint;
      paid_cents: bigint;
      pending_orders: bigint;
      last_order_at: Date;
    }[]
  >`
    SELECT c.id, c.name, c.phone, c.email, c.anonymized_at,
           count(o.id) FILTER (WHERE o.status = 'PAID') AS paid_orders,
           coalesce(sum(o.quantity) FILTER (WHERE o.status = 'PAID'), 0)::bigint AS paid_numbers,
           coalesce(sum(o.total_cents) FILTER (WHERE o.status = 'PAID'), 0)::bigint AS paid_cents,
           count(o.id) FILTER (WHERE o.status = 'PENDING_PAYMENT') AS pending_orders,
           max(o.created_at) AS last_order_at
    FROM customers c JOIN orders o ON o.customer_id = c.id AND o.campaign_id = ${campaignId}::uuid
    WHERE (${q} = '' OR c.name ILIKE ${`%${q}%`} OR (${phone} <> '' AND c.phone LIKE ${`%${phone}%`}))
    GROUP BY c.id
    ORDER BY max(o.created_at) DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  return { page, pageSize, rows };
}

export async function getCustomerDetail(customerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  return db().customer.findUnique({
    where: { id: customerId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        include: { campaign: { select: { name: true, numberDigits: true } }, items: { where: { active: true }, select: { number: true } } },
      },
    },
  });
}

/** Direito de acesso (LGPD art. 18): todos os dados do titular em JSON. */
export async function exportCustomerData(customerId: string, actor: Actor & { type: "USER" }) {
  const c = await getCustomerDetail(customerId);
  if (!c) throw new AppError("NOT_FOUND", "Comprador não encontrado.");
  let cpf: string | null = null;
  if (c.cpfEncrypted) {
    try {
      cpf = decryptSecret(c.cpfEncrypted);
    } catch {
      cpf = "[ilegível]";
    }
  }
  await transaction(async (tx) => {
    await writeAudit(tx, { actor, action: "CUSTOMER_DATA_EXPORTED", entityType: "customer", entityId: customerId });
  });
  return {
    exportadoEm: new Date().toISOString(),
    titular: { nome: c.name, whatsapp: c.phone, email: c.email, cpf, criadoEm: c.createdAt, anonimizadoEm: c.anonymizedAt },
    pedidos: c.orders.map((o) => ({
      codigo: o.code,
      campanha: o.campaign.name,
      situacao: o.status,
      numeros: o.items.map((i) => i.number),
      valorCentavos: o.totalCents,
      criadoEm: o.createdAt,
      pagoEm: o.paidAt,
      aceiteRegulamentoEm: o.termsAcceptedAt,
      aceitePrivacidadeEm: o.privacyAcceptedAt,
      versaoRegulamento: o.termsVersion,
    })),
  };
}

/** Correção do cadastro (LGPD). Pedidos já feitos mantêm seus dados; use a correção do pedido quando necessário. */
export async function updateCustomer(
  customerId: string,
  input: { name?: string; phone?: string; email?: string },
  reason: string,
  actor: Actor & { type: "USER" },
) {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo da correção.");
  const parsed = customerInputSchema.partial().safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Dados inválidos.");
  await transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id: customerId } });
    if (!before) throw new AppError("NOT_FOUND", "Comprador não encontrado.");
    if (before.anonymizedAt) throw new AppError("INVALID_STATE", "Cadastro anonimizado.");
    try {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
          ...(parsed.data.email ? { email: parsed.data.email } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe outro comprador com este WhatsApp.");
      throw e;
    }
    await writeAudit(tx, {
      actor,
      action: "CUSTOMER_UPDATED",
      entityType: "customer",
      entityId: customerId,
      before: { name: before.name, phone: before.phone, email: before.email },
      after: parsed.data,
      reason,
    });
  });
}
