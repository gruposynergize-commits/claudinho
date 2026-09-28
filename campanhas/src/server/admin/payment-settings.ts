import "server-only";
import { z } from "zod";
import { buildStaticPixPayload, normalizePixKey } from "@/lib/pix/brcode";
import { db, transaction } from "../db";
import { env } from "../env";
import { AppError } from "../errors";
import { encryptSecret, secretHint } from "../crypto";
import { writeAudit, type Actor } from "../audit";
import { getStates } from "../system-state";
import { notificationUrl } from "../payments/gateway";
import { qrSvg, svgDataUri } from "../payments/qr";
import { PLACEHOLDER, resolveGatewayCredentials } from "../payments/settings";

export const paymentSettingsSchema = z.strictObject({
  version: z.number().int(),
  mode: z.enum(["AUTOMATIC", "MANUAL"]),
  pixKeyType: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]),
  pixKey: z.string().trim().min(3).max(80),
  receiverName: z.string().trim().min(2).max(60),
  receiverCity: z.string().trim().min(2).max(40),
  gateway: z.enum(["MERCADO_PAGO"]).nullable(),
  environment: z.enum(["SANDBOX", "PRODUCTION"]),
  /** Somente escrita: vazio = manter o atual. */
  apiKey: z.string().trim().max(300).optional(),
  webhookSecret: z.string().trim().max(300).optional(),
  clearApiKey: z.boolean().optional(),
  clearWebhookSecret: z.boolean().optional(),
  webhookEnabled: z.boolean(),
});
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>;

/** Visão para a tela de configuração: nenhum segredo, apenas "configurado" e dica final. */
export async function paymentSettingsView(campaignId: string) {
  const s = await db().paymentSettings.findUnique({ where: { campaignId } });
  if (!s) return null;
  const e = env();
  const creds = (() => {
    try {
      return resolveGatewayCredentials(s);
    } catch {
      return null;
    }
  })();
  const states = await getStates(["webhook.lastReceivedAt", "webhook.lastValidAt", "webhook.lastInvalidAt", "jobs.reconcile.lastRunAt", "gateway.lastSuccessAt", "gateway.lastErrorAt"]);
  return {
    version: s.version,
    mode: s.mode,
    pixKeyType: s.pixKeyType,
    pixKey: s.pixKey,
    receiverName: s.receiverName === PLACEHOLDER ? "" : s.receiverName,
    receiverCity: s.receiverCity === PLACEHOLDER ? "" : s.receiverCity,
    gateway: s.gateway,
    environment: s.environment,
    webhookEnabled: s.webhookEnabled,
    apiKey: {
      configured: !!creds,
      source: creds?.source ?? null,
      hint: creds?.source === "env" ? secretHint(e.PAYMENT_API_KEY ?? "") : s.apiKeyHint,
    },
    webhookSecret: {
      configured: !!(e.PAYMENT_WEBHOOK_SECRET || s.webhookSecretEncrypted),
      source: e.PAYMENT_WEBHOOK_SECRET ? "env" : s.webhookSecretEncrypted ? "database" : null,
      hint: e.PAYMENT_WEBHOOK_SECRET ? secretHint(e.PAYMENT_WEBHOOK_SECRET) : s.webhookSecretHint,
    },
    envOverrides: !!(e.PAYMENT_GATEWAY === "mercadopago" && e.PAYMENT_API_KEY),
    webhookUrl: notificationUrl() ?? "(configure NEXT_PUBLIC_APP_URL com HTTPS)",
    states,
  };
}

export async function updatePaymentSettings(campaignId: string, input: PaymentSettingsInput, actor: Actor & { type: "USER" }) {
  let pixKey: string;
  try {
    pixKey = normalizePixKey(input.pixKeyType, input.pixKey);
  } catch (e) {
    throw new AppError("VALIDATION", `Chave Pix inválida: ${(e as Error).message}.`);
  }
  await transaction(async (tx) => {
    const current = await tx.paymentSettings.findUnique({ where: { campaignId } });
    if (!current) throw new AppError("NOT_FOUND", "Configuração não encontrada.");
    if (current.version !== input.version) throw new AppError("CONFLICT", "Configuração alterada por outra pessoa. Recarregue a página.");

    const data: Record<string, unknown> = {
      mode: input.mode,
      pixKeyType: input.pixKeyType,
      pixKey,
      receiverName: input.receiverName,
      receiverCity: input.receiverCity,
      gateway: input.gateway,
      environment: input.environment,
      webhookEnabled: input.webhookEnabled,
      updatedById: actor.id,
      version: { increment: 1 },
    };
    const secretChanges: string[] = [];
    if (input.apiKey) {
      data.apiKeyEncrypted = encryptSecret(input.apiKey);
      data.apiKeyHint = secretHint(input.apiKey);
      secretChanges.push("access token substituído");
    } else if (input.clearApiKey) {
      data.apiKeyEncrypted = null;
      data.apiKeyHint = null;
      secretChanges.push("access token removido");
    }
    if (input.webhookSecret) {
      data.webhookSecretEncrypted = encryptSecret(input.webhookSecret);
      data.webhookSecretHint = secretHint(input.webhookSecret);
      secretChanges.push("segredo do webhook substituído");
    } else if (input.clearWebhookSecret) {
      data.webhookSecretEncrypted = null;
      data.webhookSecretHint = null;
      secretChanges.push("segredo do webhook removido");
    }

    const updated = await tx.paymentSettings.update({ where: { campaignId }, data });
    if (updated.mode === "AUTOMATIC" && !resolveGatewayCredentials(updated)) {
      throw new AppError("VALIDATION", "Para o modo automático, configure o gateway e o access token (ou as variáveis de ambiente).");
    }
    await writeAudit(tx, {
      actor,
      action: "PAYMENT_SETTINGS_UPDATED",
      entityType: "payment_settings",
      entityId: current.id,
      campaignId,
      before: { mode: current.mode, pixKeyType: current.pixKeyType, pixKey: current.pixKey, receiverName: current.receiverName, gateway: current.gateway, environment: current.environment, webhookEnabled: current.webhookEnabled },
      after: { mode: updated.mode, pixKeyType: updated.pixKeyType, pixKey: updated.pixKey, receiverName: updated.receiverName, gateway: updated.gateway, environment: updated.environment, webhookEnabled: updated.webhookEnabled, secrets: secretChanges },
    });
  });
}

/**
 * QR Code ESTÁTICO avulso com a chave configurada. Não gera pedido e nunca
 * é confirmado automaticamente: serve para divulgação/uso manual.
 */
export async function generateStaticQr(campaignId: string, amountCents: number | null, description: string | null) {
  const s = await db().paymentSettings.findUnique({ where: { campaignId } });
  if (!s) throw new AppError("NOT_FOUND", "Configuração não encontrada.");
  if (s.receiverName === PLACEHOLDER || s.receiverCity === PLACEHOLDER) {
    throw new AppError("VALIDATION", "Configure o nome e a cidade do recebedor antes de gerar o QR Code.");
  }
  if (amountCents !== null && (!Number.isSafeInteger(amountCents) || amountCents <= 0)) {
    throw new AppError("VALIDATION", "Valor inválido.");
  }
  const copyPaste = buildStaticPixPayload({
    keyType: s.pixKeyType,
    key: s.pixKey,
    receiverName: s.receiverName,
    receiverCity: s.receiverCity,
    amountCents,
    description,
  });
  return { copyPaste, qrDataUri: svgDataUri(await qrSvg(copyPaste)), label: "Pix estático — confirmação manual" };
}
