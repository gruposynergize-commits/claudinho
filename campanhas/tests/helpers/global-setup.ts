import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL } from "./test-env";

/**
 * Recria o schema do banco de teste e aplica TODAS as migrações (inclusive
 * triggers e constraints), exatamente como em produção.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  if (!url.pathname.includes("test")) {
    throw new Error(`Recusando resetar banco que não parece de teste: ${url.pathname}`);
  }
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
