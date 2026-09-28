import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Dinheiro e sorteio: nunca Math.random() no código da aplicação.
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Use node:crypto (randomInt/randomBytes) ou crypto.getRandomValues." }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**", "dev/**", "scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-properties": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);
