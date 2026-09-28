import { expect, test } from "@playwright/test";
import { buy, login, PASSWORD, USERS } from "./helpers";

test("login: senha errada é recusada com mensagem genérica", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(USERS.admin);
  await page.getByLabel("Senha").fill(`${PASSWORD()}x`);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos" })).toBeVisible();
  await page.goto("/admin/pedidos");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("operador confirma Pix manual após conferência; comprador vê a confirmação e fica na auditoria", async ({ browser, page }) => {
  const order = await buy(page, "alek", { count: 3, name: "Carla Mendes", phone: "41988776655" });

  const op = await login(browser, USERS.operator);
  await op.page.goto(`/admin/pedidos?code=${order.code}`);
  await op.page.getByRole("link", { name: order.code }).click();
  await op.page.getByRole("button", { name: "Confirmar pagamento manualmente" }).click();
  const dialog = op.page.getByRole("dialog", { name: "Você verificou o pagamento na conta?" });
  await dialog.getByLabel("Valor identificado na conta (R$)").fill("14,70");
  await dialog.getByLabel(/Referência no extrato/).fill("E2E 10h32 Carla Mendes");
  await dialog.getByLabel("Motivo").fill("Pix conferido no extrato do banco");
  await expect(dialog.getByRole("button", { name: "Confirmar pagamento" })).toBeDisabled();
  await dialog.getByLabel("Verifiquei o pagamento na conta de recebimento.").check();
  await dialog.getByRole("button", { name: "Confirmar pagamento" }).click();
  await expect(op.page.getByText("Pago", { exact: true }).first()).toBeVisible();

  // O comprador vê a confirmação na própria página (atualização automática).
  await page.goto(order.url);
  await expect(page.getByRole("heading", { name: "Pagamento confirmado!" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compartilhar minha participação" })).toBeVisible();

  const admin = await login(browser, USERS.admin);
  await admin.page.goto("/admin/auditoria?action=PAYMENT_MANUAL");
  await expect(admin.page.getByText("PAYMENT_MANUAL_CONFIRMED").first()).toBeVisible();
  await expect(admin.page.getByText("Pix conferido no extrato do banco").first()).toBeVisible();
  await op.context.close();
  await admin.context.close();
});

test("somente leitura: sem auditoria/status e com dados pessoais mascarados", async ({ browser, page }) => {
  await buy(page, "alek", { count: 1, name: "Rita Alves", phone: "41977665544" });
  const viewer = await login(browser, USERS.viewer);
  for (const path of ["/admin/auditoria", "/status", "/admin/configuracoes/usuarios"]) {
    await viewer.page.goto(path);
    await expect(viewer.page.getByRole("heading", { name: "Sem permissão" })).toBeVisible();
  }
  await viewer.page.goto("/admin/pedidos?q=Rita");
  const text = await viewer.page.locator("main").innerText();
  expect(text).not.toContain("77665544");
  expect(text).toContain("5544");
  await viewer.context.close();
});
