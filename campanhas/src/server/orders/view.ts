import "server-only";
import type { OrderStatus, PaymentMode, PaymentStatus } from "@/generated/prisma/client";
import { formatNumber, shortName, normalizeBrazilPhone } from "@/lib/format";
import { db } from "../db";
import { AppError } from "../errors";
import { safeEqual } from "../crypto";
import { hashAccessToken, isPlausibleToken, orderAccessToken } from "./access";
import { qrSvg, svgDataUri, validatePixPayloadForOrder } from "../payments/qr";

export type PublicOrderView = {
  code: string;
  status: OrderStatus;
  campaign: { slug: string; name: string };
  customerShortName: string;
  numbers: string[];
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus | null;
  /** Pix para pagamento (somente enquanto o pedido aguarda pagamento). */
  pix: null | {
    kind: "DYNAMIC" | "STATIC";
    copyPaste: string;
    qrDataUri: string;
    amountCents: number;
    expiresAt: string | null;
  };
  /** Automático: cobrança ainda não gerada (pode tentar de novo). */
  chargeMissing: boolean;
  customerReportedPaidAt: string | null;
};

/**
 * Visão pública do pedido, acessível somente com o token do link. Nunca
 * inclui telefone, e-mail, CPF ou dados de outros compradores.
 */
export async function getOrderViewByToken(token: string): Promise<PublicOrderView | null> {
  if (!isPlausibleToken(token)) return null;
  const order = await db().order.findUnique({
    where: { accessTokenHash: hashAccessToken(token) },
    include: {
      campaign: { select: { slug: true, name: true, numberDigits: true } },
      items: { select: { number: true, active: true }, orderBy: { number: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) return null;

  const digits = order.campaign.numberDigits;
  const payment = order.payments[0] ?? null;
  // Pedido ativo mostra os itens ativos; expirado/cancelado mostra o que havia sido escolhido.
  const items = order.items.some((i) => i.active) ? order.items.filter((i) => i.active) : order.items;

  let pix: PublicOrderView["pix"] = null;
  if (order.status === "PENDING_PAYMENT" && payment?.pixCopyPaste && payment.status === "PENDING") {
    const okPayload = await validatePixPayloadForOrder(payment.pixCopyPaste, order.totalCents, {
      order: order.code,
      paymentId: payment.id,
    });
    if (okPayload) {
      pix = {
        kind: payment.mode === "AUTOMATIC" ? "DYNAMIC" : "STATIC",
        copyPaste: payment.pixCopyPaste,
        qrDataUri: svgDataUri(await qrSvg(payment.pixCopyPaste)),
        amountCents: order.totalCents,
        expiresAt: order.expiresAt.toISOString(),
      };
    }
  }

  return {
    code: order.code,
    status: order.status,
    campaign: { slug: order.campaign.slug, name: order.campaign.name },
    customerShortName: shortName(order.customerName),
    numbers: items.map((i) => formatNumber(i.number, digits)),
    quantity: order.quantity,
    unitPriceCents: order.unitPriceCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    paymentMode: order.paymentMode,
    paymentStatus: payment?.status ?? null,
    pix,
    chargeMissing:
      order.status === "PENDING_PAYMENT" &&
      order.paymentMode === "AUTOMATIC" &&
      (!payment || payment.status === "CREATING" || !payment.pixCopyPaste),
    customerReportedPaidAt: order.customerReportedPaidAt?.toISOString() ?? null,
  };
}

/**
 * Consulta de participação: exige código do pedido E o WhatsApp usado na
 * compra. Resposta idêntica para "não existe" e "telefone não confere",
 * evitando enumeração de pedidos pelo código sequencial.
 */
export async function lookupOrderToken(input: { code: string; phone: string }): Promise<string> {
  const notFound = new AppError("NOT_FOUND", "Pedido não encontrado. Confira o código e o WhatsApp informados.");
  const code = input.code.trim().toUpperCase();
  const phone = normalizeBrazilPhone(input.phone);
  if (!/^[A-Z0-9]{2,10}-\d{8}-\d{6,}$/.test(code) || !phone) throw notFound;
  const order = await db().order.findUnique({ where: { code }, select: { id: true, customerPhone: true } });
  if (!order || !safeEqual(order.customerPhone, phone)) throw notFound;
  return orderAccessToken(order.id);
}
