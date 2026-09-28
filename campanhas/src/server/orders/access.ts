import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { env } from "../env";
import { sha256Hex } from "../crypto";

/**
 * Token de acesso ao pedido (link /pedido/<token>).
 *
 * O código do pedido é sequencial e NÃO dá acesso a nada sozinho. O token é
 * um HMAC do id do pedido com chave derivada do AUTH_SECRET: impossível de
 * adivinhar, mas recalculável pelo servidor (ex.: reenviar confirmação).
 * No banco guardamos apenas o SHA-256 do token.
 */
function accessKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", env().AUTH_SECRET, "campanhas", "order-access:v1", 32));
}

export function orderAccessToken(orderId: string): string {
  return createHmac("sha256", accessKey()).update(orderId).digest("base64url");
}

export function orderAccessTokenHash(orderId: string): string {
  return sha256Hex(orderAccessToken(orderId));
}

export function hashAccessToken(token: string): string {
  return sha256Hex(token);
}

export function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,50}$/.test(token);
}
