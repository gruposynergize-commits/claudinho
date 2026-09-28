import "server-only";
import type { GatewayEnvironment, PaymentMode, PaymentSettings, PixKeyType } from "@/generated/prisma/client";
import { db, type Db } from "../db";
import { env } from "../env";
import { decryptSecret } from "../crypto";
import { AppError } from "../errors";

export const PLACEHOLDER = "A CONFIGURAR";

export type GatewayCredentials = {
  name: "MERCADO_PAGO";
  accessToken: string;
  webhookSecret: string | null;
  apiBaseUrl: string;
  environment: GatewayEnvironment;
  source: "env" | "database";
};

export type PaymentConfig = {
  settingsId: string;
  mode: PaymentMode;
  pix: { keyType: PixKeyType; key: string; receiverName: string; receiverCity: string };
  pixReceiverConfigured: boolean;
  gateway: GatewayCredentials | null;
  webhookEnabled: boolean;
};

/**
 * Credenciais do gateway: variáveis de ambiente têm precedência; na ausência,
 * usa as salvas (criptografadas) pelo painel. Nunca saem do servidor.
 */
export function resolveGatewayCredentials(settings: PaymentSettings | null): GatewayCredentials | null {
  const e = env();
  if (e.PAYMENT_GATEWAY === "mercadopago" && e.PAYMENT_API_KEY) {
    return {
      name: "MERCADO_PAGO",
      accessToken: e.PAYMENT_API_KEY,
      webhookSecret: e.PAYMENT_WEBHOOK_SECRET ?? null,
      apiBaseUrl: e.MERCADOPAGO_API_BASE_URL,
      environment: e.PAYMENT_API_KEY.startsWith("TEST-") ? "SANDBOX" : (settings?.environment ?? "PRODUCTION"),
      source: "env",
    };
  }
  if (settings?.gateway === "MERCADO_PAGO" && settings.apiKeyEncrypted) {
    return {
      name: "MERCADO_PAGO",
      accessToken: decryptSecret(settings.apiKeyEncrypted),
      webhookSecret: settings.webhookSecretEncrypted ? decryptSecret(settings.webhookSecretEncrypted) : null,
      apiBaseUrl: e.MERCADOPAGO_API_BASE_URL,
      environment: settings.environment,
      source: "database",
    };
  }
  return null;
}

export async function getPaymentSettingsRow(campaignId: string, client: Db = db()): Promise<PaymentSettings | null> {
  return client.paymentSettings.findUnique({ where: { campaignId } });
}

export async function getPaymentConfig(campaignId: string, client: Db = db()): Promise<PaymentConfig> {
  const s = await getPaymentSettingsRow(campaignId, client);
  if (!s) throw new AppError("GATEWAY_NOT_CONFIGURED", "Pagamentos ainda não foram configurados para esta campanha.");
  return {
    settingsId: s.id,
    mode: s.mode,
    pix: { keyType: s.pixKeyType, key: s.pixKey, receiverName: s.receiverName, receiverCity: s.receiverCity },
    pixReceiverConfigured: s.receiverName !== PLACEHOLDER && s.receiverCity !== PLACEHOLDER,
    gateway: resolveGatewayCredentials(s),
    webhookEnabled: s.webhookEnabled,
  };
}

/** Segredo do webhook para validar assinaturas (independe da campanha). */
export async function getWebhookSecrets(): Promise<string[]> {
  const secrets = new Set<string>();
  const e = env();
  if (e.PAYMENT_WEBHOOK_SECRET) secrets.add(e.PAYMENT_WEBHOOK_SECRET);
  const rows = await db().paymentSettings.findMany({
    where: { gateway: "MERCADO_PAGO", webhookSecretEncrypted: { not: null } },
    select: { webhookSecretEncrypted: true },
  });
  for (const r of rows) {
    if (r.webhookSecretEncrypted) {
      try {
        secrets.add(decryptSecret(r.webhookSecretEncrypted));
      } catch {
        // segredo ilegível (chave trocada): ignorado; registrado no /status
      }
    }
  }
  return [...secrets];
}
