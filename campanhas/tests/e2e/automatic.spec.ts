import { expect, test } from "@playwright/test";
import { buy } from "./helpers";

test("Pix automático: QR dinâmico e confirmação automática pelo webhook (página atualiza sozinha)", async ({ page, request }) => {
  const order = await buy(page, "e2e-auto", { count: 2, name: "Paulo Nunes", phone: "41966554433", email: "paulo@example.com" });
  await expect(page.getByRole("heading", { name: "Pague com Pix" })).toBeVisible();
  await expect(page.getByText("A confirmação aparece aqui automaticamente", { exact: false })).toBeVisible();
  // Não existe “Já paguei” no modo automático: quem confirma é o gateway.
  await expect(page.getByRole("button", { name: "Já paguei" })).toHaveCount(0);

  const gw = process.env.E2E_GATEWAY_URL!;
  const payments = (await (await request.get(`${gw}/__control/payments`)).json()) as { id: number; external_reference: string }[];
  const payment = payments.find((p) => p.external_reference === order.code);
  expect(payment, "cobrança criada no gateway com a referência do pedido").toBeTruthy();
  const approved = await request.post(`${gw}/__control/payments/${payment!.id}/approve`, { data: {} });
  expect(approved.ok()).toBe(true);

  await expect(page.getByRole("heading", { name: "Pagamento confirmado!" })).toBeVisible({ timeout: 30_000 });
});
