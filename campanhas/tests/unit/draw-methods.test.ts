import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  DrawInputError,
  applyUnsoldRule,
  canonicalList,
  computeCsprng,
  computeFederalLottery,
  computeVerifiableHash,
  normalizePublicInput,
  parseLotteryNumber,
  reduceToRange,
} from "@/lib/draw/methods";

const sha256Hex = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const RANGE = { firstNumber: 1, totalNumbers: 1200, numberDigits: 4 };

describe("lista canônica e hash", () => {
  it("ordena, completa com zeros, separa por LF e termina com LF", () => {
    expect(canonicalList([10, 2, 1], 4)).toBe("0001\n0002\n0010\n");
    // Vetor fixo: qualquer pessoa pode reproduzir com `printf '0001\n0002\n0010\n' | sha256sum`.
    expect(sha256Hex(canonicalList([10, 2, 1], 4))).toBe(sha256Hex("0001\n0002\n0010\n"));
  });

  it("recusa números repetidos", () => {
    expect(() => canonicalList([1, 1], 4)).toThrow(DrawInputError);
  });
});

describe("Loteria Federal", () => {
  it("reduz o valor ao intervalo da campanha (mantém números já no intervalo)", () => {
    expect(reduceToRange(878, RANGE)).toBe(878);
    expect(reduceToRange(1200, RANGE)).toBe(1200);
    expect(reduceToRange(1201, RANGE)).toBe(1);
    expect(reduceToRange(0, RANGE)).toBe(1200);
    expect(reduceToRange(2345, RANGE)).toBe(1145);
    expect(reduceToRange(9999, RANGE)).toBe(399);
    expect(reduceToRange(99999, RANGE)).toBe(399);
  });

  it("regra de número não vendido: superior/inferior com volta ao início/fim", () => {
    const sold = [5, 100, 878, 1150];
    expect(applyUnsoldRule(879, sold, "NEXT_HIGHER")).toBe(1150);
    expect(applyUnsoldRule(1151, sold, "NEXT_HIGHER")).toBe(5);
    expect(applyUnsoldRule(879, sold, "NEXT_LOWER")).toBe(878);
    expect(applyUnsoldRule(4, sold, "NEXT_LOWER")).toBe(1150);
  });

  it("valida o resultado informado", () => {
    expect(parseLotteryNumber(" 12.345 ")).toBe("12345");
    expect(() => parseLotteryNumber("1234")).toThrow(DrawInputError);
    expect(() => parseLotteryNumber("12a45")).toThrow(DrawInputError);
  });

  it("calcula os vencedores de forma determinística, com passo a passo", () => {
    const input = {
      eligible: [5, 100, 878, 1150],
      prizesCount: 2,
      lotteryPrizes: ["10878", "54321"],
      params: { digits: 4, unsoldRule: "NEXT_HIGHER" as const },
      range: RANGE,
    };
    const a = computeFederalLottery(input);
    const b = computeFederalLottery(input);
    expect(a).toEqual(b);
    expect(a.map((r) => r.winnerNumber)).toEqual([878, 1150]);
    expect(a[0]!.derivedNumber).toBe(878);
    expect(a[1]!.derivedNumber).toBe(721); // 4321 → 1 + (4320 mod 1200)
    expect(a[1]!.steps.join(" ")).toContain("regra superior");
  });

  it("o mesmo número não é contemplado duas vezes", () => {
    const r = computeFederalLottery({
      eligible: [5, 878, 1150],
      prizesCount: 2,
      lotteryPrizes: ["10878", "20878"],
      params: { digits: 4, unsoldRule: "NEXT_HIGHER" },
      range: RANGE,
    });
    expect(r.map((x) => x.winnerNumber)).toEqual([878, 1150]);
  });

  it("recusa mais prêmios que a Loteria Federal oferece ou que números elegíveis", () => {
    const base = { params: { digits: 4, unsoldRule: "NEXT_HIGHER" as const }, range: RANGE };
    expect(() => computeFederalLottery({ ...base, eligible: [1, 2, 3, 4, 5, 6], prizesCount: 6, lotteryPrizes: Array(6).fill("12345") })).toThrow(/5 prêmios/);
    expect(() => computeFederalLottery({ ...base, eligible: [1], prizesCount: 2, lotteryPrizes: ["12345", "54321"] })).toThrow(/elegível/);
    expect(() => computeFederalLottery({ ...base, eligible: [1, 2], prizesCount: 2, lotteryPrizes: ["12345"] })).toThrow(/Informe/);
  });
});

describe("hash verificável", () => {
  const snapshotHash = sha256Hex(canonicalList([3, 7, 9, 12, 40], 4));

  it("é determinístico e reproduzível a partir dos dados publicados", () => {
    const input = { eligible: [3, 7, 9, 12, 40], prizesCount: 2, snapshotHash, publicInput: "Loteria Federal 5912: 12345", numberDigits: 4, sha256Hex };
    const a = computeVerifiableHash(input);
    expect(computeVerifiableHash(input)).toEqual(a);
    // Reprodução independente do 1º prêmio.
    const seed = `${snapshotHash}|Loteria Federal 5912: 12345|1|0`;
    const idx = Number(BigInt(`0x${sha256Hex(seed)}`) % BigInt(5));
    const limit = ((BigInt(2) ** BigInt(256)) / BigInt(5)) * BigInt(5);
    if (BigInt(`0x${sha256Hex(seed)}`) < limit) expect(a[0]!.winnerNumber).toBe([3, 7, 9, 12, 40][idx]);
    expect(new Set(a.map((r) => r.winnerNumber)).size).toBe(2);
  });

  it("espaços extras na entrada pública não mudam o resultado; outra entrada muda", () => {
    const base = { eligible: [3, 7, 9, 12, 40], prizesCount: 1, snapshotHash, numberDigits: 4, sha256Hex };
    expect(normalizePublicInput("  a   b ")).toBe("a b");
    const x = computeVerifiableHash({ ...base, publicInput: "abc  123" })[0]!.data.digest;
    const y = computeVerifiableHash({ ...base, publicInput: " abc 123 " })[0]!.data.digest;
    expect(x).toBe(y);
  });

  it("amostragem por rejeição: valores acima do limite são descartados (sem viés de módulo)", () => {
    let calls = 0;
    const fake = (t: string) => {
      calls++;
      return t.endsWith("|0") ? "f".repeat(64) : `${"0".repeat(63)}7`;
    };
    const r = computeVerifiableHash({ eligible: [3, 7, 9], prizesCount: 1, snapshotHash, publicInput: "xyz", numberDigits: 4, sha256Hex: fake });
    expect(calls).toBe(2);
    expect(r[0]!.data.attempt).toBe(1);
    expect(r[0]!.winnerNumber).toBe([3, 7, 9][7 % 3]);
  });

  it("distribuição aproximadamente uniforme (teste qui-quadrado, 6 000 execuções)", () => {
    const eligible = [1, 2, 3, 4, 5, 6];
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const [r] = computeVerifiableHash({ eligible, prizesCount: 1, snapshotHash, publicInput: `entrada-${i}`, numberDigits: 4, sha256Hex });
      counts.set(r!.winnerNumber, (counts.get(r!.winnerNumber) ?? 0) + 1);
    }
    const expected = 1000;
    const chi2 = eligible.reduce((s, n) => s + ((counts.get(n) ?? 0) - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(20.5); // 5 g.l., p ≈ 0,001
  });
});

describe("CSPRNG", () => {
  it("usa a fonte aleatória injetada, sem repetir vencedores", () => {
    const picks = [2, 0];
    const r = computeCsprng({ eligible: [10, 20, 30], prizesCount: 2, numberDigits: 4, randomInt: () => picks.shift()! });
    expect(r.map((x) => x.winnerNumber)).toEqual([30, 10]);
  });

  it("recusa índice fora do intervalo", () => {
    expect(() => computeCsprng({ eligible: [10, 20], prizesCount: 1, numberDigits: 4, randomInt: () => 2 })).toThrow(DrawInputError);
  });
});
