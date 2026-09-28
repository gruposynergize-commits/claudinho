import "server-only";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { DeliveryStatus, DrawMethod, Prisma } from "@/generated/prisma/client";
import {
  CANONICAL_FORMAT_ID,
  DrawInputError,
  canonicalList,
  computeCsprng,
  computeFederalLottery,
  computeVerifiableHash,
  describeCsprng,
  describeFederal,
  describeVerifiableHash,
  normalizePublicInput,
  pad,
  parseLotteryNumber,
  type FederalParams,
  type UnsoldRule,
  type WinnerComputation,
} from "@/lib/draw/methods";
import { allowDrawOperation, db, transaction, type Tx } from "../db";
import { isUniqueViolation, triggerCodeOf } from "../db-errors";
import { AppError } from "../errors";
import { writeAudit, type Actor } from "../audit";
import { logEvent } from "../logger";
import { invalidateStatusCache } from "../campaigns/queries";

type AdminActor = Actor & { type: "USER" };

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Hash SHA-256 da lista canônica (mesmo algoritmo de draw_canonical_hash no banco). */
export function eligibleHash(numbers: number[], digits: number): string {
  return sha256Hex(canonicalList(numbers, digits));
}

const TRIGGER_MESSAGES: Record<string, string> = {
  CAMPAIGN_HAS_PENDING_NUMBERS: "Há números reservados ou aguardando pagamento. Resolva-os antes de congelar.",
  CAMPAIGN_INVALID_TRANSITION: "A situação atual da campanha não permite esta etapa.",
  CAMPAIGN_DRAW_NOT_FINALIZED: "O sorteio ainda não foi homologado.",
  DRAW_CAMPAIGN_NOT_FROZEN: "Congele a campanha antes de criar o sorteio.",
  DRAW_INVALID_TRANSITION: "Esta etapa do sorteio não é permitida na situação atual.",
  DRAW_CSPRNG_NOT_ANNULLABLE: "Uma apuração por CSPRNG já executada não pode ser anulada.",
  DRAW_FAILURE_REASON_REQUIRED: "Informe o motivo da anulação (mínimo 10 caracteres).",
  SNAPSHOT_LIST_MISMATCH: "A lista de números pagos mudou durante o congelamento. Tente novamente.",
  SNAPSHOT_HASH_MISMATCH: "Falha de integridade no hash do snapshot.",
  DRAW_RESULT_NOT_ELIGIBLE: "Número apurado fora da lista elegível.",
  DRAW_RESULT_MISMATCH: "Número apurado não corresponde a um número pago.",
  NUMBER_CAMPAIGN_FROZEN: "A campanha está congelada: os números não podem mudar.",
};

function mapDrawError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof DrawInputError) throw new AppError("VALIDATION", e.message);
  if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Já existe um sorteio em andamento para esta campanha.", { cause: e });
  const code = triggerCodeOf(e);
  if (code && TRIGGER_MESSAGES[code]) throw new AppError("INVALID_STATE", TRIGGER_MESSAGES[code], { cause: e });
  throw e;
}

// ---------------------------------------------------------------------------
// Parâmetros do método
// ---------------------------------------------------------------------------

type MethodParams = { digits?: number; unsoldRule?: UnsoldRule; referenceAt?: string };

function readParams(v: unknown): MethodParams {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    digits: typeof o.digits === "number" ? o.digits : undefined,
    unsoldRule: o.unsoldRule === "NEXT_LOWER" ? "NEXT_LOWER" : o.unsoldRule === "NEXT_HIGHER" ? "NEXT_HIGHER" : undefined,
    referenceAt: typeof o.referenceAt === "string" ? o.referenceAt : undefined,
  };
}

function federalParams(p: MethodParams): FederalParams {
  return { digits: p.digits ?? 5, unsoldRule: p.unsoldRule ?? "NEXT_HIGHER" };
}

export function methodDescription(method: DrawMethod, rawParams: unknown, range: { firstNumber: number; totalNumbers: number; numberDigits: number }) {
  switch (method) {
    case "FEDERAL_LOTTERY":
      return describeFederal(federalParams(readParams(rawParams)), range);
    case "VERIFIABLE_HASH":
      return describeVerifiableHash();
    case "CSPRNG":
      return describeCsprng();
  }
}

const needsReference = (m: DrawMethod) => m === "FEDERAL_LOTTERY" || m === "VERIFIABLE_HASH";

/** "AAAA-MM-DDTHH:MM" (campo datetime-local) = horário de Brasília; ISO completo é aceito como está. */
function parseLocalDateTime(v: string | undefined): Date | null {
  if (!v) return null;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00-03:00` : v;
  return new Date(local);
}

// ---------------------------------------------------------------------------
// Visão geral e pré-requisitos
// ---------------------------------------------------------------------------

export async function freezeBlockers(campaignId: string, client: Tx | ReturnType<typeof db> = db()) {
  const campaign = await client.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const [pendingNumbers, pendingOrders, attention, prizes, paid, live] = await Promise.all([
    client.campaignNumber.count({ where: { campaignId, status: { in: ["RESERVED", "PENDING_PAYMENT"] } } }),
    client.order.count({ where: { campaignId, status: "PENDING_PAYMENT" } }),
    client.payment.count({ where: { order: { campaignId }, requiresAttention: true, resolvedAt: null } }),
    client.prize.count({ where: { campaignId, deletedAt: null } }),
    client.campaignNumber.count({ where: { campaignId, status: "PAID" } }),
    client.draw.findFirst({ where: { campaignId, status: { not: "FAILED" } }, select: { id: true } }),
  ]);
  const blockers: string[] = [];
  if (campaign.status === "FROZEN") {
    if (live) blockers.push("Já existe um sorteio em andamento para esta campanha.");
  } else if (campaign.status !== "CLOSED") {
    blockers.push("Encerre as vendas (situação “Vendas encerradas”) antes de congelar.");
  }
  if (!campaign.drawMethod) blockers.push("Defina o método oficial de apuração em Configurações → Campanha.");
  if (pendingNumbers > 0) blockers.push(`${pendingNumbers} número(s) reservado(s) ou aguardando pagamento.`);
  if (pendingOrders > 0) blockers.push(`${pendingOrders} pedido(s) aguardando pagamento: confirme, aguarde a expiração ou cancele.`);
  if (attention > 0) blockers.push(`${attention} pagamento(s) com pendência administrativa (Pagamentos).`);
  if (prizes === 0) blockers.push("Cadastre ao menos um prêmio.");
  if (campaign.drawMethod === "FEDERAL_LOTTERY" && prizes > 5) blockers.push("A Loteria Federal tem 5 prêmios: use até 5 prêmios.");
  if (paid < Math.max(prizes, 1)) blockers.push(`Há ${paid} número(s) pago(s) para ${prizes} prêmio(s).`);
  return { blockers, counts: { pendingNumbers, pendingOrders, attention, prizes, paid } };
}

export async function getDrawOverview(campaignId: string) {
  const [campaign, draws, prizes, check] = await Promise.all([
    db().campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    db().draw.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      include: {
        snapshot: true,
        createdBy: { select: { email: true } },
        executedBy: { select: { email: true } },
        finalizedBy: { select: { email: true } },
        results: {
          orderBy: { prizePosition: "asc" },
          include: {
            prize: { select: { name: true } },
            order: { select: { id: true, code: true, customerName: true, customerPhone: true, status: true } },
          },
        },
      },
    }),
    db().prize.findMany({ where: { campaignId, deletedAt: null }, orderBy: { position: "asc" } }),
    freezeBlockers(campaignId),
  ]);
  return { campaign, draws, prizes, ...check, serverNow: new Date() };
}

// ---------------------------------------------------------------------------
// 1. Congelar vendas + snapshot
// ---------------------------------------------------------------------------

export const freezeSchema = z.strictObject({
  officialReference: z.string().trim().min(5, "Descreva a referência oficial.").max(500),
  /** Data/hora do evento oficial (ex.: extração da Loteria Federal). */
  referenceAt: z.string().trim().max(40).optional(),
  confirmFreeze: z.literal(true, { error: "Confirme o congelamento." }),
});

export async function freezeAndSnapshot(campaignId: string, input: z.infer<typeof freezeSchema>, actor: AdminActor) {
  try {
    const out = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new AppError("NOT_FOUND", "Campanha não encontrada.");
      const { blockers } = await freezeBlockers(campaignId, tx);
      if (blockers.length > 0) throw new AppError("INVALID_STATE", blockers.join(" "), { details: { blockers } });
      const method = campaign.drawMethod!;
      const campaignParams = readParams(campaign.drawMethodParams);

      let referenceAt: Date | null = null;
      if (needsReference(method)) {
        const d = parseLocalDateTime(input.referenceAt);
        if (!d || Number.isNaN(d.getTime())) throw new AppError("VALIDATION", "Informe a data e a hora do evento oficial (ex.: extração da Loteria Federal).");
        if (d.getTime() <= Date.now()) {
          throw new AppError("VALIDATION", "O evento oficial precisa ser FUTURO: o snapshot deve ser publicado antes de o resultado existir.");
        }
        referenceAt = d;
      }

      const wasClosed = campaign.status === "CLOSED";
      if (wasClosed) {
        await tx.campaign.update({ where: { id: campaignId }, data: { status: "FROZEN", version: { increment: 1 } } });
      }

      const paid = await tx.campaignNumber.findMany({ where: { campaignId, status: "PAID" }, select: { number: true }, orderBy: { number: "asc" } });
      const eligible = paid.map((p) => p.number);
      const hash = eligibleHash(eligible, campaign.numberDigits);
      const params: Prisma.InputJsonObject =
        method === "FEDERAL_LOTTERY"
          ? { ...federalParams(campaignParams), referenceAt: referenceAt!.toISOString() }
          : method === "VERIFIABLE_HASH"
            ? { referenceAt: referenceAt!.toISOString() }
            : {};
      const description = methodDescription(method, params, campaign);

      const prizes = await tx.prize.findMany({ where: { campaignId, deletedAt: null }, orderBy: { position: "asc" }, select: { position: true, name: true } });
      const draw = await tx.draw.create({ data: { campaignId, method, methodParams: params, createdById: actor.id } });
      await tx.drawSnapshot.create({
        data: {
          drawId: draw.id,
          campaignId,
          eligibleNumbersCount: eligible.length,
          eligibleNumbersHash: hash,
          eligibleNumbers: eligible,
          numberDigits: campaign.numberDigits,
          canonicalFormat: CANONICAL_FORMAT_ID,
          officialMethod: method,
          officialMethodDescription: description,
          officialReference: input.officialReference,
        },
      });
      if (wasClosed) {
        await writeAudit(tx, {
          actor,
          action: "CAMPAIGN_FROZEN",
          entityType: "campaign",
          entityId: campaignId,
          campaignId,
          before: { status: "CLOSED" },
          after: { status: "FROZEN" },
        });
      }
      await writeAudit(tx, {
        actor,
        action: "DRAW_SNAPSHOT_CREATED",
        entityType: "draw",
        entityId: draw.id,
        campaignId,
        after: {
          method,
          params,
          eligibleNumbersCount: eligible.length,
          eligibleNumbersHash: hash,
          officialReference: input.officialReference,
          prizes,
        },
      });
      return { drawId: draw.id, hash, count: eligible.length };
    });
    invalidateStatusCache(campaignId);
    await logEvent("INFO", "DRAW", "Campanha congelada e snapshot criado", { campaignId, ...out });
    return out;
  } catch (e) {
    mapDrawError(e);
  }
}

// ---------------------------------------------------------------------------
// 2. Apuração (pré-visualização determinística e execução única)
// ---------------------------------------------------------------------------

export const executeSchema = z.strictObject({
  lotteryPrizes: z.array(z.string().max(20)).max(5).optional(),
  lotteryPrizesConfirm: z.array(z.string().max(20)).max(5).optional(),
  publicInput: z.string().max(500).optional(),
  publicInputConfirm: z.string().max(500).optional(),
  confirmExecution: z.boolean().optional(),
});
export type ExecuteInput = z.infer<typeof executeSchema>;

type DrawWithSnapshot = Prisma.DrawGetPayload<{
  include: { snapshot: true; campaign: { select: { id: true; firstNumber: true; totalNumbers: true; numberDigits: true } } };
}>;
type LoadedDraw = DrawWithSnapshot & { snapshot: NonNullable<DrawWithSnapshot["snapshot"]> };

async function loadDraw(client: Tx | ReturnType<typeof db>, drawId: string): Promise<LoadedDraw> {
  const draw = await client.draw.findUnique({
    where: { id: drawId },
    include: { snapshot: true, campaign: { select: { id: true, firstNumber: true, totalNumbers: true, numberDigits: true } } },
  });
  if (!draw || !draw.snapshot) throw new AppError("NOT_FOUND", "Sorteio não encontrado.");
  return { ...draw, snapshot: draw.snapshot };
}

function compute(draw: LoadedDraw, prizesCount: number, input: ExecuteInput): WinnerComputation[] {
  const params = readParams(draw.methodParams);
  const eligible = draw.snapshot.eligibleNumbers;
  switch (draw.method) {
    case "FEDERAL_LOTTERY": {
      const a = (input.lotteryPrizes ?? []).slice(0, prizesCount).map(parseLotteryNumber);
      const b = (input.lotteryPrizesConfirm ?? []).slice(0, prizesCount).map(parseLotteryNumber);
      if (a.length < prizesCount || b.length < prizesCount) {
        throw new DrawInputError(`Informe (duas vezes) o resultado dos ${prizesCount} primeiros prêmios da Loteria Federal.`);
      }
      a.forEach((v, i) => {
        if (v !== b[i]) throw new DrawInputError(`A confirmação do ${i + 1}º prêmio não confere. Digite novamente.`);
      });
      return computeFederalLottery({ eligible, prizesCount, lotteryPrizes: a, params: federalParams(params), range: draw.campaign });
    }
    case "VERIFIABLE_HASH": {
      const a = normalizePublicInput(input.publicInput ?? "");
      const b = normalizePublicInput(input.publicInputConfirm ?? "");
      if (a !== b) throw new DrawInputError("A confirmação da entrada pública não confere. Digite novamente.");
      return computeVerifiableHash({
        eligible,
        prizesCount,
        snapshotHash: draw.snapshot.eligibleNumbersHash,
        publicInput: a,
        numberDigits: draw.snapshot.numberDigits,
        sha256Hex,
      });
    }
    case "CSPRNG":
      return computeCsprng({ eligible, prizesCount, numberDigits: draw.snapshot.numberDigits, randomInt: (max) => randomInt(max) });
  }
}

function assertReferenceReached(draw: LoadedDraw) {
  const at = readParams(draw.methodParams).referenceAt;
  if (needsReference(draw.method) && at && new Date(at).getTime() > Date.now()) {
    throw new AppError("INVALID_STATE", `A apuração só pode ser feita após o evento oficial (${new Date(at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}).`);
  }
}

/** Calcula sem gravar nada (só para métodos determinísticos: confere digitação). */
export async function previewDraw(drawId: string, input: ExecuteInput) {
  try {
    const draw = await loadDraw(db(), drawId);
    if (draw.method === "CSPRNG") throw new AppError("INVALID_STATE", "CSPRNG não tem pré-visualização: cada execução gera um resultado novo.");
    if (draw.status !== "SNAPSHOT_CREATED") throw new AppError("INVALID_STATE", "Este sorteio já foi apurado ou anulado.");
    assertReferenceReached(draw);
    const prizes = await db().prize.findMany({ where: { campaignId: draw.campaignId, deletedAt: null }, orderBy: { position: "asc" } });
    return compute(draw, prizes.length, input).map((r) => ({ ...r, prizeName: prizes[r.prizePosition - 1]?.name ?? "" }));
  } catch (e) {
    mapDrawError(e);
  }
}

/** Execução única: grava resultados imutáveis e marca os números como DRAWN. */
export async function executeDraw(drawId: string, input: ExecuteInput, actor: AdminActor) {
  if (input.confirmExecution !== true) throw new AppError("VALIDATION", "Confirme a execução da apuração.");
  try {
    const out = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM draws WHERE id = ${drawId}::uuid FOR UPDATE`;
      const draw = await loadDraw(tx, drawId);
      if (draw.status !== "SNAPSHOT_CREATED") throw new AppError("CONFLICT", "Este sorteio já foi apurado ou anulado.");
      assertReferenceReached(draw);
      const prizes = await tx.prize.findMany({ where: { campaignId: draw.campaignId, deletedAt: null }, orderBy: { position: "asc" } });
      const results = compute(draw, prizes.length, input);

      await allowDrawOperation(tx);
      for (const r of results) {
        const prize = prizes[r.prizePosition - 1]!;
        const num = await tx.campaignNumber.findUnique({
          where: { campaignId_number: { campaignId: draw.campaignId, number: r.winnerNumber } },
          include: { order: { select: { status: true } } },
        });
        if (!num || num.status !== "PAID" || !num.orderId || num.order?.status !== "PAID") {
          throw new AppError("INVALID_STATE", `O número ${pad(r.winnerNumber, draw.snapshot.numberDigits)} não está pago: apuração interrompida.`);
        }
        await tx.drawResult.create({
          data: {
            drawId,
            prizeId: prize.id,
            prizePosition: r.prizePosition,
            inputValue: r.inputValue,
            derivedNumber: r.derivedNumber,
            winnerNumber: r.winnerNumber,
            campaignNumberId: num.id,
            orderId: num.orderId,
            computation: { ...r.data, steps: r.steps, prizeName: prize.name } as Prisma.InputJsonObject,
          },
        });
        await tx.campaignNumber.update({ where: { id: num.id }, data: { status: "DRAWN", version: { increment: 1 } } });
      }
      await tx.drawSnapshot.update({
        where: { drawId },
        data: {
          result: results.map((r) => ({ prizePosition: r.prizePosition, inputValue: r.inputValue, winnerNumber: r.winnerNumber })),
          winnerNumber: results[0]!.winnerNumber,
          executedAt: new Date(),
        },
      });
      await tx.draw.update({ where: { id: drawId }, data: { status: "EXECUTED", executedAt: new Date(), executedById: actor.id } });
      await writeAudit(tx, {
        actor,
        action: "DRAW_EXECUTED",
        entityType: "draw",
        entityId: drawId,
        campaignId: draw.campaignId,
        before: { status: "SNAPSHOT_CREATED" },
        after: {
          status: "EXECUTED",
          method: draw.method,
          results: results.map((r) => ({ prize: r.prizePosition, input: r.inputValue, derived: r.derivedNumber, winner: r.winnerNumber })),
        },
      });
      return { campaignId: draw.campaignId, results };
    });
    invalidateStatusCache(out.campaignId);
    await logEvent("INFO", "DRAW", "Apuração executada", { drawId, winners: out.results.map((r) => r.winnerNumber) });
    return out.results;
  } catch (e) {
    mapDrawError(e);
  }
}

// ---------------------------------------------------------------------------
// 3. Homologação (verificação de elegibilidade) → campanha DRAWN
// ---------------------------------------------------------------------------

export async function finalizeDraw(drawId: string, input: { confirmFinalize: boolean; notes?: string }, actor: AdminActor) {
  if (input.confirmFinalize !== true) throw new AppError("VALIDATION", "Confirme a homologação.");
  try {
    const campaignId = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM draws WHERE id = ${drawId}::uuid FOR UPDATE`;
      const draw = await loadDraw(tx, drawId);
      if (draw.status !== "EXECUTED") throw new AppError("INVALID_STATE", "Só um sorteio apurado (e não anulado) pode ser homologado.");
      await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${draw.campaignId}::uuid FOR UPDATE`;
      const results = await tx.drawResult.findMany({
        where: { drawId },
        include: { campaignNumber: true, order: { select: { status: true } } },
        orderBy: { prizePosition: "asc" },
      });
      const checks = results.map((r) => ({
        prize: r.prizePosition,
        number: r.winnerNumber,
        inSnapshot: draw.snapshot.eligibleNumbers.includes(r.winnerNumber),
        numberDrawn: r.campaignNumber.status === "DRAWN" && r.campaignNumber.orderId === r.orderId,
        orderPaid: r.order.status === "PAID",
      }));
      const bad = checks.filter((c) => !c.inSnapshot || !c.numberDrawn || !c.orderPaid);
      if (bad.length > 0) {
        throw new AppError("INVALID_STATE", `Elegibilidade não confirmada para: ${bad.map((b) => pad(b.number, draw.snapshot.numberDigits)).join(", ")}.`);
      }
      await allowDrawOperation(tx);
      const now = new Date();
      for (const r of results) {
        await tx.drawResult.update({ where: { id: r.id }, data: { eligibilityVerifiedAt: now } });
        await tx.campaignNumber.update({ where: { id: r.campaignNumberId }, data: { status: "WINNER", version: { increment: 1 } } });
      }
      await tx.draw.update({ where: { id: drawId }, data: { status: "FINALIZED", finalizedAt: now, finalizedById: actor.id } });
      await tx.campaign.update({ where: { id: draw.campaignId }, data: { status: "DRAWN", version: { increment: 1 } } });
      await writeAudit(tx, {
        actor,
        action: "DRAW_FINALIZED",
        entityType: "draw",
        entityId: drawId,
        campaignId: draw.campaignId,
        before: { status: "EXECUTED" },
        after: { status: "FINALIZED", checks, campaignStatus: "DRAWN" },
        reason: input.notes?.trim() || null,
      });
      return draw.campaignId;
    });
    invalidateStatusCache(campaignId);
    await logEvent("INFO", "DRAW", "Sorteio homologado", { drawId });
  } catch (e) {
    mapDrawError(e);
  }
}

// ---------------------------------------------------------------------------
// Anulação (antes da homologação), sempre pública e auditada
// ---------------------------------------------------------------------------

export async function annulDraw(drawId: string, reason: string, actor: AdminActor) {
  const why = reason.trim();
  if (why.length < 10) throw new AppError("VALIDATION", "Descreva o motivo da anulação (mínimo 10 caracteres). Ele fica público.");
  try {
    const campaignId = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM draws WHERE id = ${drawId}::uuid FOR UPDATE`;
      const draw = await loadDraw(tx, drawId);
      if (draw.status === "FINALIZED") throw new AppError("INVALID_STATE", "Sorteio homologado não pode ser anulado.");
      if (draw.status === "FAILED") throw new AppError("INVALID_STATE", "Este sorteio já foi anulado.");
      if (draw.status === "EXECUTED" && draw.method === "CSPRNG") {
        throw new AppError("INVALID_STATE", "Uma apuração por CSPRNG já executada não pode ser anulada (seria um novo sorteio).");
      }
      if (draw.status === "EXECUTED") {
        // Números apurados voltam a PAID (flag exclusiva da anulação).
        await tx.$executeRaw`SELECT set_config('app.draw_operation', 'revert', true)`;
        await tx.$executeRaw`
          UPDATE campaign_numbers SET status = 'PAID', version = version + 1
          WHERE id IN (SELECT campaign_number_id FROM draw_results WHERE draw_id = ${drawId}::uuid) AND status = 'DRAWN'`;
      }
      await tx.draw.update({ where: { id: drawId }, data: { status: "FAILED", failedAt: new Date(), failureReason: why } });
      await writeAudit(tx, {
        actor,
        action: "DRAW_ANNULLED",
        entityType: "draw",
        entityId: drawId,
        campaignId: draw.campaignId,
        before: { status: draw.status },
        after: { status: "FAILED" },
        reason: why,
      });
      return draw.campaignId;
    });
    invalidateStatusCache(campaignId);
    await logEvent("WARN", "DRAW", "Sorteio anulado", { drawId, reason: why });
  } catch (e) {
    mapDrawError(e);
  }
}

// ---------------------------------------------------------------------------
// Entrega dos prêmios
// ---------------------------------------------------------------------------

export const deliverySchema = z.strictObject({
  status: z.enum(["PENDING_CONTACT", "CONTACTED", "DELIVERED", "FAILED"]),
  notes: z.string().trim().max(2000).optional(),
  proofUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s"'<>]+$/.test(v), "Use um endereço https:// válido.")
    .optional(),
});

const DELIVERY_NEXT: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING_CONTACT: ["CONTACTED", "FAILED"],
  CONTACTED: ["DELIVERED", "FAILED", "PENDING_CONTACT"],
  FAILED: ["CONTACTED", "PENDING_CONTACT"],
  DELIVERED: [],
};

export async function updateDelivery(resultId: string, input: z.infer<typeof deliverySchema>, actor: AdminActor) {
  await transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM draw_results WHERE id = ${resultId}::uuid FOR NO KEY UPDATE`;
    if (!row) throw new AppError("NOT_FOUND", "Resultado não encontrado.");
    const r = await tx.drawResult.findUniqueOrThrow({ where: { id: resultId }, include: { draw: { select: { status: true, campaignId: true } } } });
    if (r.draw.status !== "FINALIZED") throw new AppError("INVALID_STATE", "A entrega só é registrada depois da homologação.");
    if (r.deliveryStatus === input.status) throw new AppError("INVALID_STATE", "O prêmio já está nesta situação.");
    if (!DELIVERY_NEXT[r.deliveryStatus].includes(input.status)) {
      throw new AppError("INVALID_STATE", "Mudança de situação da entrega não permitida.");
    }
    if ((input.status === "FAILED" || input.status === "DELIVERED") && (input.notes ?? "").length < 5) {
      throw new AppError("VALIDATION", "Descreva a entrega (ou o problema) nas observações.");
    }
    const now = new Date();
    await tx.drawResult.update({
      where: { id: resultId },
      data: {
        deliveryStatus: input.status,
        deliveryNotes: input.notes || r.deliveryNotes,
        deliveryProofUrl: input.proofUrl || r.deliveryProofUrl,
        contactedAt: input.status === "CONTACTED" && !r.contactedAt ? now : r.contactedAt,
        deliveredAt: input.status === "DELIVERED" ? now : r.deliveredAt,
        deliveryUpdatedAt: now,
        deliveryUpdatedById: actor.id,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "PRIZE_DELIVERY_UPDATED",
      entityType: "draw_result",
      entityId: resultId,
      campaignId: r.draw.campaignId,
      before: { status: r.deliveryStatus },
      after: { status: input.status, proofUrl: input.proofUrl || null },
      reason: input.notes || null,
    });
  });
}

// ---------------------------------------------------------------------------
// Relatório (JSON para arquivo/impressão)
// ---------------------------------------------------------------------------

export async function drawReport(drawId: string) {
  const draw = await db().draw.findUnique({
    where: { id: drawId },
    include: {
      campaign: { select: { name: true, slug: true, totalNumbers: true, firstNumber: true, numberDigits: true, priceCents: true } },
      snapshot: true,
      createdBy: { select: { email: true } },
      executedBy: { select: { email: true } },
      finalizedBy: { select: { email: true } },
      results: {
        orderBy: { prizePosition: "asc" },
        include: { prize: { select: { name: true } }, order: { select: { code: true, customerName: true } } },
      },
    },
  });
  if (!draw || !draw.snapshot) throw new AppError("NOT_FOUND", "Sorteio não encontrado.");
  const audit = await db().auditLog.findMany({
    where: { entityType: "draw", entityId: drawId },
    orderBy: { id: "asc" },
    select: { id: true, createdAt: true, actorLabel: true, action: true, reason: true, hash: true },
  });
  const s = draw.snapshot;
  const verifiedHash = eligibleHash(s.eligibleNumbers, s.numberDigits);
  return {
    generatedAt: new Date().toISOString(),
    campaign: draw.campaign,
    draw: {
      id: draw.id,
      status: draw.status,
      method: draw.method,
      methodParams: draw.methodParams,
      createdAt: draw.createdAt,
      createdBy: draw.createdBy.email,
      executedAt: draw.executedAt,
      executedBy: draw.executedBy?.email ?? null,
      finalizedAt: draw.finalizedAt,
      finalizedBy: draw.finalizedBy?.email ?? null,
      failedAt: draw.failedAt,
      failureReason: draw.failureReason,
    },
    snapshot: {
      createdAt: s.createdAt,
      eligibleNumbersCount: s.eligibleNumbersCount,
      eligibleNumbersHash: s.eligibleNumbersHash,
      hashRecomputedNow: verifiedHash,
      hashMatches: verifiedHash === s.eligibleNumbersHash,
      hashAlgorithm: s.hashAlgorithm,
      canonicalFormat: s.canonicalFormat,
      officialMethod: s.officialMethod,
      officialMethodDescription: s.officialMethodDescription,
      officialReference: s.officialReference,
      eligibleNumbers: s.eligibleNumbers.map((n) => pad(n, s.numberDigits)),
    },
    results: draw.results.map((r) => ({
      prizePosition: r.prizePosition,
      prizeName: r.prize.name,
      inputValue: r.inputValue,
      derivedNumber: r.derivedNumber,
      winnerNumber: pad(r.winnerNumber, s.numberDigits),
      orderCode: r.order.code,
      buyerName: r.order.customerName,
      computation: r.computation,
      eligibilityVerifiedAt: r.eligibilityVerifiedAt,
      deliveryStatus: r.deliveryStatus,
      deliveredAt: r.deliveredAt,
    })),
    auditTrail: audit.map((a) => ({ ...a, id: a.id.toString() })),
  };
}

/** Lista canônica publicada (o SHA-256 deste texto é o hash do snapshot). */
export async function publicEligibleList(drawId: string): Promise<{ text: string; hash: string; slug: string } | null> {
  const draw = await db().draw.findUnique({
    where: { id: drawId },
    include: { snapshot: true, campaign: { select: { slug: true, status: true, deletedAt: true } } },
  });
  if (!draw?.snapshot || draw.campaign.deletedAt || draw.campaign.status === "DRAFT") return null;
  return {
    text: canonicalList(draw.snapshot.eligibleNumbers, draw.snapshot.numberDigits),
    hash: draw.snapshot.eligibleNumbersHash,
    slug: draw.campaign.slug,
  };
}

// ---------------------------------------------------------------------------
// Página pública de resultado (somente números — nenhum dado de comprador)
// ---------------------------------------------------------------------------

export async function getPublicDrawPage(slug: string) {
  const campaign = await db().campaign.findFirst({ where: { slug, deletedAt: null } });
  if (!campaign || campaign.status === "DRAFT") return null;
  const [draws, legal] = await Promise.all([
    db().draw.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      include: {
        snapshot: {
          select: {
            createdAt: true,
            eligibleNumbersCount: true,
            eligibleNumbersHash: true,
            hashAlgorithm: true,
            officialReference: true,
            officialMethodDescription: true,
          },
        },
        results: {
          orderBy: { prizePosition: "asc" },
          select: { prizePosition: true, winnerNumber: true, inputValue: true, computation: true, prize: { select: { name: true } } },
        },
      },
    }),
    db().legalInformation.findUnique({ where: { campaignId: campaign.id }, select: { officialDrawMethod: true, showOnPublicPage: true } }),
  ]);
  return {
    campaign: {
      name: campaign.name,
      slug: campaign.slug,
      status: campaign.status,
      numberDigits: campaign.numberDigits,
      drawMethod: campaign.drawMethod,
      drawScheduledAt: campaign.drawScheduledAt?.toISOString() ?? null,
      officialDrawMethod: legal?.showOnPublicPage ? legal.officialDrawMethod : null,
    },
    draws: draws
      .filter((d) => d.snapshot)
      .map((d) => ({
        id: d.id,
        status: d.status,
        method: d.method,
        referenceAt: readParams(d.methodParams).referenceAt ?? null,
        frozenAt: d.snapshot!.createdAt.toISOString(),
        executedAt: d.executedAt?.toISOString() ?? null,
        finalizedAt: d.finalizedAt?.toISOString() ?? null,
        failedAt: d.failedAt?.toISOString() ?? null,
        failureReason: d.failureReason,
        eligibleCount: d.snapshot!.eligibleNumbersCount,
        hash: d.snapshot!.eligibleNumbersHash,
        hashAlgorithm: d.snapshot!.hashAlgorithm,
        officialReference: d.snapshot!.officialReference,
        rule: d.snapshot!.officialMethodDescription,
        results: d.results.map((r) => ({
          position: r.prizePosition,
          prizeName: r.prize.name,
          winnerNumber: r.winnerNumber,
          inputValue: d.method === "CSPRNG" ? null : r.inputValue,
          steps: Array.isArray((r.computation as { steps?: unknown })?.steps) ? ((r.computation as { steps: string[] }).steps) : [],
        })),
      })),
  };
}
