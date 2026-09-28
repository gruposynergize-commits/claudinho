import { describe, expect, it } from "vitest";
import { buildStaticPixPayload, crc16, normalizePixKey, parseBrCode, sanitizeTxid } from "@/lib/pix/brcode";

describe("BR Code Pix (EMV)", () => {
  it("CRC16-CCITT-FALSE confere com o valor de verificação padrão", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("reproduz exatamente o exemplo do Manual de Padrões do Banco Central", () => {
    const payload = buildStaticPixPayload({
      keyType: "EVP",
      key: "123e4567-e12b-12d1-a456-426655440000",
      receiverName: "Fulano de Tal",
      receiverCity: "BRASILIA",
    });
    expect(payload).toBe(
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D",
    );
  });

  it("gera Pix estático com a chave CPF da campanha, valor e identificador do pedido", () => {
    const payload = buildStaticPixPayload({
      keyType: "CPF",
      key: "137.865.089-17",
      receiverName: "Campanha do Alek",
      receiverCity: "São Paulo",
      amountCents: 1470,
      txid: "ALEK-20260928-000001",
    });
    const parsed = parseBrCode(payload);
    expect(parsed.crcValid).toBe(true);
    expect(parsed.merchantAccount.get("00")).toBe("br.gov.bcb.pix");
    expect(parsed.merchantAccount.get("01")).toBe("13786508917");
    expect(parsed.amountCents).toBe(1470);
    expect(parsed.fields.get("54")).toBe("14.70");
    expect(parsed.fields.get("53")).toBe("986");
    expect(parsed.fields.get("59")).toBe("Campanha do Alek");
    expect(parsed.fields.get("60")).toBe("Sao Paulo");
    expect(parsed.fields.get("62")).toBe("0518ALEK20260928000001");
  });

  it("detecta BR Code adulterado (CRC inválido)", () => {
    const payload = buildStaticPixPayload({
      keyType: "CPF",
      key: "13786508917",
      receiverName: "Teste",
      receiverCity: "Curitiba",
      amountCents: 4900,
    });
    const tampered = payload.replace("49.00", "04.90");
    expect(parseBrCode(tampered).crcValid).toBe(false);
  });

  it("normaliza e valida chaves", () => {
    expect(normalizePixKey("PHONE", "(41) 99999-8888")).toBe("+5541999998888");
    expect(normalizePixKey("EMAIL", "Pix@Exemplo.com")).toBe("pix@exemplo.com");
    expect(() => normalizePixKey("CPF", "123")).toThrow();
    expect(() => normalizePixKey("EVP", "nao-e-uuid")).toThrow();
  });

  it("txid só aceita alfanuméricos até 25 caracteres", () => {
    expect(sanitizeTxid("ALEK-2026-0001")).toBe("ALEK20260001");
    expect(sanitizeTxid("x".repeat(40))).toHaveLength(25);
    expect(sanitizeTxid(null)).toBe("***");
    expect(sanitizeTxid("---")).toBe("***");
  });

  it("rejeita valor inválido e nome/cidade vazios", () => {
    const base = { keyType: "CPF" as const, key: "13786508917", receiverName: "A", receiverCity: "B" };
    expect(() => buildStaticPixPayload({ ...base, amountCents: 0 })).toThrow();
    expect(() => buildStaticPixPayload({ ...base, receiverName: "   " })).toThrow();
  });
});
