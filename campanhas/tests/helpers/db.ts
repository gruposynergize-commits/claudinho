import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { encryptSecret } from "@/server/crypto";
import type { PaymentMode } from "@/generated/prisma/client";

/** Apaga todos os dados (ignorando triggers de proteção) entre testes. */
export async function resetData(): Promise<void> {
  await db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"${t.tablename}"`).join(", ");
    await tx.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    await tx.$executeRawUnsafe("ALTER SEQUENCE order_code_seq RESTART WITH 1");
  });
}

export type TestCampaignOptions = {
  slug?: string;
  totalNumbers?: number;
  priceCents?: number;
  maxNumbersPerOrder?: number;
  maxNumbersPerCustomer?: number | null;
  reservationMinutes?: number;
  paymentMinutes?: number;
  mode?: PaymentMode;
  active?: boolean;
  gatewayToken?: string;
  webhookSecret?: string;
};

export const TEST_WEBHOOK_SECRET = "whsec-test-0123456789";
export const TEST_GATEWAY_TOKEN = "TEST-gateway-token-123";

export async function createCampaign(opts: TestCampaignOptions = {}) {
  const prisma = db();
  const total = opts.totalNumbers ?? 50;
  const slug = opts.slug ?? `teste-${randomUUID().slice(0, 8)}`;
  const campaign = await prisma.campaign.create({
    data: {
      slug,
      name: `Campanha ${slug}`,
      totalNumbers: total,
      priceCents: opts.priceCents ?? 490,
      orderCodePrefix: "TST",
      maxNumbersPerOrder: opts.maxNumbersPerOrder ?? 100,
      maxNumbersPerCustomer: opts.maxNumbersPerCustomer ?? null,
      reservationMinutes: opts.reservationMinutes ?? 10,
      paymentMinutes: opts.paymentMinutes ?? 30,
    },
  });
  await prisma.$executeRaw`
    INSERT INTO campaign_numbers (campaign_id, number)
    SELECT ${campaign.id}::uuid, g FROM generate_series(1, ${total}::int) g`;
  await prisma.prize.createMany({
    data: [
      { campaignId: campaign.id, position: 1, name: "Prêmio 1" },
      { campaignId: campaign.id, position: 2, name: "Prêmio 2" },
    ],
  });
  await prisma.legalInformation.create({
    data: {
      campaignId: campaign.id,
      operatorName: "Responsável Teste",
      entityName: "Entidade Teste",
      regulation: "Regulamento de teste.",
      modality: "Teste",
      officialDrawMethod: "Loteria Federal",
    },
  });
  const mode = opts.mode ?? "MANUAL";
  await prisma.paymentSettings.create({
    data: {
      campaignId: campaign.id,
      mode,
      pixKeyType: "CPF",
      pixKey: "13786508917",
      receiverName: "RECEBEDOR TESTE",
      receiverCity: "CURITIBA",
      gateway: mode === "AUTOMATIC" ? "MERCADO_PAGO" : null,
      environment: "SANDBOX",
      apiKeyEncrypted: mode === "AUTOMATIC" ? encryptSecret(opts.gatewayToken ?? TEST_GATEWAY_TOKEN) : null,
      webhookSecretEncrypted: mode === "AUTOMATIC" ? encryptSecret(opts.webhookSecret ?? TEST_WEBHOOK_SECRET) : null,
    },
  });
  if (opts.active !== false) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "ACTIVE", complianceConfirmedAt: new Date() },
    });
  }
  return prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
}

export const VALID_CUSTOMER = {
  name: "Maria da Silva",
  phone: "(41) 99999-8888",
  email: "maria@example.com",
};

let phoneSeq = 0;
/** Telefone válido e único por chamada. */
export function uniquePhone(): string {
  phoneSeq += 1;
  return `4198${String(1000000 + phoneSeq).slice(-7)}`;
}

/** Invariantes globais que nunca podem ser violados. */
export async function assertGlobalInvariants(campaignId: string): Promise<void> {
  const prisma = db();
  const dupActive = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT campaign_number_id FROM order_items WHERE campaign_id = ${campaignId}::uuid AND active
      GROUP BY campaign_number_id HAVING count(*) > 1) x`;
  if (Number(dupActive[0]?.n) !== 0) throw new Error("número em mais de um item ativo");

  const paidWithoutOrder = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM campaign_numbers cn LEFT JOIN orders o ON o.id = cn.order_id
    WHERE cn.campaign_id = ${campaignId}::uuid AND cn.status IN ('PAID','DRAWN','WINNER')
      AND (o.id IS NULL OR o.status <> 'PAID')`;
  if (Number(paidWithoutOrder[0]?.n) !== 0) throw new Error("número pago sem pedido pago");

  const paidOrdersMismatch = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM orders o
    WHERE o.campaign_id = ${campaignId}::uuid AND o.status = 'PAID'
      AND o.quantity <> (SELECT count(*) FROM campaign_numbers cn WHERE cn.order_id = o.id AND cn.status IN ('PAID','DRAWN','WINNER'))`;
  if (Number(paidOrdersMismatch[0]?.n) !== 0) throw new Error("pedido pago com contagem divergente");

  const approvedTwice = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT gateway, gateway_payment_id FROM payments WHERE gateway_payment_id IS NOT NULL
      GROUP BY gateway, gateway_payment_id HAVING count(*) > 1) x`;
  if (Number(approvedTwice[0]?.n) !== 0) throw new Error("pagamento de gateway registrado duas vezes");
}

/**
 * SOMENTE TESTES: executa SQL com os triggers de proteção desligados, para
 * simular passagem de tempo em colunas imutáveis (ex.: created_at).
 */
export async function withoutTriggers(fn: (tx: import("@/server/db").Tx) => Promise<unknown>): Promise<void> {
  await db().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await fn(tx);
  });
}
