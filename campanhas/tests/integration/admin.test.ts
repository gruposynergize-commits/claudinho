import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db, disconnectDb } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { reserveNumbers } from "@/server/numbers/reservations";
import { createOrderFromReservation } from "@/server/orders/create";
import { customerInputSchema } from "@/server/validation/customer";
import type { UserRole } from "@/generated/prisma/client";
import { POST as loginRoute } from "@/app/api/admin/auth/login/route";
import { GET as statusRoute } from "@/app/api/admin/status/route";
import { GET as listOrdersRoute, POST as adminOrderRoute } from "@/app/api/admin/orders/route";
import { POST as confirmRoute } from "@/app/api/admin/orders/[id]/confirm-payment/route";
import { PUT as campaignRoute } from "@/app/api/admin/campaigns/[id]/route";
import { POST as createUserRoute } from "@/app/api/admin/users/route";
import { POST as updateUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as ownPasswordRoute } from "@/app/api/admin/me/password/route";
import { GET as exportRoute } from "@/app/api/admin/campaigns/[id]/export/[type]/route";
import { createCampaign, resetData, uniquePhone } from "../helpers/db";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Senha-Forte-2026!";

beforeEach(async () => {
  await resetData();
});
afterAll(async () => {
  await disconnectDb();
});

type ReqOpts = { method?: string; body?: unknown; token?: string; origin?: string | null; referer?: string };

function req(path: string, o: ReqOpts = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "203.0.113.10", "user-agent": "vitest" });
  if (o.origin !== null) headers.set("origin", o.origin ?? ORIGIN);
  if (o.referer) headers.set("referer", o.referer);
  if (o.token) headers.set("cookie", `campanhas_session=${o.token}`);
  return new NextRequest(`${ORIGIN}${path}`, {
    method: o.method ?? (o.body === undefined ? "GET" : "POST"),
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

function params<P extends Record<string, string>>(p: P) {
  return { params: Promise.resolve(p) };
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } };
}

async function makeUser(role: UserRole, email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@teste.local`) {
  const user = await db().user.create({ data: { email, name: `Usuário ${role}`, role, passwordHash: await hashPassword(PASSWORD) } });
  const { token } = await createSession(user.id, { ip: "203.0.113.10", userAgent: "vitest" });
  return { user, token };
}

async function manualOrder(slug: string, numbers: number[]) {
  const r = await reserveNumbers({ campaignSlug: slug, numbers });
  return createOrderFromReservation({
    reservationToken: r.token,
    customer: customerInputSchema.parse({ name: "Maria da Silva", phone: uniquePhone(), email: "maria@example.com" }),
    acceptTerms: true,
    acceptPrivacy: true,
    idempotencyKey: randomUUID(),
  });
}

const confirmBody = (cents: number) => ({
  verifiedAmountCents: cents,
  reference: "E2E 0987 10h32 Maria",
  reason: "Pix conferido no extrato do banco",
  confirmedVerification: true,
});

describe("login do painel", () => {
  it("mensagem única para e-mail inexistente e senha errada; sucesso cria sessão com cookie seguro", async () => {
    const { user } = await makeUser("ADMIN", "admin@teste.local");

    const unknown = await loginRoute(req("/api/admin/auth/login", { body: { email: "nao-existe@teste.local", password: PASSWORD } }), params({}));
    const wrong = await loginRoute(req("/api/admin/auth/login", { body: { email: "admin@teste.local", password: "Errada-2026!!" } }), params({}));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((await json(unknown)).error?.message).toBe((await json(wrong)).error?.message);

    const good = await loginRoute(req("/api/admin/auth/login", { body: { email: "ADMIN@teste.local", password: PASSWORD } }), params({}));
    expect(good.status).toBe(200);
    const cookie = good.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^campanhas_session=[\w-]{40,};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    const token = /campanhas_session=([^;]+)/.exec(cookie)![1]!;

    // O banco guarda só o hash do token: vazamento do banco não dá sessões válidas.
    const sessions = await db().session.findMany({ where: { userId: user.id } });
    expect(sessions.map((s) => s.id)).toContain(sha256Hex(token));
    expect(sessions.map((s) => s.id)).not.toContain(token);

    const audit = await db().auditLog.findFirst({ where: { action: "USER_LOGIN", entityId: user.id } });
    expect(audit).not.toBeNull();
  });

  it("bloqueia a conta após 5 senhas erradas (nem a senha certa entra) e registra log de segurança", async () => {
    await makeUser("ADMIN", "alvo@teste.local");
    for (let i = 0; i < 5; i++) {
      const r = await loginRoute(req("/api/admin/auth/login", { body: { email: "alvo@teste.local", password: `Errada-${i}-2026!` } }), params({}));
      expect(r.status).toBe(401);
    }
    const locked = await loginRoute(req("/api/admin/auth/login", { body: { email: "alvo@teste.local", password: PASSWORD } }), params({}));
    expect(locked.status).toBe(401);
    const u = await db().user.findUniqueOrThrow({ where: { email: "alvo@teste.local" } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const logs = await db().systemLog.count({ where: { category: "SECURITY", message: { contains: "bloqueada" } } });
    expect(logs).toBe(1);
  });

  it("aplica rate limit por e-mail mesmo variando o IP", async () => {
    await makeUser("ADMIN", "rl@teste.local");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = req("/api/admin/auth/login", { body: { email: "rl@teste.local", password: "Errada-2026!!" } });
      r.headers.set("x-forwarded-for", `198.51.100.${i + 1}`);
      statuses.push((await loginRoute(r, params({}))).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
  });

  it("login sem Origin de mesma origem é recusado (CSRF de login)", async () => {
    await makeUser("ADMIN", "csrf@teste.local");
    const r = await loginRoute(
      req("/api/admin/auth/login", { body: { email: "csrf@teste.local", password: PASSWORD }, origin: "https://site-malicioso.example" }),
      params({}),
    );
    expect(r.status).toBe(403);
    expect(await db().session.count()).toBe(1); // só a sessão criada por makeUser
  });
});

describe("autenticação, CSRF e RBAC nas rotas do painel", () => {
  it("sem sessão: 401 em leitura e em mutação", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [1]);
    expect((await statusRoute(req("/api/admin/status"), params({}))).status).toBe(401);
    const r = await confirmRoute(req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490) }), params({ id: o.orderId }));
    expect(r.status).toBe(401);
    expect((await db().order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("PENDING_PAYMENT");
  });

  it("token inválido/forjado não autentica", async () => {
    const forged = "x".repeat(43);
    expect((await statusRoute(req("/api/admin/status", { token: forged }), params({}))).status).toBe(401);
  });

  it("mutação autenticada vinda de outra origem é bloqueada (CSRF) e nada muda", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [2]);
    const { token } = await makeUser("ADMIN");
    const evil = await confirmRoute(
      req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490), token, origin: "https://site-malicioso.example" }),
      params({ id: o.orderId }),
    );
    expect(evil.status).toBe(403);
    expect((await json(evil)).error?.code).toBe("CSRF");
    const noOrigin = await confirmRoute(
      req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490), token, origin: null }),
      params({ id: o.orderId }),
    );
    expect(noOrigin.status).toBe(403);
    expect((await db().order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("PENDING_PAYMENT");
  });

  it("OPERADOR não acessa funções de administrador; tentativa gera log de segurança", async () => {
    const c = await createCampaign();
    const { token } = await makeUser("OPERATOR");
    expect((await statusRoute(req("/api/admin/status", { token }), params({}))).status).toBe(403);
    const put = await campaignRoute(req(`/api/admin/campaigns/${c.id}`, { method: "PUT", body: { version: c.version }, token }), params({ id: c.id }));
    expect(put.status).toBe(403);
    const created = await createUserRoute(
      req("/api/admin/users", { body: { email: "novo@teste.local", name: "Novo Admin", role: "ADMIN", password: PASSWORD }, token }),
      params({}),
    );
    expect(created.status).toBe(403);
    expect(await db().user.count({ where: { email: "novo@teste.local" } })).toBe(0);
    const exp = await exportRoute(req(`/api/admin/campaigns/${c.id}/export/compradores`, { token }), params({ id: c.id, type: "compradores" }));
    expect(exp.status).toBe(403);
    expect(await db().systemLog.count({ where: { category: "SECURITY", message: { contains: "Acesso negado" } } })).toBe(4);
  });

  it("SOMENTE LEITURA não confirma pagamento e recebe telefone/e-mail mascarados", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [3]);
    const { token } = await makeUser("VIEWER");
    const r = await confirmRoute(req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490), token }), params({ id: o.orderId }));
    expect(r.status).toBe(403);
    expect((await db().order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("PENDING_PAYMENT");

    const list = await json(await listOrdersRoute(req(`/api/admin/orders?campaignId=${c.id}`, { token }), params({})));
    const row = list.data.rows[0];
    expect(row.customerPhone).not.toMatch(/^55\d{10,11}$/);
    expect(row.customerPhone).toContain("*****");
    expect(row.customerEmail).not.toBe("maria@example.com");
  });

  it("usuário desativado perde a sessão imediatamente", async () => {
    const { user, token } = await makeUser("OPERATOR");
    const { token: adminToken } = await makeUser("ADMIN");
    const off = await updateUserRoute(req(`/api/admin/users/${user.id}`, { body: { active: false }, token: adminToken }), params({ id: user.id }));
    expect(off.status).toBe(200);
    expect((await listOrdersRoute(req("/api/admin/orders?campaignId=x", { token }), params({}))).status).toBe(401);
  });

  it("não permite remover o último administrador ativo nem mudar o próprio papel", async () => {
    const { user, token } = await makeUser("ADMIN");
    const self = await updateUserRoute(req(`/api/admin/users/${user.id}`, { body: { role: "VIEWER" }, token }), params({ id: user.id }));
    expect(self.status).toBe(409);
    expect((await db().user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("ADMIN");
  });
});

describe("confirmação manual de pagamento (Pix estático)", () => {
  it("exige marcação de verificação, valor ≥ total, referência e motivo; campos extras são recusados", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [5, 6]); // R$ 9,80
    const { token } = await makeUser("OPERATOR");
    const url = `/api/admin/orders/${o.orderId}/confirm-payment`;

    const noCheck = await confirmRoute(req(url, { body: { ...confirmBody(980), confirmedVerification: false }, token }), params({ id: o.orderId }));
    expect(noCheck.status).toBe(400);

    const partial = await confirmRoute(req(url, { body: confirmBody(490), token }), params({ id: o.orderId }));
    expect(partial.status).toBe(400);
    expect((await json(partial)).error?.message).toContain("menor que o total");

    const injected = await confirmRoute(req(url, { body: { ...confirmBody(980), status: "PAID", totalCents: 1 }, token }), params({ id: o.orderId }));
    expect(injected.status).toBe(400);

    const order = await db().order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order.status).toBe("PENDING_PAYMENT");
    const rejected = await db().paymentEvent.count({ where: { orderId: o.orderId, type: "MANUAL_AMOUNT_INSUFFICIENT" } });
    expect(rejected).toBe(1);
  });

  it("confirmação válida marca pedido e números como pagos, com AuditLog completo; repetir não duplica", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [7, 8]);
    const { user, token } = await makeUser("OPERATOR");
    const url = `/api/admin/orders/${o.orderId}/confirm-payment`;

    const r = await confirmRoute(req(url, { body: confirmBody(980), token }), params({ id: o.orderId }));
    expect(r.status).toBe(200);

    const order = await db().order.findUniqueOrThrow({ where: { id: o.orderId }, include: { payments: true } });
    expect(order.status).toBe("PAID");
    expect(order.payments[0]!.confirmationSource).toBe("MANUAL");
    expect(order.payments[0]!.confirmedById).toBe(user.id);
    const numbers = await db().campaignNumber.findMany({ where: { orderId: o.orderId } });
    expect(numbers.map((n) => n.status)).toEqual(["PAID", "PAID"]);

    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "PAYMENT_MANUAL_CONFIRMED", entityId: o.orderId } });
    expect(audit.actorId).toBe(user.id);
    expect(audit.reason).toBe("Pix conferido no extrato do banco");
    expect(audit.ip).toBe("203.0.113.10");
    expect(audit.before).toMatchObject({ status: "PENDING_PAYMENT" });
    expect(audit.after).toMatchObject({ status: "PAID", verifiedAmountCents: 980 });

    const again = await confirmRoute(req(url, { body: confirmBody(980), token }), params({ id: o.orderId }));
    expect(again.status).toBe(409);
    expect(await db().auditLog.count({ where: { action: "PAYMENT_MANUAL_CONFIRMED" } })).toBe(1);
  });

  it("pedido do Pix automático nunca é confirmado manualmente", async () => {
    const c = await createCampaign({ mode: "AUTOMATIC" });
    const r = await reserveNumbers({ campaignSlug: c.slug, numbers: [9] });
    const o = await createOrderFromReservation({
      reservationToken: r.token,
      customer: customerInputSchema.parse({ name: "João Pereira", phone: uniquePhone(), email: "joao@example.com" }),
      acceptTerms: true,
      acceptPrivacy: true,
      idempotencyKey: randomUUID(),
    });
    const { token } = await makeUser("ADMIN");
    const res = await confirmRoute(req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490), token }), params({ id: o.orderId }));
    expect(res.status).toBe(409);
    expect((await db().order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("PENDING_PAYMENT");
  });
});

describe("manipulação de preço e integridade", () => {
  it("pedido criado pelo painel ignora qualquer preço enviado (campo desconhecido é recusado)", async () => {
    const c = await createCampaign({ priceCents: 490 });
    const { token } = await makeUser("OPERATOR");
    const base = {
      campaignId: c.id,
      numbers: [11, 12],
      customer: { name: "Ana Souza", phone: uniquePhone() },
      customerAcceptedTerms: true,
    };
    const tampered = await adminOrderRoute(req("/api/admin/orders", { body: { ...base, unitPriceCents: 1 }, token }), params({}));
    expect(tampered.status).toBe(400);
    const created = await adminOrderRoute(req("/api/admin/orders", { body: base, token }), params({}));
    expect(created.status).toBe(201);
    const { orderId } = (await json(created)).data;
    const order = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.unitPriceCents).toBe(490);
    expect(order.totalCents).toBe(980);
    expect(order.source).toBe("ADMIN");
    expect(order.paymentMode).toBe("MANUAL");
  });

  it("alterar o preço com pedidos existentes exige confirmação explícita e motivo", async () => {
    const c = await createCampaign({ priceCents: 490 });
    await manualOrder(c.slug, [13]);
    const { token } = await makeUser("ADMIN");
    const current = await db().campaign.findUniqueOrThrow({ where: { id: c.id } });
    const body = {
      version: current.version,
      name: current.name,
      shortDescription: "",
      story: "",
      imageUrl: "",
      priceCents: 990,
      totalNumbers: current.totalNumbers,
      numberDigits: current.numberDigits,
      minNumbersPerOrder: 1,
      maxNumbersPerOrder: 100,
      maxNumbersPerCustomer: null,
      reservationMinutes: 10,
      paymentMinutes: 30,
      requireCpf: false,
      requireEmail: false,
      salesStartAt: "",
      salesEndAt: "",
      drawScheduledAt: "",
      drawMethod: null,
      drawMethodParams: null,
      contactWhatsapp: "",
      contactEmail: "",
      contactInstagram: "",
      faq: [],
      confirmationMessage: "",
      orderCodePrefix: current.orderCodePrefix,
    };
    const blocked = await campaignRoute(req(`/api/admin/campaigns/${c.id}`, { method: "PUT", body, token }), params({ id: c.id }));
    expect(blocked.status).toBe(409);
    expect((await db().campaign.findUniqueOrThrow({ where: { id: c.id } })).priceCents).toBe(490);

    const confirmed = await campaignRoute(
      req(`/api/admin/campaigns/${c.id}`, { method: "PUT", body: { ...body, confirmCritical: true, reason: "Correção de preço aprovada pela organização" }, token }),
      params({ id: c.id }),
    );
    expect(confirmed.status).toBe(200);
    const audit = await db().auditLog.findFirstOrThrow({ where: { action: "CAMPAIGN_CRITICAL_UPDATE", entityId: c.id } });
    expect(audit.before).toMatchObject({ priceCents: 490 });
    expect(audit.after).toMatchObject({ priceCents: 990 });
    // O pedido já criado mantém o preço da época.
    expect((await db().order.findFirstOrThrow({ where: { campaignId: c.id } })).unitPriceCents).toBe(490);
  });

  it("AuditLog é somente inclusão e a cadeia de hash detecta adulteração", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [14]);
    const { token } = await makeUser("ADMIN");
    await confirmRoute(req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: confirmBody(490), token }), params({ id: o.orderId }));

    await expect(db().$executeRaw`UPDATE audit_logs SET reason = 'adulterado'`).rejects.toThrow();
    await expect(db().$executeRaw`DELETE FROM audit_logs`).rejects.toThrow();
    const [ok] = await db().$queryRaw<{ ok: boolean }[]>`SELECT ok FROM verify_audit_chain()`;
    expect(ok!.ok).toBe(true);

    // Adulteração direta (ignorando triggers, como faria alguém com acesso ao banco) é detectada.
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`UPDATE audit_logs SET reason = 'adulterado' WHERE action = 'PAYMENT_MANUAL_CONFIRMED'`;
    });
    const [broken] = await db().$queryRaw<{ ok: boolean }[]>`SELECT ok FROM verify_audit_chain()`;
    expect(broken!.ok).toBe(false);
  });
});

describe("conta e exportações", () => {
  it("trocar a própria senha exige a senha atual e encerra as sessões", async () => {
    const { user, token } = await makeUser("OPERATOR");
    const wrong = await ownPasswordRoute(req("/api/admin/me/password", { body: { current: "Errada-2026!!", next: "Nova-Senha-2026!" }, token }), params({}));
    expect(wrong.status).toBe(400);
    const good = await ownPasswordRoute(req("/api/admin/me/password", { body: { current: PASSWORD, next: "Nova-Senha-2026!" }, token }), params({}));
    expect(good.status).toBe(200);
    expect(await db().session.count({ where: { userId: user.id } })).toBe(0);
    expect((await statusRoute(req("/api/admin/status", { token }), params({}))).status).toBe(401);
    expect(await db().auditLog.count({ where: { action: "USER_PASSWORD_CHANGED", entityId: user.id } })).toBe(1);
  });

  it("CSV: neutraliza fórmulas (texto livre digitado no painel) e registra a exportação", async () => {
    const c = await createCampaign();
    const o = await manualOrder(c.slug, [15]);
    const { token } = await makeUser("ADMIN");
    // Referência do extrato é texto livre: alguém poderia digitar uma fórmula de planilha.
    const formula = '=HYPERLINK("http://x","clique")';
    const confirmed = await confirmRoute(
      req(`/api/admin/orders/${o.orderId}/confirm-payment`, { body: { ...confirmBody(490), reference: formula }, token }),
      params({ id: o.orderId }),
    );
    expect(confirmed.status).toBe(200);

    const res = await exportRoute(req(`/api/admin/campaigns/${c.id}/export/pagamentos`, { token }), params({ id: c.id, type: "pagamentos" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (acentos corretos no Excel)
    const csv = new TextDecoder().decode(bytes);
    expect(csv).not.toMatch(/(^|;)"?=HYPERLINK/m);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clique"")"`);
    expect(await db().auditLog.count({ where: { action: "DATA_EXPORTED", entityId: "pagamentos" } })).toBe(1);

    const compradores = await exportRoute(req(`/api/admin/campaigns/${c.id}/export/compradores`, { token }), params({ id: c.id, type: "compradores" }));
    const text = new TextDecoder().decode(new Uint8Array(await compradores.arrayBuffer()));
    expect(text).toContain("Maria da Silva");
  });
});
