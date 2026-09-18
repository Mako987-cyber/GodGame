import { afterEach, describe, expect, it, vi } from "vitest";
import { directDatabaseUrl, normalizeDatabaseUrl, runtimeDatabaseUrl } from "@/lib/db/config";

const KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
  "GODGAME_POSTGRES_URL",
  "GODGAME_POSTGRES_URL_NON_POOLING",
];

describe("configurazione del database", () => {
  afterEach(() => vi.unstubAllEnvs());
  const clear = () => KEYS.forEach((k) => vi.stubEnv(k, ""));

  it("legge le variabili con prefisso dell'integrazione Supabase (god_game_db)", () => {
    clear();
    vi.stubEnv(
      "GODGAME_POSTGRES_URL",
      "postgres://u:p@pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x",
    );
    vi.stubEnv(
      "GODGAME_POSTGRES_URL_NON_POOLING",
      "postgres://u:p@pooler.supabase.com:5432/postgres?sslmode=require",
    );
    expect(runtimeDatabaseUrl()).toBe("postgres://u:p@pooler.supabase.com:6543/postgres?sslmode=require");
    expect(directDatabaseUrl()).toContain(":5432/");
  });

  it("DATABASE_URL ha la precedenza e i segnaposto [SENSITIVE] vengono ignorati", () => {
    clear();
    vi.stubEnv("GODGAME_POSTGRES_URL", "[SENSITIVE]");
    expect(runtimeDatabaseUrl()).toBeNull();
    vi.stubEnv("DATABASE_URL", "postgres://a:b@localhost:5432/genesis");
    expect(runtimeDatabaseUrl()).toBe("postgres://a:b@localhost:5432/genesis");
  });

  it("rimuove i parametri non standard dagli URL", () => {
    expect(normalizeDatabaseUrl("postgres://h/db?supa=x&sslmode=require&pgbouncer=true")).toBe(
      "postgres://h/db?sslmode=require",
    );
  });
});
