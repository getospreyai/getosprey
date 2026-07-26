import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests only — no DB, no network. Anything needing Postgres belongs in a
// separate suite; these must stay runnable with zero env vars so CI and a cold
// clone both work.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
