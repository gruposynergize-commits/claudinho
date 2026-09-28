/**
 * BR Code (Pix) — padrão EMV® QRCPS-MPM conforme o "Manual de Padrões para
 * Iniciação do Pix" do Banco Central.
 *
 * Usado para o Pix ESTÁTICO (confirmação manual). Um Pix estático não permite
 * ao sistema descobrir quem pagou; por isso nunca é tratado como confirmação
 * automática.
 */

import { centsToDecimalString } from "../money";

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export type StaticPixInput = {
  keyType: PixKeyType;
  key: string;
  receiverName: string;
  receiverCity: string;
  amountCents?: number | null;
  /** Identificador exibido no extrato do recebedor (até 25 alfanuméricos). */
  txid?: string | null;
  description?: string | null;
};

const GUI = "br.gov.bcb.pix";

function tlv(id: string, value: string): string {
  if (!/^\d{2}$/.test(id)) throw new Error(`id EMV inválido: ${id}`);
  if (value.length > 99) throw new Error(`campo ${id} excede 99 caracteres`);
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF). */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos. */
export function sanitizeEmvText(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .\-/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export function normalizePixKey(type: PixKeyType, key: string): string {
  const k = key.trim();
  switch (type) {
    case "CPF": {
      const d = k.replace(/\D/g, "");
      if (d.length !== 11) throw new Error("chave CPF deve ter 11 dígitos");
      return d;
    }
    case "CNPJ": {
      const d = k.replace(/\D/g, "");
      if (d.length !== 14) throw new Error("chave CNPJ deve ter 14 dígitos");
      return d;
    }
    case "PHONE": {
      let d = k.replace(/\D/g, "");
      if (d.length === 10 || d.length === 11) d = `55${d}`;
      if (!/^55\d{10,11}$/.test(d)) throw new Error("chave telefone inválida");
      return `+${d}`;
    }
    case "EMAIL": {
      const e = k.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new Error("chave e-mail inválida");
      return e;
    }
    case "EVP": {
      const e = k.toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e)) throw new Error("chave aleatória inválida");
      return e;
    }
  }
}

export function sanitizeTxid(txid: string | null | undefined): string {
  if (!txid) return "***";
  const t = txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return t.length > 0 ? t : "***";
}

export function buildStaticPixPayload(input: StaticPixInput): string {
  const key = normalizePixKey(input.keyType, input.key);
  const name = sanitizeEmvText(input.receiverName, 25);
  const city = sanitizeEmvText(input.receiverCity, 15);
  if (!name) throw new Error("nome do recebedor obrigatório");
  if (!city) throw new Error("cidade do recebedor obrigatória");

  let merchantAccount = tlv("00", GUI) + tlv("01", key);
  if (input.description) {
    const room = 99 - merchantAccount.length - 4;
    const desc = sanitizeEmvText(input.description, Math.max(0, Math.min(room, 72)));
    if (desc) merchantAccount += tlv("02", desc);
  }

  let payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986");
  if (input.amountCents !== undefined && input.amountCents !== null) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("valor inválido");
    payload += tlv("54", centsToDecimalString(input.amountCents));
  }
  payload += tlv("58", "BR") + tlv("59", name) + tlv("60", city) + tlv("62", tlv("05", sanitizeTxid(input.txid)));
  payload += "6304";
  return payload + crc16(payload);
}

export type ParsedBrCode = {
  fields: Map<string, string>;
  merchantAccount: Map<string, string>;
  amountCents: number | null;
  crcValid: boolean;
};

function parseTlv(s: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || i + 4 + len > s.length) {
      throw new Error("BR Code malformado");
    }
    out.set(id, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/**
 * Lê um BR Code (estático ou dinâmico) e confere o CRC. Usado para validar
 * o "copia e cola" recebido do gateway antes de exibi-lo ao comprador.
 */
export function parseBrCode(payload: string): ParsedBrCode {
  const fields = parseTlv(payload);
  const crc = fields.get("63");
  const crcValid = !!crc && payload.endsWith(crc) && crc16(payload.slice(0, -4)) === crc.toUpperCase();
  const accountRaw = fields.get("26");
  const merchantAccount = accountRaw ? parseTlv(accountRaw) : new Map<string, string>();
  const amount = fields.get("54");
  let amountCents: number | null = null;
  if (amount !== undefined) {
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error("valor do BR Code inválido");
    const [int, dec = ""] = amount.split(".");
    amountCents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  }
  return { fields, merchantAccount, amountCents, crcValid };
}
