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
    // The stress suite runs separately: `npm run test:simulation`.
    include: ["packages/**/tests/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "packages/**/tests/stress/**"],
    environment: "node",
    testTimeout: 60_000,
    // PGlite start-up and migrations run in `beforeAll`: with several DB suites in parallel on a
    // loaded machine they can exceed the 10 s default, so hooks get the same budget as tests.
    hookTimeout: 60_000,
  },
});
