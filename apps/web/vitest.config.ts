import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": join(dirname(fileURLToPath(import.meta.url)), "src") } },
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
