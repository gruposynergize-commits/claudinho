/**
 * Seed inicial — Campanha do Alek.
 *
 * Idempotente: se a campanha já existir, nada é alterado.
 * Não cria usuários nem credenciais (use `npm run create-admin`).
 *
 * A campanha nasce em DRAFT: só pode ser ativada pelo painel depois que as
 * informações legais forem preenchidas e o administrador declarar que a
 * operação está devidamente enquadrada/autorizada.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const CAMPAIGN = {
  slug: "alek",
  name: "Campanha do Alek",
  shortDescription: "Campanha de números para ajudar o Alek.",
  story:
    "Edite a história do Alek no painel (Configurações → Campanha) antes de ativar a campanha.",
  totalNumbers: 1200,
  firstNumber: 1,
  numberDigits: 4,
  priceCents: 490,
  orderCodePrefix: "ALEK",
  minNumbersPerOrder: 1,
  maxNumbersPerOrder: 100,
  reservationMinutes: 10,
  paymentMinutes: 30,
};

const PRIZES = [
  { position: 1, name: "Samsung Galaxy A05s usado", description: "1º prêmio." },
  { position: 2, name: "Cesta de doces da Dmialo", description: "2º prêmio." },
];

const FAQ = [
  {
    q: "Como escolho meus números?",
    a: "Toque em “Escolher números”, selecione quantos quiser e avance para o pagamento. Os números ficam reservados por alguns minutos enquanto você preenche seus dados.",
  },
  {
    q: "Quando meu pagamento é confirmado?",
    a: "A confirmação acontece quando o pagamento é identificado pelo sistema de pagamentos (ou conferido pela organização, no Pix manual). Enviar comprovante não confirma a compra automaticamente.",
  },
  {
    q: "Como acompanho minha participação?",
    a: "Use a página “Consultar” com o código do pedido e o WhatsApp informado na compra.",
  },
  {
    q: "Como funciona o sorteio?",
    a: "O método, a data e as regras de apuração estão descritos no regulamento desta campanha.",
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const existing = await prisma.campaign.findUnique({ where: { slug: CAMPAIGN.slug } });
    if (existing) {
      console.log(`Campanha "${CAMPAIGN.slug}" já existe (status ${existing.status}); seed ignorado.`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: { ...CAMPAIGN, status: "DRAFT", faq: FAQ },
      });

      // 0001..1200 em uma única instrução.
      const inserted = await tx.$executeRaw`
        INSERT INTO campaign_numbers (campaign_id, number)
        SELECT ${campaign.id}::uuid, g
        FROM generate_series(${CAMPAIGN.firstNumber}::int, ${CAMPAIGN.firstNumber + CAMPAIGN.totalNumbers - 1}::int) AS g`;
      if (inserted !== CAMPAIGN.totalNumbers) {
        throw new Error(`esperado ${CAMPAIGN.totalNumbers} números, inseridos ${inserted}`);
      }

      for (const prize of PRIZES) {
        // Origem NOT_INFORMED: não presumimos doação sem registro do administrador.
        await tx.prize.create({ data: { ...prize, campaignId: campaign.id, origin: "NOT_INFORMED" } });
      }

      await tx.legalInformation.create({ data: { campaignId: campaign.id, showOnPublicPage: true } });

      await tx.paymentSettings.create({
        data: {
          campaignId: campaign.id,
          // Começa no Pix manual (estático): o modo automático exige gateway configurado.
          mode: "MANUAL",
          pixKeyType: "CPF",
          pixKey: "13786508917",
          receiverName: "A CONFIGURAR",
          receiverCity: "A CONFIGURAR",
          gateway: null,
          environment: "SANDBOX",
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "SYSTEM",
          actorLabel: "seed",
          action: "CAMPAIGN_SEEDED",
          entityType: "campaign",
          entityId: campaign.id,
          campaignId: campaign.id,
          after: { ...CAMPAIGN, prizes: PRIZES.map((p) => p.name), pixKeyType: "CPF" },
        },
      });

      console.log(`Campanha "${campaign.name}" criada (${inserted} números, R$ 4,90, status DRAFT).`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
