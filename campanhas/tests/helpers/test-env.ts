/** Variáveis de ambiente dos testes (banco dedicado, nunca o de desenvolvimento). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://campanhas:campanhas_dev@localhost:5432/campanhas_test";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  DATABASE_POOL_MAX: "20",
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  AUTH_SECRET: "test-secret-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFG",
  TRUST_PROXY_HOPS: "1",
  CRON_SECRET: "test-cron-secret",
  PAYMENT_GATEWAY: "",
  PAYMENT_API_KEY: "",
  PAYMENT_WEBHOOK_SECRET: "",
  MERCADOPAGO_API_BASE_URL: "http://127.0.0.1:4999",
  MERCADOPAGO_PIX_MIN_EXPIRATION_MINUTES: "30",
};
