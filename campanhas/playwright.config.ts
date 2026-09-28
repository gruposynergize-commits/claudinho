import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: sobe o simulador do Mercado Pago e a aplicação (next dev) apontando
 * para um banco exclusivo (recriado a cada execução por tests/e2e/prepare-db.ts).
 *   npm run test:e2e
 * Requer PostgreSQL acessível em E2E_DATABASE_URL e o Chromium do Playwright.
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 4210);
const baseURL = `http://localhost:${PORT}`;

// Senha aleatória por execução (herdada pelos workers e pelos servidores).
process.env.E2E_ADMIN_PASSWORD ??= `E2e-${randomBytes(12).toString("base64url")}-9a!`;

const serverEnv: Record<string, string> = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://campanhas:campanhas_dev@localhost:5432/campanhas_e2e",
  NEXT_PUBLIC_APP_URL: baseURL,
  AUTH_SECRET: "e2e-auth-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  TRUST_PROXY_HOPS: "1",
  CRON_SECRET: "e2e-cron-secret",
  PAYMENT_GATEWAY: "mercadopago",
  PAYMENT_API_KEY: "TEST-e2e-token",
  PAYMENT_WEBHOOK_SECRET: "e2e-webhook-secret",
  PAYMENT_WEBHOOK_URL: `${baseURL}/api/webhooks/pix`,
  MERCADOPAGO_API_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
  FAKE_GATEWAY_PORT: String(GATEWAY_PORT),
  E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
};
process.env.E2E_GATEWAY_URL = serverEnv.MERCADOPAGO_API_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" }, testMatch: /public\.spec\.ts/ },
    { name: "android", use: { ...devices["Pixel 7"] }, testMatch: /public\.spec\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /(admin|automatic|draw|concurrency)\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "npx tsx scripts/fake-mercadopago.ts",
      url: `http://127.0.0.1:${GATEWAY_PORT}/__control/payments`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx tsx --conditions=react-server tests/e2e/prepare-db.ts && npx next dev -p ${PORT}`,
      url: `${baseURL}/robots.txt`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "ignore",
    },
  ],
});
