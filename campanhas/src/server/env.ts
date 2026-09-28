import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente validadas. A leitura é preguiçosa para que o build
 * não exija segredos; a primeira requisição falha de forma explícita se algo
 * obrigatório estiver ausente.
 */

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL deve ser uma URL"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET deve ter ao menos 32 caracteres"),
  DATA_ENCRYPTION_KEY: optionalString,
  /** Quantos proxies confiáveis (que anexam/definem X-Forwarded-For) ficam à frente da aplicação. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CRON_SECRET: optionalString,
  PAYMENT_GATEWAY: optionalString.pipe(z.enum(["mercadopago"]).optional()),
  PAYMENT_API_KEY: optionalString,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  MERCADOPAGO_API_BASE_URL: z.string().url().default("https://api.mercadopago.com"),
  MERCADOPAGO_PIX_MIN_EXPIRATION_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  PAYMENT_WEBHOOK_URL: optionalString,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração de ambiente inválida: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
    throw new Error("Em produção NEXT_PUBLIC_APP_URL deve usar HTTPS");
  }
  cached = parsed.data;
  return cached;
}

/** Somente para testes: força a releitura de process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function appUrl(): URL {
  return new URL(env().NEXT_PUBLIC_APP_URL);
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}
