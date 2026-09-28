import "server-only";
import { formatNumber } from "@/lib/format";
import { centsToDecimalString } from "@/lib/money";
import { db, transaction } from "../db";
import { writeAudit, type Actor } from "../audit";

export const EXPORT_TYPES = ["numeros", "compradores", "pedidos", "pagamentos", "auditoria"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

/**
 * Célula CSV segura: aspas escapadas e neutralização de fórmulas (=, +, -, @,
 * tab, CR) para evitar "CSV injection" ao abrir no Excel/Planilhas.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  // BOM + ";" (padrão do Excel em português).
  return `\ufeff${[header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

const brl = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : centsToDecimalString(cents).replace(".", ","));

export async function exportCsv(campaignId: string, type: ExportType, actor: Actor & { type: "USER" }): Promise<string> {
  const campaign = await db().campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { numberDigits: true } });
  const fmt = (n: number) => formatNumber(n, campaign.numberDigits);
  let csv: string;

  switch (type) {
    case "numeros": {
      const rows = await db().$queryRaw<{ number: number; status: string; code: string | null; name: string | null; paid_at: Date | null }[]>`
        SELECT cn.number, cn.status::text, o.code, o.customer_name AS name, cn.paid_at
        FROM campaign_numbers cn LEFT JOIN orders o ON o.id = cn.order_id
        WHERE cn.campaign_id = ${campaignId}::uuid ORDER BY cn.number`;
      csv = toCsv(["numero", "situacao", "pedido", "comprador", "pago_em"], rows.map((r) => [fmt(r.number), r.status, r.code, r.name, r.paid_at]));
      break;
    }
    case "compradores": {
      const rows = await db().$queryRaw<{ id: string; name: string; phone: string; email: string | null; orders: bigint; numbers: bigint; cents: bigint }[]>`
        SELECT c.id, c.name, c.phone, c.email, count(o.id) AS orders, coalesce(sum(o.quantity), 0)::bigint AS numbers,
               coalesce(sum(o.total_cents), 0)::bigint AS cents
        FROM customers c JOIN orders o ON o.customer_id = c.id
        WHERE o.campaign_id = ${campaignId}::uuid AND o.status = 'PAID'
        GROUP BY c.id ORDER BY c.name`;
      csv = toCsv(
        ["comprador_id", "nome", "whatsapp", "email", "pedidos_pagos", "numeros_pagos", "total_pago"],
        rows.map((r) => [r.id, r.name, r.phone, r.email, Number(r.orders), Number(r.numbers), brl(Number(r.cents))]),
      );
      break;
    }
    case "pedidos": {
      const orders = await db().order.findMany({
        where: { campaignId },
        orderBy: { createdAt: "asc" },
        include: { items: { select: { number: true, active: true }, orderBy: { number: "asc" } } },
      });
      csv = toCsv(
        ["pedido", "situacao", "comprador", "whatsapp", "email", "quantidade", "valor_unitario", "total", "numeros", "modo", "gateway", "origem", "criado_em", "pago_em"],
        orders.map((o) => [
          o.code,
          o.status,
          o.customerName,
          o.customerPhone,
          o.customerEmail,
          o.quantity,
          brl(o.unitPriceCents),
          brl(o.totalCents),
          (o.items.some((i) => i.active) ? o.items.filter((i) => i.active) : o.items).map((i) => fmt(i.number)).join(" "),
          o.paymentMode,
          o.gateway,
          o.source,
          o.createdAt,
          o.paidAt,
        ]),
      );
      break;
    }
    case "pagamentos": {
      const payments = await db().payment.findMany({
        where: { order: { campaignId } },
        orderBy: { createdAt: "asc" },
        include: { order: { select: { code: true } }, confirmedBy: { select: { email: true } } },
      });
      csv = toCsv(
        ["pedido", "gateway", "modo", "situacao", "id_gateway", "valor", "valor_pago", "aprovado_em", "origem_confirmacao", "confirmado_por", "referencia_manual", "pendencia", "motivo_pendencia", "tratado_em"],
        payments.map((p) => [
          p.order.code,
          p.gateway,
          p.mode,
          p.status,
          p.gatewayPaymentId,
          brl(p.amountCents),
          brl(p.paidAmountCents),
          p.approvedAt,
          p.confirmationSource,
          p.confirmedBy?.email,
          p.manualReference,
          p.requiresAttention ? "sim" : "não",
          p.attentionReason,
          p.resolvedAt,
        ]),
      );
      break;
    }
    case "auditoria": {
      const logs = await db().auditLog.findMany({ where: { campaignId }, orderBy: { id: "asc" }, take: 50_000 });
      csv = toCsv(
        ["id", "data", "ator", "tipo_ator", "acao", "entidade", "entidade_id", "motivo", "ip", "antes", "depois", "hash"],
        logs.map((l) => [l.id.toString(), l.createdAt, l.actorLabel, l.actorType, l.action, l.entityType, l.entityId, l.reason, l.ip, l.before ? JSON.stringify(l.before) : "", l.after ? JSON.stringify(l.after) : "", l.hash]),
      );
      break;
    }
  }

  await transaction(async (tx) => {
    await writeAudit(tx, { actor, action: "DATA_EXPORTED", entityType: "export", entityId: type, campaignId });
  });
  return csv;
}
