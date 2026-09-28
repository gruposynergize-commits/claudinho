/**
 * Simulador local do Mercado Pago para desenvolvimento:
 *   npm run fake-gateway
 * Use no .env: MERCADOPAGO_API_BASE_URL=http://localhost:4010
 * NUNCA use em produção.
 */
import "dotenv/config";
import { FakeMercadoPago } from "../dev/fake-mercadopago";

const port = Number(process.env.FAKE_GATEWAY_PORT ?? 4010);
const accessToken = process.env.PAYMENT_API_KEY ?? "TEST-fake-access-token";
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? "dev-webhook-secret";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const fake = new FakeMercadoPago({
  port,
  accessToken,
  webhookSecret,
  defaultNotificationUrl: `${appUrl}/api/webhooks/pix`,
  log: true,
});

fake.start().then((url) => {
  console.log(`Simulador Mercado Pago em ${url}`);
  console.log(`Aprovar pagamento: curl -X POST ${url}/__control/payments/<id>/approve`);
});
