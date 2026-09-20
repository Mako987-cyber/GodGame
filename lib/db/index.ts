import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { logger } from "@/lib/utils/logger";
import { pgliteDirectory, requiresSsl, runtimeDatabaseUrl } from "./config";
import { markEmbeddedDatabase } from "./driver";
import * as schema from "./schema";

/** Common base type of the postgres-js and PGlite drivers: repositories depend only on this. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbHolder {
  promise?: Promise<Database>;
}

// Survives Next.js hot reloads in dev and is reused across invocations of a warm serverless function.
const holder = globalThis as typeof globalThis & { __genesisDb?: DbHolder };
holder.__genesisDb ??= {};

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function connectPostgres(url: string): Promise<Database> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: requiresSsl(url) ? "require" : undefined,
  });
  return drizzle(client, { schema }) as unknown as Database;
}

async function connectPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir !== "memory://") await mkdir(dataDir, { recursive: true });
  const client = dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema });
  // Local convenience: the embedded database is always migrated on first use.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info("db.pglite.ready", { dataDir });
  return markEmbeddedDatabase(db) as unknown as Database;
}

export function getDb(): Promise<Database> {
  const cache = holder.__genesisDb as DbHolder;
  if (!cache.promise) {
    const url = runtimeDatabaseUrl();
    if (url) {
      cache.promise = connectPostgres(url);
    } else if (process.env.VERCEL) {
      cache.promise = Promise.reject(
        new Error("DATABASE_URL (o POSTGRES_URL) non configurata: su Vercel serve un database Postgres."),
      );
    } else {
      cache.promise = connectPglite(pgliteDirectory());
    }
    cache.promise.catch(() => {
      cache.promise = undefined;
    });
  }
  return cache.promise;
}

/** Used by tests: point the app at a specific database instance. */
export function setDbForTesting(db: Database | null) {
  const cache = holder.__genesisDb as DbHolder;
  cache.promise = db ? Promise.resolve(db) : undefined;
}

export { schema };
