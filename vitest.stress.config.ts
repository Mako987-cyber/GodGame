import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Stress suite of the simulation engine: long runs, invariants after every tick. */
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
    include: ["packages/**/tests/stress/**/*.test.ts"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
