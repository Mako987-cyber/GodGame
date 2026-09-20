/**
 * Applies Drizzle migrations. Uses DIRECT_URL / POSTGRES_URL_NON_POOLING when available
 * (migrations should not run through a transaction pooler), otherwise the local PGlite database.
 *
 * On Vercel this runs inside `build:vercel`, before `next build`, so a database that is briefly
 * unreachable fails the whole deployment. The Supabase integration's "non pooling" URL still goes
 * through Supavisor in session mode, whose slots are shared with the running app, and a saturated
 * pool is rejected outright (`ECHECKOUTTIMEOUT`) instead of queueing. That clears up by itself in
 * seconds, so transient failures are retried here rather than breaking the build.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { directDatabaseUrl, pgliteDirectory, requiresSsl } from "../lib/db/config";
import { isTransientDbError } from "../lib/db/tx";

const migrationsFolder = path.join(process.cwd(), "drizzle");

const intFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
};

/** Total wait is roughly 5s + 10s + 20s + 40s: comfortably longer than a passing traffic spike. */
const ATTEMPTS = intFromEnv("MIGRATE_ATTEMPTS", 5);
const BACKOFF_MS = intFromEnv("MIGRATE_BACKOFF_MS", 5_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function migratePostgres(url: string) {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { host } = new URL(url);

  for (let attempt = 1; ; attempt++) {
    const client = postgres(url, {
      max: 1,
      prepare: false,
      connect_timeout: 30,
      ssl: requiresSsl(url) ? "require" : undefined,
    });
    let failure: unknown;
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } catch (error) {
      failure = error;
    }
    // Always released before deciding what to do next: a retry opens a fresh pool, and holding
    // this one during the backoff would keep occupying the slot we are waiting for.
    await client.end({ timeout: 5 }).catch(() => undefined);

    if (!failure) {
      console.log(`Migrazioni applicate su ${host}`);
      return;
    }
    if (attempt >= ATTEMPTS || !isTransientDbError(failure)) throw failure;
    const wait = BACKOFF_MS * 2 ** (attempt - 1);
    console.warn(
      `Migrazione fallita su ${host} (tentativo ${attempt}/${ATTEMPTS}): ${describe(failure)}. ` +
        `Nuovo tentativo tra ${Math.round(wait / 1000)}s.`,
    );
    await sleep(wait);
  }
}

/** Drizzle reports only the SQL it ran; the reason is in `cause`. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error ? `${error.message} — ${cause.message}` : error.message;
}

async function migratePglite() {
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

async function main() {
  const url = directDatabaseUrl();
  if (url) await migratePostgres(url);
  else await migratePglite();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
