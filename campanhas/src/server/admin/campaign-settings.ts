import "server-only";
import { z } from "zod";
import { Prisma, type CampaignStatus, type PrizeOrigin } from "@/generated/prisma/client";
import { allowExceptionalOperation, db, transaction, type Tx } from "../db";
import { triggerCodeOf } from "../db-errors";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { invalidateStatusCache } from "../campaigns/queries";
import { getPaymentConfig } from "../payments/settings";
import { cleanText } from "../validation/customer";

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s"'<>]+$/.test(v), "Use um endereço https:// válido.")
  .transform((v) => (v === "" ? null : v));

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => {
      const t = v.replace(/\r\n/g, "\n").trim();
      return t === "" ? null : t;
    });

const optionalDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    // Data sem horário (AAAA-MM-DD) = meio-dia em Brasília, evitando "voltar um dia" por fuso.
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-03:00` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Data inválida." });
      return z.NEVER;
    }
    return d;
  });

export const campaignUpdateSchema = z.strictObject({
  version: z.number().int(),
  name: z.string().transform(cleanText).pipe(z.string().min(3).max(120)),
  shortDescription: optionalText(300),
  story: z.string().max(20_000).transform((v) => v.replace(/\r\n/g, "\n").trim()),
  imageUrl: httpsUrl,
  priceCents: z.number().int().min(1).max(10_000_000),
  totalNumbers: z.number().int().min(1).max(1_000_000),
  numberDigits: z.number().int().min(1).max(7),
  minNumbersPerOrder: z.number().int().min(1).max(10_000),
  maxNumbersPerOrder: z.number().int().min(1).max(10_000),
  maxNumbersPerCustomer: z.number().int().min(1).max(1_000_000).nullable(),
  reservationMinutes: z.number().int().min(1).max(1440),
  paymentMinutes: z.number().int().min(1).max(10080),
  requireCpf: z.boolean(),
  requireEmail: z.boolean(),
  salesStartAt: optionalDate,
  salesEndAt: optionalDate,
  drawScheduledAt: optionalDate,
  drawMethod: z.enum(["FEDERAL_LOTTERY", "VERIFIABLE_HASH", "CSPRNG"]).nullable(),
  drawMethodParams: z
    .strictObject({
      digits: z.number().int().min(1).max(6).optional(),
      unsoldRule: z.enum(["NEXT_HIGHER", "NEXT_LOWER"]).optional(),
    })
    .nullable(),
  contactWhatsapp: optionalText(30),
  contactEmail: optionalText(200),
  contactInstagram: optionalText(60),
  faq: z.array(z.strictObject({ q: z.string().trim().min(3).max(300), a: z.string().trim().min(1).max(3000) })).max(50),
  confirmationMessage: optionalText(1500),
  orderCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "Use 2 a 10 letras/números."),
  /** Confirmação explícita para alteração crítica com vendas existentes. */
  confirmCritical: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});

export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

function mapCampaignError(e: unknown): never {
  const code = triggerCodeOf(e);
  const messages: Record<string, string> = {
    CAMPAIGN_FROZEN_FIELDS: "A campanha está congelada/sorteada: preço, quantidade e método não podem mudar.",
    CAMPAIGN_CRITICAL_CHANGE_REQUIRES_CONFIRMATION: "Alteração crítica com vendas exige confirmação.",
    CAMPAIGN_NUMBERING_IMMUTABLE: "A numeração não pode ser alterada depois de criada.",
    CAMPAIGN_PREFIX_IMMUTABLE: "O prefixo do pedido não pode mudar depois do primeiro pedido.",
    NUMBER_DELETE_FORBIDDEN: "Não é possível reduzir: há números usados acima da nova quantidade.",
    CAMPAIGN_INVALID_TRANSITION: "Mudança de situação não permitida.",
    CAMPAIGN_COMPLIANCE_REQUIRED: "A ativação exige a declaração de conformidade.",
    CAMPAIGN_HAS_PAID_ORDERS: "Há pedidos pagos: trate os reembolsos antes de cancelar a campanha.",
    CAMPAIGN_HAS_PENDING_NUMBERS: "Há números reservados ou aguardando pagamento.",
  };
  if (code && messages[code]) throw new AppError("INVALID_STATE", messages[code], { cause: e });
  throw e;
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { b, a };
}

export async function updateCampaign(campaignId: string, input: CampaignUpdateInput, actor: Actor & { type: "USER" }) {
  if (input.maxNumbersPerOrder < input.minNumbersPerOrder) {
    throw new AppError("VALIDATION", "O máximo por pedido deve ser maior ou igual ao mínimo.");
  }
  if (input.salesStartAt && input.salesEndAt && input.salesEndAt <= input.salesStartAt) {
    throw new AppError("VALIDATION", "O fim das vendas deve ser depois do início.");
  }
  try {
    await transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
      const current = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!locked || !current) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
      if (current.version !== input.version) {
        throw new AppError("CONFLICT", "A campanha foi alterada por outra pessoa. Recarregue a página e revise.");
      }
      const lastNumber = current.firstNumber + input.totalNumbers - 1;
      if (String(lastNumber).length > input.numberDigits) {
        throw new AppError("VALIDATION", `Com ${input.totalNumbers} números são necessários ao menos ${String(lastNumber).length} dígitos.`);
      }
      const hasOrders = (await tx.order.count({ where: { campaignId } })) > 0;
      const critical = input.priceCents !== current.priceCents || input.totalNumbers < current.totalNumbers;
      if (critical && hasOrders) {
        if (!input.confirmCritical || !input.reason || input.reason.trim().length < 10) {
          throw new AppError("CONFLICT", "Esta campanha já tem pedidos. Confirme a alteração de preço/quantidade e descreva o motivo.", {
            details: { requiresConfirmation: true },
          });
        }
        await allowExceptionalOperation(tx, `alteracao-critica:${input.reason.slice(0, 80)}`);
      }

      const data = {
        name: input.name,
        shortDescription: input.shortDescription,
        story: input.story,
        imageUrl: input.imageUrl,
        priceCents: input.priceCents,
        totalNumbers: input.totalNumbers,
        numberDigits: input.numberDigits,
        minNumbersPerOrder: input.minNumbersPerOrder,
        maxNumbersPerOrder: input.maxNumbersPerOrder,
        maxNumbersPerCustomer: input.maxNumbersPerCustomer,
        reservationMinutes: input.reservationMinutes,
        paymentMinutes: input.paymentMinutes,
        requireCpf: input.requireCpf,
        requireEmail: input.requireEmail,
        salesStartAt: input.salesStartAt,
        salesEndAt: input.salesEndAt,
        drawScheduledAt: input.drawScheduledAt,
        drawMethod: input.drawMethod,
        drawMethodParams: input.drawMethodParams === null ? Prisma.DbNull : input.drawMethodParams,
        contactWhatsapp: input.contactWhatsapp,
        contactEmail: input.contactEmail,
        contactInstagram: input.contactInstagram,
        faq: input.faq,
        confirmationMessage: input.confirmationMessage,
        orderCodePrefix: input.orderCodePrefix,
      };

      // Quantidade: aumentar cria números; reduzir só remove números nunca usados.
      if (input.totalNumbers > current.totalNumbers) {
        await tx.$executeRaw`
          INSERT INTO campaign_numbers (campaign_id, number)
          SELECT ${campaignId}::uuid, g FROM generate_series(${current.firstNumber + current.totalNumbers}::int, ${lastNumber}::int) g`;
      } else if (input.totalNumbers < current.totalNumbers) {
        await tx.$executeRaw`DELETE FROM campaign_numbers WHERE campaign_id = ${campaignId}::uuid AND number > ${lastNumber}`;
      }

      await tx.campaign.update({ where: { id: campaignId }, data: { ...data, version: { increment: 1 } } });
      const { b, a } = diff(current as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      await writeAudit(tx, {
        actor,
        action: critical && hasOrders ? "CAMPAIGN_CRITICAL_UPDATE" : "CAMPAIGN_UPDATED",
        entityType: "campaign",
        entityId: campaignId,
        campaignId,
        before: b,
        after: a,
        reason: input.reason ?? null,
      });
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapCampaignError(e);
  }
  invalidateStatusCache(campaignId);
}

// ---------------------------------------------------------------------------
// Situação da campanha
// ---------------------------------------------------------------------------

export type StatusAction = "activate" | "pause" | "resume" | "close" | "reopen" | "cancel";

const ACTION_TARGET: Record<StatusAction, { from: CampaignStatus[]; to: CampaignStatus; audit: string }> = {
  activate: { from: ["DRAFT"], to: "ACTIVE", audit: "CAMPAIGN_ACTIVATED" },
  pause: { from: ["ACTIVE"], to: "PAUSED", audit: "CAMPAIGN_PAUSED" },
  resume: { from: ["PAUSED"], to: "ACTIVE", audit: "CAMPAIGN_RESUMED" },
  close: { from: ["ACTIVE", "PAUSED"], to: "CLOSED", audit: "CAMPAIGN_SALES_CLOSED" },
  reopen: { from: ["CLOSED"], to: "ACTIVE", audit: "CAMPAIGN_REOPENED" },
  cancel: { from: ["DRAFT", "ACTIVE", "PAUSED", "CLOSED"], to: "CANCELLED", audit: "CAMPAIGN_CANCELLED" },
};

export const COMPLIANCE_DECLARATION =
  "Declaro que esta operação está devidamente enquadrada/autorizada conforme a legislação aplicável, que o regulamento publicado é o oficial e que as informações legais cadastradas são verdadeiras.";

/** Checklist de ativação: o que falta para publicar a campanha. */
export async function activationChecklist(campaignId: string, client: Tx | ReturnType<typeof db> = db()): Promise<string[]> {
  const missing: string[] = [];
  const c = await client.campaign.findUnique({ where: { id: campaignId }, include: { legalInfo: true } });
  if (!c) return ["campanha inexistente"];
  const legal = c.legalInfo;
  if (!legal?.operatorName) missing.push("Informações legais: responsável pela operação");
  if (!legal?.regulation && !legal?.regulationUrl) missing.push("Informações legais: regulamento");
  if (!legal?.modality) missing.push("Informações legais: modalidade");
  if (!legal?.officialDrawMethod) missing.push("Informações legais: método oficial de apuração");
  if (!c.drawMethod) missing.push("Campanha: método de sorteio do sistema");
  const prizes = await client.prize.count({ where: { campaignId, deletedAt: null } });
  if (prizes === 0) missing.push("Prêmios: cadastre ao menos um prêmio");
  try {
    const pay = await getPaymentConfig(campaignId, client);
    if (pay.mode === "MANUAL" && !pay.pixReceiverConfigured) missing.push("Pagamentos: nome e cidade do recebedor Pix");
    if (pay.mode === "AUTOMATIC" && !pay.gateway) missing.push("Pagamentos: credenciais do gateway");
  } catch {
    missing.push("Pagamentos: configuração ausente");
  }
  return missing;
}

export async function changeCampaignStatus(
  campaignId: string,
  action: StatusAction,
  opts: { reason?: string; complianceDeclaration?: boolean },
  actor: Actor & { type: "USER" },
) {
  const rule = ACTION_TARGET[action];
  if ((action === "reopen" || action === "cancel") && (!opts.reason || opts.reason.trim().length < 10)) {
    throw new AppError("VALIDATION", "Descreva o motivo (mínimo 10 caracteres).");
  }
  try {
    await transaction(async (tx) => {
      const [c] = await tx.$queryRaw<{ status: CampaignStatus }[]>`SELECT status FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
      if (!c) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
      if (!rule.from.includes(c.status)) throw new AppError("INVALID_STATE", "Esta ação não se aplica à situação atual da campanha.");
      const extra: { complianceConfirmedAt?: Date; complianceConfirmedById?: string } = {};
      if (action === "activate") {
        const missing = await activationChecklist(campaignId, tx);
        if (missing.length > 0) {
          throw new AppError("VALIDATION", `Antes de ativar, complete: ${missing.join("; ")}.`, { details: { missing } });
        }
        if (!opts.complianceDeclaration) throw new AppError("VALIDATION", "É necessário marcar a declaração de conformidade.");
        extra.complianceConfirmedAt = new Date();
        extra.complianceConfirmedById = actor.id;
      }
      await tx.campaign.update({ where: { id: campaignId }, data: { status: rule.to, ...extra, version: { increment: 1 } } });
      await writeAudit(tx, {
        actor,
        action: rule.audit,
        entityType: "campaign",
        entityId: campaignId,
        campaignId,
        before: { status: c.status },
        after: { status: rule.to, ...(action === "activate" ? { declaracao: COMPLIANCE_DECLARATION } : {}) },
        reason: opts.reason ?? null,
      });
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    mapCampaignError(e);
  }
  invalidateStatusCache(campaignId);
}

// ---------------------------------------------------------------------------
// Prêmios
// ---------------------------------------------------------------------------

export const prizeSchema = z.strictObject({
  position: z.number().int().min(1).max(100),
  name: z.string().transform(cleanText).pipe(z.string().min(2).max(150)),
  description: optionalText(2000),
  imageUrl: httpsUrl,
  estimatedValueCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  origin: z.enum(["NOT_INFORMED", "DONATION", "PURCHASED", "SPONSORSHIP", "OTHER"]),
  originDetails: optionalText(300),
  documentationUrl: httpsUrl,
});
export type PrizeInput = z.infer<typeof prizeSchema>;

async function assertPrizesEditable(tx: Tx, campaignId: string) {
  const [c] = await tx.$queryRaw<{ status: CampaignStatus }[]>`SELECT status FROM campaigns WHERE id = ${campaignId}::uuid FOR SHARE`;
  if (!c) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
  if (c.status === "FROZEN" || c.status === "DRAWN") {
    throw new AppError("INVALID_STATE", "Prêmios não podem ser alterados depois do congelamento para o sorteio.");
  }
}

export async function savePrize(campaignId: string, prizeId: string | null, input: PrizeInput, actor: Actor & { type: "USER" }) {
  await transaction(async (tx) => {
    await assertPrizesEditable(tx, campaignId);
    const clash = await tx.prize.findFirst({
      where: { campaignId, position: input.position, deletedAt: null, ...(prizeId ? { NOT: { id: prizeId } } : {}) },
    });
    if (clash) throw new AppError("CONFLICT", `Já existe um prêmio na posição ${input.position}.`);
    const data = { ...input, origin: input.origin as PrizeOrigin };
    if (prizeId) {
      const before = await tx.prize.findFirst({ where: { id: prizeId, campaignId, deletedAt: null } });
      if (!before) throw new AppError("NOT_FOUND", "Prêmio não encontrado.");
      await tx.prize.update({ where: { id: prizeId }, data });
      await writeAudit(tx, { actor, action: "PRIZE_UPDATED", entityType: "prize", entityId: prizeId, campaignId, before, after: data });
    } else {
      const created = await tx.prize.create({ data: { ...data, campaignId } });
      await writeAudit(tx, { actor, action: "PRIZE_CREATED", entityType: "prize", entityId: created.id, campaignId, after: data });
    }
  });
}

export async function deletePrize(campaignId: string, prizeId: string, actor: Actor & { type: "USER" }) {
  await transaction(async (tx) => {
    await assertPrizesEditable(tx, campaignId);
    const before = await tx.prize.findFirst({ where: { id: prizeId, campaignId, deletedAt: null } });
    if (!before) throw new AppError("NOT_FOUND", "Prêmio não encontrado.");
    await tx.prize.update({ where: { id: prizeId }, data: { deletedAt: new Date() } });
    await writeAudit(tx, { actor, action: "PRIZE_REMOVED", entityType: "prize", entityId: prizeId, campaignId, before });
  });
}

// ---------------------------------------------------------------------------
// Informações legais
// ---------------------------------------------------------------------------

export const legalSchema = z.strictObject({
  operatorName: optionalText(200),
  entityName: optionalText(200),
  cnpj: optionalText(20).refine((v) => v === null || /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(v), "CNPJ inválido."),
  authorizationNumber: optionalText(200),
  regulation: optionalText(100_000),
  regulationUrl: httpsUrl,
  startDate: optionalDate,
  endDate: optionalDate,
  modality: optionalText(200),
  officialDrawMethod: optionalText(2000),
  additionalInfo: optionalText(10_000),
  privacyContact: optionalText(300),
  showOnPublicPage: z.boolean(),
});
export type LegalInput = z.infer<typeof legalSchema>;

export async function updateLegalInfo(campaignId: string, input: LegalInput, actor: Actor & { type: "USER" }) {
  await transaction(async (tx) => {
    const before = await tx.legalInformation.findUnique({ where: { campaignId } });
    const saved = before
      ? await tx.legalInformation.update({ where: { campaignId }, data: { ...input, updatedById: actor.id } })
      : await tx.legalInformation.create({ data: { ...input, campaignId, updatedById: actor.id } });
    const { b, a } = diff((before ?? {}) as Record<string, unknown>, input as Record<string, unknown>);
    await writeAudit(tx, {
      actor,
      action: "LEGAL_INFO_UPDATED",
      entityType: "legal_information",
      entityId: saved.id,
      campaignId,
      before: b,
      after: a,
      reason: before?.regulation !== input.regulation ? "Regulamento alterado: novos pedidos registram a nova versão" : null,
    });
  });
}
