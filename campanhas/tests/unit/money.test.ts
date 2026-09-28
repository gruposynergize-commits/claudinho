import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  centsToGatewayAmount,
  formatBRL,
  gatewayAmountToCents,
  multiplyCents,
  parseBRLToCents,
} from "@/lib/money";

describe("dinheiro em centavos", () => {
  it("10 × R$ 4,90 = R$ 49,00 sem ponto flutuante", () => {
    expect(multiplyCents(490, 10)).toBe(4900);
    expect(formatBRL(4900)).toBe("R$ 49,00");
  });

  it("7 × R$ 4,90 = R$ 34,30", () => {
    expect(multiplyCents(490, 7)).toBe(3430);
    expect(formatBRL(3430)).toBe("R$ 34,30");
  });

  it("1.200 × R$ 4,90 = R$ 5.880,00", () => {
    expect(formatBRL(multiplyCents(490, 1200))).toBe("R$ 5.880,00");
  });

  it("rejeita quantidades e valores inválidos", () => {
    expect(() => multiplyCents(490, 0)).toThrow();
    expect(() => multiplyCents(490, 1.5)).toThrow();
    expect(() => multiplyCents(-1, 2)).toThrow();
    expect(() => multiplyCents(4.9, 2)).toThrow();
    expect(() => multiplyCents(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });

  it("converte para o formato decimal do gateway e volta sem perda", () => {
    for (const cents of [1, 10, 99, 490, 1470, 3430, 4900, 588000, 123456789]) {
      expect(gatewayAmountToCents(centsToGatewayAmount(cents))).toBe(cents);
      expect(gatewayAmountToCents(centsToDecimalString(cents))).toBe(cents);
    }
    expect(centsToDecimalString(1470)).toBe("14.70");
    expect(centsToGatewayAmount(1470)).toBe(14.7);
  });

  it("valores do gateway com artefatos de float são aceitos; mais de 2 casas não", () => {
    expect(gatewayAmountToCents(0.1 + 0.2)).toBe(30);
    expect(gatewayAmountToCents(34.300000000000004)).toBe(3430);
    expect(() => gatewayAmountToCents(4.905)).toThrow();
    expect(() => gatewayAmountToCents("abc")).toThrow();
    expect(() => gatewayAmountToCents(-1)).toThrow();
    expect(() => gatewayAmountToCents(null)).toThrow();
  });

  it("lê valores digitados no painel", () => {
    expect(parseBRLToCents("4,90")).toBe(490);
    expect(parseBRLToCents("R$ 4.9")).toBe(490);
    expect(parseBRLToCents("10")).toBe(1000);
    expect(() => parseBRLToCents("4,999")).toThrow();
    expect(() => parseBRLToCents("-1")).toThrow();
  });
});
