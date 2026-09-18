/**
 * Applies Drizzle migrations. Uses DIRECT_URL / POSTGRES_URL_NON_POOLING when available
 * (migrations should not run through a transaction pooler), otherwise the local PGlite database.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { directDatabaseUrl, pgliteDirectory, requiresSsl } from "../lib/db/config";

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function main() {
  const url = directDatabaseUrl();
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 1, prepare: false, ssl: requiresSsl(url) ? "require" : undefined });
    await migrate(drizzle(client), { migrationsFolder });
    await client.end();
    console.log(`Migrazioni applicate su ${new URL(url).host}`);
    return;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = pgliteDirectory();
  await mkdir(dir, { recursive: true });
  const client = new PGlite(dir);
  await migrate(drizzle(client), { migrationsFolder });
  await client.close();
  console.log(`Migrazioni applicate su PGlite (${dir})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
