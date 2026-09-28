import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    // Opcional: banco descartável usado por `prisma migrate dev/diff`.
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
