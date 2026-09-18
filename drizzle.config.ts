import { defineConfig } from "drizzle-kit";
import { directDatabaseUrl } from "./lib/db/config";

const url = directDatabaseUrl();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // `generate` works offline; `studio`/`push` need a real connection.
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
