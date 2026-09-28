/**
 * Prepara o banco EXCLUSIVO dos testes E2E (nome precisa conter "e2e"):
 * recria o schema, aplica as migrações, roda o seed e configura campanhas
 * de teste. Executado pelo Playwright antes de subir o servidor.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/e2e/.test(new URL(url).pathname)) {
  throw new Error(`Recusando preparar banco que não é de E2E: ${new URL(url).pathname}`);
}
const password: string = process.env.E2E_ADMIN_PASSWORD ?? "";
if (!password) throw new Error("E2E_ADMIN_PASSWORD não definida (o playwright.config.ts gera uma).");

async function resetSchema() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();
}

async function main() {
  await resetSchema();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  // Importados só depois das migrações (conexão preguiçosa com o banco de E2E).
  const { db, disconnectDb } = await import("../../src/server/db");
  const { hashPassword } = await import("../../src/server/auth/password");
  const { encryptSecret } = await import("../../src/server/crypto");
  const { reserveNumbers } = await import("../../src/server/numbers/reservations");
  const { createOrderFromReservation } = await import("../../src/server/orders/create");
  const { confirmManualPayment } = await import("../../src/server/payments/manual");
  const { customerInputSchema } = await import("../../src/server/validation/customer");
  const prisma = db();

  const hash = await hashPassword(password);
  const admin = await prisma.user.create({ data: { email: "e2e-admin@teste.local", name: "Admin E2E", role: "ADMIN", passwordHash: hash } });
  await prisma.user.create({ data: { email: "e2e-operador@teste.local", name: "Operador E2E", role: "OPERATOR", passwordHash: hash } });
  await prisma.user.create({ data: { email: "e2e-leitor@teste.local", name: "Leitor E2E", role: "VIEWER", passwordHash: hash } });
  const actor = { type: "USER" as const, id: admin.id, label: admin.email };

  const legal = {
    operatorName: "Responsável E2E",
    entityName: "Entidade E2E",
    regulation: "Regulamento de teste automatizado.",
    modality: "Teste",
    officialDrawMethod: "Conforme regulamento de teste",
    showOnPublicPage: true,
  };

  // 1) "alek" (seed): Pix manual/estático, ativada.
  const alek = await prisma.campaign.findUniqueOrThrow({ where: { slug: "alek" } });
  await prisma.legalInformation.upsert({ where: { campaignId: alek.id }, create: { campaignId: alek.id, ...legal }, update: legal });
  await prisma.paymentSettings.update({ where: { campaignId: alek.id }, data: { receiverName: "CAMPANHA E2E", receiverCity: "CURITIBA" } });
  await prisma.campaign.update({ where: { id: alek.id }, data: { status: "ACTIVE", complianceConfirmedAt: new Date() } });

  // 2) Pix automático (simulador do Mercado Pago).
  async function newCampaign(slug: string, name: string, total: number, digits: number, prefix: string) {
    const c = await prisma.campaign.create({
      data: { slug, name, totalNumbers: total, numberDigits: digits, priceCents: 490, orderCodePrefix: prefix, story: `Campanha ${name} para testes.` },
    });
    await prisma.$executeRaw`INSERT INTO campaign_numbers (campaign_id, number) SELECT ${c.id}::uuid, g FROM generate_series(1, ${total}::int) g`;
    await prisma.prize.createMany({ data: [{ campaignId: c.id, position: 1, name: "Prêmio principal" }, { campaignId: c.id, position: 2, name: "Segundo prêmio" }] });
    await prisma.legalInformation.create({ data: { campaignId: c.id, ...legal } });
    return c;
  }
  const auto = await newCampaign("e2e-auto", "Campanha Pix Automático", 200, 3, "AUT");
  await prisma.paymentSettings.create({
    data: {
      campaignId: auto.id,
      mode: "AUTOMATIC",
      pixKeyType: "CPF",
      pixKey: "13786508917",
      receiverName: "CAMPANHA E2E",
      receiverCity: "CURITIBA",
      gateway: "MERCADO_PAGO",
      environment: "SANDBOX",
      apiKeyEncrypted: encryptSecret(process.env.PAYMENT_API_KEY ?? "TEST-e2e-token"),
      webhookSecretEncrypted: encryptSecret(process.env.PAYMENT_WEBHOOK_SECRET ?? "e2e-webhook-secret"),
    },
  });
  await prisma.campaign.update({ where: { id: auto.id }, data: { status: "ACTIVE", complianceConfirmedAt: new Date() } });

  // 3) Sorteio: vendas encerradas, números pagos, método CSPRNG.
  const draw = await newCampaign("e2e-sorteio", "Campanha do Sorteio E2E", 100, 3, "SRT");
  await prisma.paymentSettings.create({ data: { campaignId: draw.id, mode: "MANUAL", pixKeyType: "CPF", pixKey: "13786508917", receiverName: "CAMPANHA E2E", receiverCity: "CURITIBA" } });
  await prisma.campaign.update({ where: { id: draw.id }, data: { status: "ACTIVE", complianceConfirmedAt: new Date(), drawMethod: "CSPRNG" } });
  const buyers = ["Ana Souza", "Bruno Lima", "Carla Dias", "Davi Rocha"];
  const sets = [[3, 4], [17], [42, 43, 44], [88]];
  for (let i = 0; i < sets.length; i++) {
    const r = await reserveNumbers({ campaignSlug: "e2e-sorteio", numbers: sets[i]! });
    const o = await createOrderFromReservation({
      reservationToken: r.token,
      customer: customerInputSchema.parse({ name: buyers[i], phone: `4197${String(1000000 + i).slice(-7)}` }),
      acceptTerms: true,
      acceptPrivacy: true,
      idempotencyKey: randomUUID(),
    });
    await confirmManualPayment({ orderId: o.orderId, verifiedAmountCents: o.totalCents, reference: `e2e ${i}`, reason: "Pix conferido (E2E)", confirmedVerification: true }, actor);
  }
  await prisma.campaign.update({ where: { id: draw.id }, data: { status: "CLOSED" } });

  await disconnectDb();
  console.log("Banco E2E pronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
