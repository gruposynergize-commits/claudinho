import "server-only";
import { db } from "../../db";
import { env, appUrl } from "../../env";
import { getPaymentConfig, resolveGatewayCredentials, type GatewayCredentials } from "../settings";
import { MercadoPagoClient } from "./mercadopago";
import { GatewayError, type PixGatewayClient } from "./types";

export function clientFor(creds: GatewayCredentials): PixGatewayClient {
  return new MercadoPagoClient(creds.accessToken, creds.apiBaseUrl);
}

export async function gatewayForCampaign(campaignId: string): Promise<PixGatewayClient> {
  const cfg = await getPaymentConfig(campaignId);
  if (!cfg.gateway) throw new GatewayError("not_configured", "gateway não configurado");
  return clientFor(cfg.gateway);
}

/**
 * Todos os conjuntos de credenciais distintos (env + por campanha). Usado
 * quando um webhook chega para um pagamento que ainda não conhecemos.
 */
export async function allGatewayClients(): Promise<PixGatewayClient[]> {
  const rows = await db().paymentSettings.findMany();
  const seen = new Map<string, PixGatewayClient>();
  const envCreds = resolveGatewayCredentials(null);
  if (envCreds) seen.set(envCreds.accessToken, clientFor(envCreds));
  for (const r of rows) {
    try {
      const c = resolveGatewayCredentials(r);
      if (c && !seen.has(c.accessToken)) seen.set(c.accessToken, clientFor(c));
    } catch {
      // credencial ilegível: ignorada
    }
  }
  return [...seen.values()];
}

/** URL de notificação enviada ao gateway (precisa ser pública e HTTPS em produção). */
export function notificationUrl(): string | null {
  const e = env();
  const url = e.PAYMENT_WEBHOOK_URL ?? new URL("/api/webhooks/pix", appUrl()).toString();
  const usingRealGateway = e.MERCADOPAGO_API_BASE_URL.startsWith("https://api.mercadopago.com");
  if (usingRealGateway && !url.startsWith("https://")) return null;
  return url;
}
