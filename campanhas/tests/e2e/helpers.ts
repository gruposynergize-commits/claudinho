import { expect, test, type Browser, type Page } from "@playwright/test";

export const PASSWORD = () => process.env.E2E_ADMIN_PASSWORD!;
export const USERS = {
  admin: "e2e-admin@teste.local",
  operator: "e2e-operador@teste.local",
  viewer: "e2e-leitor@teste.local",
};
export const ORDER_CODE = /[A-Z0-9]{2,10}-\d{8}-\d{6}/;

/** Seleciona os primeiros `count` números disponíveis da página atual da grade. */
export async function pickNumbers(page: Page, count: number): Promise<string[]> {
  const cells = page.locator("button[data-cell][aria-label*='disponível']");
  await cells.first().waitFor();
  const labels = (await cells.evaluateAll((els, n) => els.slice(0, n).map((e) => e.getAttribute("aria-label") ?? ""), count)).filter(Boolean);
  for (const label of labels) await page.getByRole("button", { name: label, exact: true }).click();
  return labels.map((l) => /Número (\d+)/.exec(l)![1]!);
}

/** Compra completa até a página do pedido. Retorna a URL do pedido e o código. */
export async function buy(page: Page, slug: string, opts: { count: number; name: string; phone: string; email?: string }) {
  await page.goto(`/campanha/${slug}/numeros`);
  const numbers = await pickNumbers(page, opts.count);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/checkout/);
  await expect(page.getByText("Seus números")).toBeVisible();
  await page.getByLabel("Nome completo").fill(opts.name);
  await page.getByLabel("WhatsApp").fill(opts.phone);
  if (opts.email) await page.getByLabel(/E-mail/).fill(opts.email);
  await page.getByRole("checkbox", { name: /Li e aceito o regulamento/ }).check();
  await page.getByRole("checkbox", { name: /Li e aceito a política de privacidade/ }).check();
  await page.getByRole("button", { name: /Gerar Pix/ }).click();
  await page.waitForURL(/\/pedido\//);
  await expect(page.getByText(ORDER_CODE).first()).toBeVisible();
  const code = ORDER_CODE.exec(await page.locator("main").innerText())![0];
  return { url: page.url(), code, numbers };
}

/** Entra no painel com a campanha em foco definida (como faz o seletor do painel). */
export async function login(browser: Browser, email: string, campaign = "alek") {
  const context = await browser.newContext();
  const baseURL = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "admin_campaign", value: campaign, url: baseURL }]);
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/admin$/);
  return { context, page };
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "a página não pode ter rolagem horizontal").toBeLessThanOrEqual(1);
}
