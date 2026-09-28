import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

test("sorteio: congelar, publicar hash, apurar uma única vez, homologar e publicar resultado", async ({ browser, request }) => {
  const { context, page } = await login(browser, USERS.admin, "e2e-sorteio");
  await page.goto("/admin/sorteio");
  await expect(page.getByText("Pronto para congelar")).toBeVisible();
  await page.getByLabel(/Referência oficial/).fill("Sorteio eletrônico transmitido ao vivo (E2E)");
  await page.getByLabel(/Entendo que, ao congelar/).check();
  await page.getByRole("button", { name: "Congelar vendas e publicar lista" }).click();
  await expect(page.getByText("Lista congelada — aguardando apuração")).toBeVisible();

  // Hash publicado confere com a lista baixável (qualquer pessoa pode refazer).
  await page.goto("/campanha/e2e-sorteio/resultado");
  const hash = (await page.locator("dd.font-mono").first().innerText()).trim();
  const href = await page.getByRole("link", { name: "Baixar a lista de números participantes" }).getAttribute("href");
  const list = await (await request.get(href!)).text();
  expect(list).toBe("003\n004\n017\n042\n043\n044\n088\n");
  expect(createHash("sha256").update(list).digest("hex")).toBe(hash);

  await page.goto("/admin/sorteio");
  await page.getByRole("button", { name: "Registrar resultado oficial" }).click();
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Apurado — aguardando homologação")).toBeVisible();
  // CSPRNG executado não pode ser anulado (não há botão) nem executado de novo.
  await expect(page.getByRole("button", { name: "Anular sorteio" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Registrar resultado oficial" })).toHaveCount(0);

  await page.getByRole("button", { name: "Homologar resultado" }).click();
  await page.getByLabel(/Conferi a entrada oficial/).check();
  await page.getByRole("button", { name: "Homologar", exact: true }).click();
  await expect(page.getByText("Homologado").first()).toBeVisible();

  await page.goto("/campanha/e2e-sorteio/resultado");
  const winners = await page.locator("span.font-mono.text-2xl").allInnerTexts();
  expect(winners).toHaveLength(2);
  for (const w of winners) expect(["003", "004", "017", "042", "043", "044", "088"]).toContain(w.trim());
  expect(new Set(winners).size).toBe(2);
  // Página pública não mostra dados de compradores.
  const text = await page.locator("main").innerText();
  for (const name of ["Ana Souza", "Bruno Lima", "Carla Dias", "Davi Rocha"]) expect(text).not.toContain(name);
  await context.close();
});
