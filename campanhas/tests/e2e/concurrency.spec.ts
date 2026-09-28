import { expect, test } from "@playwright/test";

test("100 pessoas disputando o mesmo número ao mesmo tempo: 1 reserva, 99 falhas controladas", async ({ request, baseURL }) => {
  const st = await (await request.get("/api/public/campaigns/e2e-auto/numbers", { headers: { "x-forwarded-for": "192.0.2.10" } })).json();
  const number = st.data.firstNumber + (st.data.statuses as string).lastIndexOf("A");
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      request.post("/api/public/campaigns/e2e-auto/reservations", {
        headers: { origin: baseURL!, "x-forwarded-for": `198.51.100.${i + 1}` },
        data: { numbers: [number] },
      }),
    ),
  );
  const statuses = responses.map((r) => r.status());
  expect(statuses.filter((s) => s === 201)).toHaveLength(1);
  expect(statuses.filter((s) => s === 409)).toHaveLength(99);
  const failure = await responses.find((r) => r.status() === 409)!.json();
  expect(failure.error.code).toBe("NUMBERS_UNAVAILABLE");
  expect(JSON.stringify(failure)).not.toMatch(/\.ts:\d+|at \w+ \(/);
});
