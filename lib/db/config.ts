/**
 * Database URL resolution. Supports plain Postgres (DATABASE_URL / DIRECT_URL) and the
 * variables injected by the Supabase integration of the Vercel Marketplace
 * (POSTGRES_URL / POSTGRES_URL_NON_POOLING).
 */
const KEEP_PARAMS = new Set(["sslmode", "options", "application_name", "connect_timeout"]);

/** Removes vendor-specific query params (e.g. `supa=base-pooler.x`) that Postgres would reject as startup options. */
export function normalizeDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (!KEEP_PARAMS.has(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function pick(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return normalizeDatabaseUrl(value);
  }
  return null;
}

export function runtimeDatabaseUrl(): string | null {
  return pick("DATABASE_URL", "POSTGRES_URL");
}

export function directDatabaseUrl(): string | null {
  return pick("DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL");
}

export function pgliteDirectory(): string {
  return process.env.PGLITE_DIR?.trim() || ".data/pglite";
}

export function requiresSsl(url: string): boolean {
  return /sslmode=(require|verify-ca|verify-full)/.test(url) || /supabase\.(co|com)/.test(url);
}
