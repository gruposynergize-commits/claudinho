import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** Token aleatório (base64url) — 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(key: string | Buffer, input: string): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

/** Comparação em tempo constante de strings. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Deriva subchaves independentes a partir do AUTH_SECRET (HKDF-SHA256). */
function deriveKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", env().AUTH_SECRET, "campanhas", purpose, length));
}

/** HMAC estável para identificadores (IP, CPF) sem guardar o valor em claro. */
export function hashIdentifier(kind: "ip" | "cpf" | "phone", value: string): string {
  return hmacSha256Hex(deriveKey(`identifier:${kind}`), value);
}

function encryptionKey(): Buffer {
  const configured = env().DATA_ENCRYPTION_KEY;
  if (configured) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY deve ter 32 bytes em base64");
    return key;
  }
  return deriveKey("data-encryption:v1");
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("formato de segredo criptografado inválido");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
}

/** "APP_USR-1234...abcd" → "…abcd" (dica exibida no painel, nunca o valor). */
export function secretHint(secret: string): string {
  return secret.length <= 4 ? "…" : `…${secret.slice(-4)}`;
}
