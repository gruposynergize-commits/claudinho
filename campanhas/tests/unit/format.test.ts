import { describe, expect, it } from "vitest";
import {
  formatNumber,
  formatPhone,
  isValidCpf,
  maskCpf,
  maskEmail,
  maskPhone,
  normalizeBrazilPhone,
  shortName,
  yyyymmdd,
} from "@/lib/format";
import { customerInputSchema } from "@/server/validation/customer";

describe("formatação", () => {
  it("formata números com zeros à esquerda", () => {
    expect(formatNumber(1, 4)).toBe("0001");
    expect(formatNumber(1200, 4)).toBe("1200");
  });

  it("data do código do pedido usa o fuso de Brasília", () => {
    // 02:30 UTC de 29/09 ainda é 28/09 em São Paulo.
    expect(yyyymmdd(new Date("2026-09-29T02:30:00Z"))).toBe("20260928");
    expect(yyyymmdd(new Date("2026-09-29T03:30:00Z"))).toBe("20260929");
  });

  it("normaliza WhatsApp brasileiro", () => {
    expect(normalizeBrazilPhone("(41) 99999-8888")).toBe("5541999998888");
    expect(normalizeBrazilPhone("+55 41 99999-8888")).toBe("5541999998888");
    expect(normalizeBrazilPhone("4133334444")).toBe("554133334444");
    expect(normalizeBrazilPhone("41 89999-8888")).toBeNull(); // celular de 9 dígitos deve começar com 9
    expect(normalizeBrazilPhone("123")).toBeNull();
    expect(normalizeBrazilPhone("(01) 99999-8888")).toBeNull();
    expect(formatPhone("5541999998888")).toBe("(41) 99999-8888");
  });

  it("mascara dados pessoais", () => {
    expect(maskPhone("5541999998888")).toBe("(41) *****-8888");
    expect(maskEmail("maria.silva@gmail.com")).toBe("m***@gmail.com");
    expect(maskCpf("52998224725")).toBe("***.***.247-25");
    expect(shortName("Maria da Silva Souza")).toBe("Maria S.");
  });

  it("valida CPF pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("137.865.089-17")).toBe(true);
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });
});

describe("validação do comprador", () => {
  it("aceita dados válidos e normaliza", () => {
    const r = customerInputSchema.parse({
      name: "  Maria   da Silva ",
      phone: "(41) 99999-8888",
      email: " Maria@Example.com ",
      cpf: "",
    });
    expect(r).toEqual({ name: "Maria da Silva", phone: "5541999998888", email: "maria@example.com", cpf: undefined });
  });

  it("rejeita nome incompleto, script e campos extras (ex.: preço)", () => {
    expect(customerInputSchema.safeParse({ name: "Maria", phone: "41999998888" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: "<script>x</script>", phone: "41999998888" }).success).toBe(false);
    expect(
      customerInputSchema.safeParse({ name: "Maria Silva", phone: "41999998888", priceCents: 1 }).success,
    ).toBe(false);
  });
});
