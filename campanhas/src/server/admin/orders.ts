import "server-only";
import { randomUUID } from "node:crypto";
import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { formatNumber, normalizeBrazilPhone, digitsOnly } from "@/lib/format";
import { allowExceptionalOperation, db, transaction } from "../db";
import { isUniqueViolation } from "../db-errors";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { appUrl } from "../env";
import { invalidateStatusCache } from "../campaigns/queries";
import { reserveNumbers } from "../numbers/reservations";
import { createOrderFromReservation } from "../orders/create";
import { lockOrder } from "../orders/lifecycle";
import { orderAccessToken } from "../orders/access";
import { customerInputSchema, type CustomerInput } from "../validation/customer";

export type OrderFilters = {
  q?: string;
  phone?: string;
  code?: string;
  number?: number;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export function orderWhere(campaignId: string, f: OrderFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { campaignId };
  if (f.status) where.status = f.status;
  if (f.code) where.code = { contains: f.code.trim().toUpperCase() };
  if (f.q) where.customerName = { contains: f.q.trim(), mode: "insensitive" };
  if (f.phone) {
    const d = digitsOnly(f.phone);
    if (d.length >= 4) where.customerPhone = { contains: d };
  }
  if (f.number !== undefined && Number.isInteger(f.number)) where.items = { some: { number: f.number } };
  if (f.from || f.to) where.createdAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) };
  return where;
}

export async function listOrders(campaignId: string, f: OrderFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = orderWhere(campaignId, f);
  const [total, rows] = await Promise.all([
    db().order.count({ where }),
    db().order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: { select: { number: true, active: true }, orderBy: { number: "asc" } },
        payments: { select: { status: true, requiresAttention: true, resolvedAt: true }, orderBy: { createdAt: "desc" } },
      },
    }),
  ]);
  return { total, page, pageSize, rows };
}

export async function getOrderDetail(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      campaign: { select: { id: true, slug: true, name: true, numberDigits: true, status: true } },
      customer: { select: { id: true, anonymizedAt: true } },
      items: { orderBy: { number: "asc" } },
      payments: { orderBy: { createdAt: "asc" }, include: { confirmedBy: { select: { email: true } }, resolvedBy: { select: { email: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { email: true, name: true } } } },
      paymentEvents: { orderBy: { createdAt: "desc" }, take: 100 },
      createdBy: { select: { email: true } },
    },
  });
  if (!order) return null;
  const audit = await db().auditLog.findMany({
    where: { entityType: "order", entityId: order.id },
    orderBy: { id: "desc" },
    take: 50,
  });
  return { order, audit };
}

export async function addOrderNote(orderId: string, body: string, actor: Actor & { type: "USER" }) {
  const text = body.trim();
  if (text.length < 2 || text.length > 2000) throw new AppError("VALIDATION", "Escreva uma observação (até 2.000 caracteres).");
  await transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, campaignId: true } });
    if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    await tx.orderNote.create({ data: { orderId, authorId: actor.id, body: text } });
    await writeAudit(tx, {
      actor,
      action: "ORDER_NOTE_ADDED",
      entityType: "order",
      entityId: orderId,
      campaignId: order.campaignId,
      after: { note: text },
    });
  });
}

/**
 * Correção de dados do comprador no pedido. Em pedidos pagos exige motivo e
 * a flag excepcional (o trigger bloqueia alteração silenciosa). Sempre auditado.
 */
export async function correctOrderCustomer(
  orderId: string,
  input: { name?: string; phone?: string; email?: string | null },
  reason: string,
  actor: Actor & { type: "USER" },
  opts: { allowPaid: boolean },
) {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Informe o motivo da correção.");
  const parsed = customerInputSchema.partial().safeParse({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email ? { email: input.email } : {}),
  });
  if (!parsed.success) throw new AppError("VALIDATION", "Dados inválidos. Revise nome, WhatsApp e e-mail.");
  const data = parsed.data;

  await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    if ((order.status === "PAID" || order.status === "REFUNDED") && !opts.allowPaid) {
      throw new AppError("FORBIDDEN", "Somente administradores podem corrigir pedidos pagos.");
    }
    const before = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { customerName: true, customerPhone: true, customerEmail: true, customerId: true },
    });
    if (order.status === "PAID" || order.status === "REFUNDED") {
      await allowExceptionalOperation(tx, `correcao-pedido:${reason.slice(0, 80)}`);
    }
    const after = {
      customerName: data.name ?? before.customerName,
      customerPhone: data.phone ?? before.customerPhone,
      customerEmail: input.email === null ? null : (data.email ?? before.customerEmail),
    };
    await tx.order.update({ where: { id: orderId }, data: after });
    try {
      await tx.customer.update({
        where: { id: before.customerId },
        data: {
          ...(data.name ? { name: data.name } : {}),
          ...(data.phone ? { phone: data.phone } : {}),
          ...(data.email ? { email: data.email } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe outro comprador com este WhatsApp.");
      throw e;
    }
    await writeAudit(tx, {
      actor,
      action: "ORDER_CUSTOMER_CORRECTED",
      entityType: "order",
      entityId: orderId,
      campaignId: order.campaign_id,
      before: { name: before.customerName, phone: before.customerPhone, email: before.customerEmail },
      after: { name: after.customerName, phone: after.customerPhone, email: after.customerEmail },
      reason,
    });
  });
}

const DEFAULT_MESSAGE = ["Olá! Seu pagamento da {campanha} foi confirmado.", "Pedido: {pedido}", "Seus números:", "{numeros}", "Obrigado por participar! ❤️"].join("\n");

/** Mensagem pronta de confirmação (requisito 25) + link wa.me. Nada é enviado automaticamente. */
export async function buildConfirmationMessage(orderId: string, actor: Actor & { type: "USER" }) {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      campaign: { select: { name: true, numberDigits: true, confirmationMessage: true } },
      items: { where: { active: true }, orderBy: { number: "asc" }, select: { number: true } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
  if (order.status !== "PAID") throw new AppError("INVALID_STATE", "A confirmação só pode ser enviada para pedidos pagos.");
  if (!normalizeBrazilPhone(order.customerPhone)) throw new AppError("INVALID_STATE", "Pedido sem WhatsApp válido.");
  const link = new URL(`/pedido/${orderAccessToken(order.id)}`, appUrl()).toString();
  const numbers = order.items.map((i) => formatNumber(i.number, order.campaign.numberDigits)).join("\n");
  let message = (order.campaign.confirmationMessage ?? DEFAULT_MESSAGE)
    .replaceAll("{campanha}", order.campaign.name)
    .replaceAll("{pedido}", order.code)
    .replaceAll("{numeros}", numbers)
    .replaceAll("{link}", link);
  if (!message.includes(link)) message += `\n\nAcompanhe: ${link}`;
  const whatsappUrl = `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(message)}`;
  await transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { confirmationSentAt: new Date() } });
    await writeAudit(tx, {
      actor,
      action: "ORDER_CONFIRMATION_PREPARED",
      entityType: "order",
      entityId: orderId,
      campaignId: order.campaignId,
    });
  });
  return { message, whatsappUrl, link };
}

/**
 * Reembolso registrado pelo administrador (somente Pix manual; no automático o
 * estorno é feito no gateway e chega por webhook). Números vão para CANCELLED,
 * nunca direto para AVAILABLE.
 */
export async function refundManualOrder(orderId: string, reason: string, actor: Actor & { type: "USER" }) {
  if (reason.trim().length < 10) throw new AppError("VALIDATION", "Descreva o motivo e como o valor foi devolvido.");
  await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw new AppError("NOT_FOUND", "Pedido não encontrado.");
    if (order.status !== "PAID") throw new AppError("INVALID_STATE", "Somente pedidos pagos podem ser reembolsados.");
    if (order.payment_mode !== "MANUAL") {
      throw new AppError("INVALID_STATE", "No Pix automático, faça o estorno no Mercado Pago; o sistema atualiza pelo webhook.");
    }
    const [camp] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM campaigns WHERE id = ${order.campaign_id}::uuid FOR SHARE`;
    if (camp?.status === "FROZEN" || camp?.status === "DRAWN") {
      throw new AppError("INVALID_STATE", "A lista do sorteio já foi congelada; trate conforme o regulamento.");
    }
    await allowExceptionalOperation(tx, `reembolso:${reason.slice(0, 80)}`);
    await tx.$executeRaw`
      UPDATE campaign_numbers SET status = 'CANCELLED', blocked_reason = 'pedido reembolsado', version = version + 1
      WHERE order_id = ${orderId}::uuid AND status = 'PAID'`;
    await tx.$executeRaw`UPDATE order_items SET active = false, released_at = now() WHERE order_id = ${orderId}::uuid AND active`;
    await tx.$executeRaw`UPDATE orders SET status = 'REFUNDED', refunded_at = now(), version = version + 1 WHERE id = ${orderId}::uuid`;
    await tx.$executeRaw`UPDATE payments SET status = 'REFUNDED' WHERE id = ${order.paid_payment_id}::uuid`;
    await writeAudit(tx, {
      actor,
      action: "ORDER_REFUNDED_MANUAL",
      entityType: "order",
      entityId: orderId,
      campaignId: order.campaign_id,
      before: { status: "PAID" },
      after: { status: "REFUNDED", numbers: "CANCELLED" },
      reason,
    });
    invalidateStatusCache(order.campaign_id);
  });
}

/**
 * "Reservar número" pelo painel: cria reserva + pedido Pix manual em nome de
 * um comprador (ex.: atendimento por WhatsApp). O pagamento continua exigindo
 * confirmação manual auditada.
 */
export async function createAdminOrder(
  campaignSlug: string,
  numbers: number[],
  customer: CustomerInput,
  declaration: { customerAcceptedTerms: boolean },
  actor: Actor & { type: "USER" },
) {
  if (!declaration.customerAcceptedTerms) {
    throw new AppError("VALIDATION", "Confirme que o comprador aceitou o regulamento e a política de privacidade.");
  }
  const reservation = await reserveNumbers({ campaignSlug, numbers });
  const order = await createOrderFromReservation({
    reservationToken: reservation.token,
    customer,
    acceptTerms: true,
    acceptPrivacy: true,
    idempotencyKey: randomUUID(),
    admin: { userId: actor.id },
  });
  await transaction(async (tx) => {
    await writeAudit(tx, {
      actor,
      action: "ORDER_CREATED_BY_ADMIN",
      entityType: "order",
      entityId: order.orderId,
      campaignId: reservation.campaignId,
      after: { code: order.code, numbers: reservation.numbers, totalCents: order.totalCents },
      reason: "Reserva feita pelo painel em nome do comprador (aceite declarado pelo operador)",
    });
  });
  return order;
}
