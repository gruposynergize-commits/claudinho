import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  expireCartReservations,
  getReservationByToken,
  releaseReservation,
  reserveNumbers,
} from "@/server/numbers/reservations";
import { assertGlobalInvariants, createCampaign, resetData } from "../helpers/db";

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await disconnectDb();
});

type Outcome = { ok: true; token: string } | { ok: false; error: unknown };

function attempt(slug: string, numbers: number[]): Promise<Outcome> {
  return reserveNumbers({ campaignSlug: slug, numbers }).then(
    (r) => ({ ok: true as const, token: r.token }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

describe("reserva de números", () => {
  it("reserva números disponíveis e calcula o total com o preço do banco", async () => {
    const c = await createCampaign({ totalNumbers: 1200, priceCents: 490 });
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [10, 345, 782, 10] });
    expect(r.numbers).toEqual([10, 345, 782]);
    expect(r.unitPriceCents).toBe(490);
    expect(r.totalCents).toBe(1470);

    const rows = await db().campaignNumber.findMany({
      where: { campaignId: c.id, number: { in: [10, 345, 782] } },
    });
    expect(rows.every((n) => n.status === "RESERVED" && n.reservationId === r.reservationId)).toBe(true);
    const view = await getReservationByToken(r.token);
    expect(view?.usable).toBe(true);
    expect(view?.numbers).toEqual([10, 345, 782]);
  });

  it("é tudo ou nada: se um número está indisponível, nenhum é reservado", async () => {
    const c = await createCampaign();
    await reserveNumbers({ campaignSlug: c.slug, numbers: [5] });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [3, 4, 5] })).rejects.toMatchObject({
      code: "NUMBERS_UNAVAILABLE",
      details: { unavailable: [5] },
    });
    const reserved = await db().campaignNumber.count({ where: { campaignId: c.id, status: "RESERVED" } });
    expect(reserved).toBe(1);
    expect(await db().reservation.count()).toBe(1);
  });

  it("rejeita números fora da faixa, seleção vazia e acima do limite", async () => {
    const c = await createCampaign({ totalNumbers: 50, maxNumbersPerOrder: 5 });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [51] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [0] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [] })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [1, 2, 3, 4, 5, 6] })).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [1.5] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: ["1"] as unknown as number[] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("não reserva em campanha que não está ativa", async () => {
    const c = await createCampaign({ active: false });
    await expect(reserveNumbers({ campaignSlug: c.slug, numbers: [1] })).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_ACTIVE",
    });
  });

  it("libera a reserva quando o comprador desiste", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [1, 2] });
    expect(await releaseReservation(r.token)).toBe(true);
    expect(await db().campaignNumber.count({ where: { campaignId: c.id, status: "AVAILABLE" } })).toBe(50);
    expect(await releaseReservation(r.token)).toBe(false);
  });

  it("trocar a seleção libera a reserva anterior na mesma transação", async () => {
    const c = await createCampaign();
    const first = await reserveNumbers({ campaignSlug: c.slug, numbers: [1, 2] });
    const second = await reserveNumbers({ campaignSlug: c.slug, numbers: [2, 3], replaceToken: first.token });
    expect(second.numbers).toEqual([2, 3]);
    const statuses = await db().campaignNumber.findMany({
      where: { campaignId: c.id, number: { in: [1, 2, 3] } },
      orderBy: { number: "asc" },
    });
    expect(statuses.map((s) => s.status)).toEqual(["AVAILABLE", "RESERVED", "RESERVED"]);
  });
});

describe("expiração de reservas", () => {
  it("rotina devolve números de reservas vencidas (RESERVED → AVAILABLE)", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [7, 8] });
    await db().$executeRaw`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = ${r.reservationId}::uuid`;
    await db().$executeRaw`UPDATE campaign_numbers SET reserved_until = now() - interval '1 minute' WHERE reservation_id = ${r.reservationId}::uuid`;
    expect(await expireCartReservations()).toBe(1);
    const nums = await db().campaignNumber.findMany({ where: { campaignId: c.id, number: { in: [7, 8] } } });
    expect(nums.every((n) => n.status === "AVAILABLE" && n.reservationId === null)).toBe(true);
    const res = await db().reservation.findUniqueOrThrow({ where: { id: r.reservationId } });
    expect(res.status).toBe("EXPIRED");
    expect((await getReservationByToken(r.token))?.usable).toBe(false);
  });

  it("número de reserva vencida pode ser reservado por outra pessoa antes da rotina rodar", async () => {
    const c = await createCampaign();
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [9, 10] });
    await db().$executeRaw`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = ${r.reservationId}::uuid`;
    await db().$executeRaw`UPDATE campaign_numbers SET reserved_until = now() - interval '1 minute' WHERE reservation_id = ${r.reservationId}::uuid`;
    const other = await reserveNumbers({ campaignSlug: c.slug, numbers: [10] });
    expect(other.numbers).toEqual([10]);
    // A reserva antiga inteira foi encerrada, não ficou "meio válida".
    const old = await db().reservation.findUniqueOrThrow({ where: { id: r.reservationId } });
    expect(old.status).toBe("EXPIRED");
    const n9 = await db().campaignNumber.findFirstOrThrow({ where: { campaignId: c.id, number: 9 } });
    expect(n9.status).toBe("AVAILABLE");
  });

  it("reserva ainda válida não é liberada pela rotina", async () => {
    const c = await createCampaign();
    await reserveNumbers({ campaignSlug: c.slug, numbers: [1] });
    expect(await expireCartReservations()).toBe(0);
    expect(await db().campaignNumber.count({ where: { campaignId: c.id, status: "RESERVED" } })).toBe(1);
  });
});

describe("CONCORRÊNCIA (obrigatório)", () => {
  it("100 requisições simultâneas pelo mesmo número: 1 reserva, 99 falhas controladas", async () => {
    const c = await createCampaign({ totalNumbers: 1200 });
    const results = await Promise.all(Array.from({ length: 100 }, () => attempt(c.slug, [500])));

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r): r is { ok: false; error: unknown } => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(99);
    for (const l of losses) {
      expect(l.error).toBeInstanceOf(AppError);
      expect((l.error as AppError).code).toBe("NUMBERS_UNAVAILABLE");
    }

    const n = await db().campaignNumber.findFirstOrThrow({ where: { campaignId: c.id, number: 500 } });
    expect(n.status).toBe("RESERVED");
    expect(await db().reservation.count({ where: { campaignId: c.id } })).toBe(1);
    await assertGlobalInvariants(c.id);
  });

  it("seleções sobrepostas concorrentes nunca compartilham números", async () => {
    const c = await createCampaign({ totalNumbers: 100 });
    // 60 compradores disputando janelas sobrepostas de 3 números.
    const sets = Array.from({ length: 60 }, (_, i) => [(i % 20) + 1, (i % 20) + 2, (i % 20) + 3]);
    const results = await Promise.all(sets.map((s) => attempt(c.slug, s)));
    const winners = results.flatMap((r, i) => (r.ok ? [sets[i]!] : []));

    const all = winners.flat();
    expect(new Set(all).size).toBe(all.length); // nenhum número em duas reservas
    const reserved = await db().campaignNumber.findMany({
      where: { campaignId: c.id, status: "RESERVED" },
      select: { number: true, reservationId: true },
    });
    expect(reserved.length).toBe(all.length);
    const reservations = await db().reservation.findMany({ where: { campaignId: c.id } });
    expect(reservations.length).toBe(winners.length);
    for (const res of reservations) {
      expect(reserved.filter((n) => n.reservationId === res.id).length).toBe(res.quantity);
    }
  });
});
