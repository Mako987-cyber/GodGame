import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@genesis/simulation-core": fileURLToPath(
        new URL("./packages/simulation-core/src/index.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/tests/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
