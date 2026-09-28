import { expect, test } from "@playwright/test";
import { buy, noHorizontalScroll, ORDER_CODE, pickNumbers } from "./helpers";

// Roda em iPhone e Android (Chromium com emulação de dispositivo).
const phone = (base: number) => `4199${String(base + (test.info().project.name === "iphone" ? 0 : 5000)).padStart(7, "0")}`;

test("página da campanha: informações essenciais, legais e botão de compra", async ({ page }) => {
  await page.goto("/campanha/alek");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Campanha do Alek");
  await expect(page.getByText("Samsung Galaxy A05s usado").first()).toBeVisible();
  await expect(page.getByText("Cesta de doces da Dmialo").first()).toBeVisible();
  await expect(page.getByText(/R\$\s4,90/).first()).toBeVisible();
  await expect(page.getByText("1.200").first()).toBeVisible();
  await expect(page.getByText("Responsável E2E").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Escolher números/i }).first()).toBeVisible();
  await noHorizontalScroll(page);
});

test("grade: seleção mostra o resumo informativo e o backend recalcula o valor", async ({ page }) => {
  await page.goto("/campanha/alek/numeros");
  await pickNumbers(page, 3);
  await expect(page.getByText(/R\$\s4,90 × 3 = R\$\s14,70/)).toBeVisible();
  await noHorizontalScroll(page);
  // Mesmo que o navegador tente mandar preço, o servidor recusa campos desconhecidos.
  const r = await page.request.post("/api/public/campaigns/alek/reservations", {
    headers: { origin: new URL(page.url()).origin },
    data: { numbers: [1], priceCents: 1 },
  });
  expect(r.status()).toBe(400);
});

test("compra com Pix manual: QR, copia e cola e “Já paguei” continua aguardando conferência", async ({ page }) => {
  const { code } = await buy(page, "alek", { count: 2, name: "Maria da Silva", phone: phone(1001) });
  await expect(page.getByRole("heading", { name: "Pague com Pix" })).toBeVisible();
  await expect(page.locator("img[src^='data:image/svg+xml']").first()).toBeVisible();
  const pix = await page.locator("#pix-code").inputValue();
  expect(pix).toMatch(/^000201/);
  expect(pix).toContain("13786508917");
  await page.getByRole("button", { name: /Copiar Pix/ }).click();
  await page.getByRole("button", { name: "Já paguei" }).click();
  await expect(page.getByText(/Aguardando conferência/)).toBeVisible();
  await expect(page.getByText("Aguardando pagamento").first()).toBeVisible();
  expect(code).toMatch(ORDER_CODE);
  await noHorizontalScroll(page);
});

test("consulta: código + WhatsApp abre só o próprio pedido; dados errados não revelam nada", async ({ page }) => {
  const tel = phone(1002);
  const { code } = await buy(page, "alek", { count: 1, name: "João Pereira", phone: tel });
  await page.goto("/consultar");
  await page.getByLabel("Código do pedido").fill(code);
  await page.getByLabel("WhatsApp usado na compra").fill("41900000000");
  await page.getByRole("button", { name: "Consultar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pedido não encontrado" })).toBeVisible();
  await page.getByLabel("WhatsApp usado na compra").fill(tel);
  await page.getByRole("button", { name: "Consultar" }).click();
  await page.waitForURL(/\/pedido\//);
  await expect(page.getByText(code).first()).toBeVisible();
  // A página do pedido não expõe telefone/e-mail completos.
  expect(await page.locator("main").innerText()).not.toContain(tel);
});
