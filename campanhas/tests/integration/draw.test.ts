import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { db, disconnectDb } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { reserveNumbers } from "@/server/numbers/reservations";
import { createOrderFromReservation } from "@/server/orders/create";
import { confirmManualPayment } from "@/server/payments/manual";
import { customerInputSchema } from "@/server/validation/customer";
import { canonicalList } from "@/lib/draw/methods";
import {
  annulDraw,
  drawReport,
  executeDraw,
  finalizeDraw,
  freezeAndSnapshot,
  previewDraw,
  publicEligibleList,
  updateDelivery,
} from "@/server/draw/service";
import type { DrawMethod } from "@/generated/prisma/client";
import { createCampaign, resetData, uniquePhone } from "../helpers/db";

beforeEach(async () => {
  await resetData();
});
afterAll(async () => {
  await disconnectDb();
});

const sha256Hex = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function adminActor() {
  const u = await db().user.create({
    data: { email: `admin-${randomUUID().slice(0, 6)}@teste.local`, name: "Admin", role: "ADMIN", passwordHash: await hashPassword("Senha-Forte-2026!") },
  });
  return { type: "USER" as const, id: u.id, label: u.email, ip: "203.0.113.5", userAgent: "vitest" };
}

async function order(slug: string, numbers: number[]) {
  const r = await reserveNumbers({ campaignSlug: slug, numbers });
  return createOrderFromReservation({
    reservationToken: r.token,
    customer: customerInputSchema.parse({ name: "Pessoa Compradora", phone: uniquePhone() }),
    acceptTerms: true,
    acceptPrivacy: true,
    idempotencyKey: randomUUID(),
  });
}

type Actor = Awaited<ReturnType<typeof adminActor>>;

async function paidOrder(slug: string, numbers: number[], actor: Actor) {
  const o = await order(slug, numbers);
  await confirmManualPayment(
    { orderId: o.orderId, verifiedAmountCents: o.totalCents, reference: "extrato", reason: "Pix conferido", confirmedVerification: true },
    actor,
  );
  return o;
}

/** Campanha com vendas encerradas, números pagos e método definido. */
async function closedCampaign(method: DrawMethod, paid: number[][], opts: { prizes?: number } = {}) {
  const c = await createCampaign({ totalNumbers: 1200 });
  const actor = await adminActor();
  for (const nums of paid) await paidOrder(c.slug, nums, actor);
  if (opts.prizes && opts.prizes > 2) {
    for (let p = 3; p <= opts.prizes; p++) await db().prize.create({ data: { campaignId: c.id, position: p, name: `Prêmio ${p}` } });
  }
  await db().campaign.update({
    where: { id: c.id },
    data: { status: "CLOSED", drawMethod: method, drawMethodParams: method === "FEDERAL_LOTTERY" ? { digits: 4, unsoldRule: "NEXT_HIGHER" } : undefined },
  });
  return { campaign: c, actor };
}

const freezeInput = (referenceInMs = 60_000) => ({
  officialReference: "Loteria Federal — extração de teste",
  referenceAt: new Date(Date.now() + referenceInMs).toISOString(),
  confirmFreeze: true as const,
});

describe("congelamento e snapshot", () => {
  it("bloqueia com vendas abertas e com pedidos aguardando pagamento", async () => {
    const c = await createCampaign({ totalNumbers: 1200 });
    const actor = await adminActor();
    await paidOrder(c.slug, [10], actor);
    await db().campaign.update({ where: { id: c.id }, data: { drawMethod: "CSPRNG" } });
    await expect(freezeAndSnapshot(c.id, freezeInput(), actor)).rejects.toThrow(/Encerre as vendas/);

    await order(c.slug, [20]); // pendente
    await db().campaign.update({ where: { id: c.id }, data: { status: "CLOSED" } });
    await expect(freezeAndSnapshot(c.id, freezeInput(), actor)).rejects.toThrow(/aguardando pagamento/);
    expect((await db().campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("CLOSED");
    expect(await db().draw.count()).toBe(0);
  });

  it("congela, publica lista canônica com SHA-256 idêntico ao do banco e registra auditoria", async () => {
    const { campaign, actor } = await closedCampaign("FEDERAL_LOTTERY", [[7, 1150], [300], [45, 46, 47]]);
    const out = await freezeAndSnapshot(campaign.id, freezeInput(), actor);
    expect(out.count).toBe(6);

    const snap = await db().drawSnapshot.findUniqueOrThrow({ where: { drawId: out.drawId } });
    expect(snap.eligibleNumbers).toEqual([7, 45, 46, 47, 300, 1150]);
    const text = canonicalList(snap.eligibleNumbers, 4);
    expect(text).toBe("0007\n0045\n0046\n0047\n0300\n1150\n");
    expect(snap.eligibleNumbersHash).toBe(sha256Hex(text));
    const [dbHash] = await db().$queryRaw<{ h: string }[]>`SELECT draw_canonical_hash(${snap.eligibleNumbers}::int[], 4) AS h`;
    expect(dbHash!.h).toBe(snap.eligibleNumbersHash);

    const pub = await publicEligibleList(out.drawId);
    expect(sha256Hex(pub!.text)).toBe(snap.eligibleNumbersHash);

    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("FROZEN");
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "DRAW_SNAPSHOT_CREATED" } });
    expect(audit.after).toMatchObject({ eligibleNumbersHash: snap.eligibleNumbersHash, eligibleNumbersCount: 6 });
  });

  it("referência oficial precisa ser futura (snapshot antes do resultado)", async () => {
    const { campaign, actor } = await closedCampaign("FEDERAL_LOTTERY", [[1, 2]]);
    await expect(freezeAndSnapshot(campaign.id, freezeInput(-60_000), actor)).rejects.toThrow(/FUTURO/);
    await expect(freezeAndSnapshot(campaign.id, { ...freezeInput(), referenceAt: undefined }, actor)).rejects.toThrow(/data e a hora/);
    expect((await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("CLOSED");
  });

  it("depois de congelar: sem novas reservas, sem mudança de preço, prêmios ou snapshot", async () => {
    const { campaign, actor } = await closedCampaign("CSPRNG", [[1, 2, 3]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(), actor);

    await expect(reserveNumbers({ campaignSlug: campaign.slug, numbers: [50] })).rejects.toThrow();
    await expect(db().campaign.update({ where: { id: campaign.id }, data: { priceCents: 990 } })).rejects.toThrow();
    await expect(db().$executeRaw`UPDATE draw_snapshots SET eligible_numbers = '{1,2}' WHERE draw_id = ${drawId}::uuid`).rejects.toThrow();
    await expect(db().$executeRaw`DELETE FROM draw_snapshots WHERE draw_id = ${drawId}::uuid`).rejects.toThrow();
    await expect(db().$executeRaw`UPDATE campaign_numbers SET status = 'AVAILABLE' WHERE campaign_id = ${campaign.id}::uuid AND number = 1`).rejects.toThrow();
    await expect(db().$executeRaw`UPDATE campaigns SET status = 'ACTIVE' WHERE id = ${campaign.id}::uuid`).rejects.toThrow();
  });

  it("pagamento de pedido expirado confirmado após o congelamento não entra na lista", async () => {
    const c = await createCampaign({ totalNumbers: 1200 });
    const actor = await adminActor();
    await paidOrder(c.slug, [1, 3], actor);
    const late = await order(c.slug, [2]);
    await db().$executeRaw`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${late.orderId}::uuid`;
    const { expireManualOrders } = await import("@/server/orders/lifecycle");
    await expireManualOrders();
    await db().campaign.update({ where: { id: c.id }, data: { status: "CLOSED", drawMethod: "CSPRNG" } });
    const { drawId } = await freezeAndSnapshot(c.id, freezeInput(), actor);

    await expect(
      confirmManualPayment({ orderId: late.orderId, verifiedAmountCents: 490, reference: "tarde", reason: "Pix chegou tarde", confirmedVerification: true }, actor),
    ).rejects.toThrow(/congelada|não estão livres/);
    const snap = await db().drawSnapshot.findUniqueOrThrow({ where: { drawId } });
    expect(snap.eligibleNumbers).toEqual([1, 3]);
    expect((await db().campaignNumber.findFirstOrThrow({ where: { campaignId: c.id, number: 2 } })).status).toBe("AVAILABLE");
  });
});

describe("apuração", () => {
  it("Loteria Federal: só após o evento oficial, com dupla digitação; execução única", async () => {
    const { campaign, actor } = await closedCampaign("FEDERAL_LOTTERY", [[5, 100], [878], [1150]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(1500), actor);
    const input = { lotteryPrizes: ["10878", "54321"], lotteryPrizesConfirm: ["10878", "54321"], confirmExecution: true };

    await expect(executeDraw(drawId, input, actor)).rejects.toThrow(/após o evento oficial/);
    await sleep(1600);
    await expect(executeDraw(drawId, { ...input, lotteryPrizesConfirm: ["10878", "54320"] }, actor)).rejects.toThrow(/não confere/);

    const preview = await previewDraw(drawId, input);
    expect(preview!.map((r) => r.winnerNumber)).toEqual([878, 1150]);

    // Cinco execuções simultâneas: exatamente uma grava resultado.
    const runs = await Promise.allSettled(Array.from({ length: 5 }, () => executeDraw(drawId, input, actor)));
    expect(runs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const results = await db().drawResult.findMany({ where: { drawId }, orderBy: { prizePosition: "asc" } });
    expect(results.map((r) => r.winnerNumber)).toEqual([878, 1150]);
    const nums = await db().campaignNumber.findMany({ where: { campaignId: campaign.id, number: { in: [878, 1150] } } });
    expect(nums.every((n) => n.status === "DRAWN")).toBe(true);
    expect((await db().draw.findUniqueOrThrow({ where: { id: drawId } })).status).toBe("EXECUTED");
    expect(await db().auditLog.count({ where: { action: "DRAW_EXECUTED" } })).toBe(1);

    // Não existe "editar vencedor": o banco recusa qualquer alteração direta.
    await expect(db().$executeRaw`UPDATE draw_results SET winner_number = 5 WHERE draw_id = ${drawId}::uuid`).rejects.toThrow();
    await expect(db().$executeRaw`UPDATE draw_snapshots SET winner_number = 5 WHERE draw_id = ${drawId}::uuid`).rejects.toThrow();
    await expect(db().$executeRaw`DELETE FROM draw_results WHERE draw_id = ${drawId}::uuid`).rejects.toThrow();
  });

  it("hash verificável: resultado reproduzível com os dados públicos", async () => {
    const { campaign, actor } = await closedCampaign("VERIFIABLE_HASH", [[3, 7], [9, 12, 40]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(1200), actor);
    await sleep(1300);
    const out = await executeDraw(drawId, { publicInput: "Loteria Federal 5912: 12345", publicInputConfirm: "Loteria Federal 5912: 12345", confirmExecution: true }, actor);
    const snap = await db().drawSnapshot.findUniqueOrThrow({ where: { drawId } });
    // Recalcula de forma independente o 1º prêmio.
    const seed = `${snap.eligibleNumbersHash}|Loteria Federal 5912: 12345|1|0`;
    const x = BigInt(`0x${sha256Hex(seed)}`);
    const n = BigInt(5);
    const limit = ((BigInt(2) ** BigInt(256)) / n) * n;
    if (x < limit) expect(out![0]!.winnerNumber).toBe([3, 7, 9, 12, 40][Number(x % n)]);
    expect(out!.every((r) => snap.eligibleNumbers.includes(r.winnerNumber))).toBe(true);
  });

  it("CSPRNG: vencedores sempre na lista elegível; apuração executada não pode ser anulada", async () => {
    const { campaign, actor } = await closedCampaign("CSPRNG", [[1, 2], [3], [4, 5, 6]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(), actor);
    await expect(previewDraw(drawId, {})).rejects.toThrow(/pré-visualização/);
    const out = await executeDraw(drawId, { confirmExecution: true }, actor);
    expect(new Set(out!.map((r) => r.winnerNumber)).size).toBe(2);
    expect(out!.every((r) => [1, 2, 3, 4, 5, 6].includes(r.winnerNumber))).toBe(true);
    await expect(annulDraw(drawId, "Quero sortear de novo, por favor", actor)).rejects.toThrow(/CSPRNG/);
    await expect(db().$executeRaw`UPDATE draws SET status = 'FAILED', failed_at = now(), failure_reason = 'tentativa direta no banco' WHERE id = ${drawId}::uuid`).rejects.toThrow();
  });
});

describe("homologação, anulação e entrega", () => {
  it("homologa: números WINNER, campanha DRAWN e nada volta a ACTIVE", async () => {
    const { campaign, actor } = await closedCampaign("CSPRNG", [[10, 11], [12]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(), actor);
    await executeDraw(drawId, { confirmExecution: true }, actor);
    await expect(finalizeDraw(drawId, { confirmFinalize: false }, actor)).rejects.toThrow(/Confirme/);
    await finalizeDraw(drawId, { confirmFinalize: true, notes: "Conferido com a lista publicada" }, actor);

    const c = await db().campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(c.status).toBe("DRAWN");
    const winners = await db().campaignNumber.findMany({ where: { campaignId: campaign.id, status: "WINNER" } });
    expect(winners).toHaveLength(2);
    const results = await db().drawResult.findMany({ where: { drawId } });
    expect(results.every((r) => r.eligibilityVerifiedAt !== null)).toBe(true);

    await expect(db().$executeRaw`UPDATE campaigns SET status = 'ACTIVE' WHERE id = ${campaign.id}::uuid`).rejects.toThrow();
    await expect(annulDraw(drawId, "Tentativa de anular após homologar", actor)).rejects.toThrow(/homologado/);
    await expect(finalizeDraw(drawId, { confirmFinalize: true }, actor)).rejects.toThrow();

    const report = await drawReport(drawId);
    expect(report.snapshot.hashMatches).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.auditTrail.map((a) => a.action)).toEqual(["DRAW_SNAPSHOT_CREATED", "DRAW_EXECUTED", "DRAW_FINALIZED"]);
  });

  it("anulação (erro de digitação do resultado oficial) devolve números a PAID e permite novo sorteio com a mesma lista", async () => {
    const { campaign, actor } = await closedCampaign("FEDERAL_LOTTERY", [[5, 100], [878], [1150]]);
    const first = await freezeAndSnapshot(campaign.id, freezeInput(1200), actor);
    await sleep(1300);
    await executeDraw(first.drawId, { lotteryPrizes: ["10877", "54321"], lotteryPrizesConfirm: ["10877", "54321"], confirmExecution: true }, actor);
    await expect(annulDraw(first.drawId, "curto", actor)).rejects.toThrow(/mínimo 10/);
    await annulDraw(first.drawId, "Resultado digitado errado: 1º prêmio correto é 10878", actor);

    const nums = await db().campaignNumber.findMany({ where: { campaignId: campaign.id, status: { in: ["PAID", "DRAWN"] } } });
    expect(nums.every((n) => n.status === "PAID")).toBe(true);
    expect((await db().draw.findUniqueOrThrow({ where: { id: first.drawId } })).status).toBe("FAILED");

    const second = await freezeAndSnapshot(campaign.id, freezeInput(1200), actor);
    expect(second.hash).toBe(first.hash);
    await expect(freezeAndSnapshot(campaign.id, freezeInput(1200), actor)).rejects.toThrow(/em andamento/);
    await sleep(1300);
    const out = await executeDraw(second.drawId, { lotteryPrizes: ["10878", "54321"], lotteryPrizesConfirm: ["10878", "54321"], confirmExecution: true }, actor);
    expect(out!.map((r) => r.winnerNumber)).toEqual([878, 1150]);
    expect(await db().auditLog.count({ where: { action: "DRAW_ANNULLED" } })).toBe(1);
  });

  it("entrega: só após homologação, com transições válidas e observações", async () => {
    const { campaign, actor } = await closedCampaign("CSPRNG", [[1], [2]]);
    const { drawId } = await freezeAndSnapshot(campaign.id, freezeInput(), actor);
    await executeDraw(drawId, { confirmExecution: true }, actor);
    const [r1] = await db().drawResult.findMany({ where: { drawId }, orderBy: { prizePosition: "asc" } });
    await expect(updateDelivery(r1!.id, { status: "CONTACTED" }, actor)).rejects.toThrow(/homologação/);
    await finalizeDraw(drawId, { confirmFinalize: true }, actor);

    await expect(updateDelivery(r1!.id, { status: "DELIVERED", notes: "ok ok ok" }, actor)).rejects.toThrow(/não permitida/);
    await updateDelivery(r1!.id, { status: "CONTACTED", notes: "Contato por WhatsApp" }, actor);
    await expect(updateDelivery(r1!.id, { status: "DELIVERED", notes: "" }, actor)).rejects.toThrow(/observações/);
    await updateDelivery(r1!.id, { status: "DELIVERED", notes: "Entregue em mãos, recibo assinado" }, actor);
    await expect(updateDelivery(r1!.id, { status: "FAILED", notes: "tentativa" }, actor)).rejects.toThrow();
    const r = await db().drawResult.findUniqueOrThrow({ where: { id: r1!.id } });
    expect(r.deliveryStatus).toBe("DELIVERED");
    expect(r.deliveredAt).not.toBeNull();
    expect(await db().auditLog.count({ where: { action: "PRIZE_DELIVERY_UPDATED" } })).toBe(2);
  });
});
