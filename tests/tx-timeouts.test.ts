import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { isEmbeddedDatabase, markEmbeddedDatabase } from "@/lib/db/driver";
import { boundedTransaction, isTransientDbError, pgErrorCode } from "@/lib/db/tx";
import { describeError } from "@/lib/utils/errors";
import { createTestDb, QueryRecorder } from "./db-helpers";

describe("timeout delle transazioni bounded", () => {
  const recorder = new QueryRecorder();
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb({ logger: recorder }));
  });
  afterAll(async () => close?.());

  const settings = () => recorder.queries.filter((q) => q.includes("set_config")).join("\n");

  it("su PGlite non imposta idle_in_transaction_session_timeout: chiuderebbe l'unica sessione del processo", async () => {
    expect(isEmbeddedDatabase(db)).toBe(true);
    recorder.reset();
    await boundedTransaction(db, async (tx) => tx.execute(sql`select 1`));

    expect(settings()).toContain("lock_timeout");
    expect(settings()).toContain("statement_timeout");
    expect(settings()).not.toContain("idle_in_transaction_session_timeout");
  });

  it("su un database con pool li imposta tutti e tre", async () => {
    // Same driver, deliberately not marked as embedded: stands in for postgres-js.
    const client = (db as unknown as { $client: PGlite }).$client;
    const pooled = drizzle(client, { logger: recorder }) as unknown as Database;
    expect(isEmbeddedDatabase(pooled)).toBe(false);
    recorder.reset();
    await boundedTransaction(pooled, async (tx) => tx.execute(sql`select 1`));

    expect(settings()).toContain("lock_timeout");
    expect(settings()).toContain("statement_timeout");
    expect(settings()).toContain("idle_in_transaction_session_timeout");
  });

  it("markEmbeddedDatabase riguarda solo l'istanza marcata", () => {
    expect(isEmbeddedDatabase({})).toBe(false);
    expect(isEmbeddedDatabase(null)).toBe(false);
    expect(isEmbeddedDatabase(markEmbeddedDatabase({}))).toBe(true);
  });
});

describe("describeError", () => {
  it('riporta la causa che Drizzle nasconde dietro "Failed query"', () => {
    const root = new Error('relation "worlds" does not exist');
    const wrapped = new Error('Failed query: select ... from "worlds"', { cause: root });

    expect(describeError(wrapped)).toBe(
      'Failed query: select ... from "worlds" — relation "worlds" does not exist',
    );
  });

  it("non ripete lo stesso messaggio e sopravvive ai non-Error", () => {
    const inner = new Error("boom");
    expect(describeError(new Error("boom", { cause: inner }))).toBe("boom");
    expect(describeError("plain string")).toBe("plain string");
  });
});

describe("isTransientDbError", () => {
  /** The exact shape Vercel logged when `db:migrate` failed the build. */
  const poolerExhausted = () => {
    const cause = Object.assign(
      new Error(
        "(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 15000ms in Session mode",
      ),
      { code: "XX000", severity_local: "FATAL" },
    );
    return new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', { cause });
  };

  it("considera transitorio il pooler saturo, nonostante lo SQLSTATE generico XX000", () => {
    expect(isTransientDbError(poolerExhausted())).toBe(true);
    expect(pgErrorCode(poolerExhausted())).toBe("XX000");
  });

  it("riconosce anche MaxClientsInSessionMode", () => {
    expect(isTransientDbError(new Error("MaxClientsInSessionMode: max clients reached"))).toBe(true);
  });

  it("continua a riconoscere i codici SQLSTATE noti", () => {
    for (const code of ["55P03", "57014", "40P01", "40001", "57P01", "57P03", "53300", "08006"])
      expect(isTransientDbError(Object.assign(new Error("boom"), { code }))).toBe(true);
  });

  it("cerca i messaggi di connessione anche dentro la catena delle cause", () => {
    const cause = new Error("write ECONNRESET");
    expect(isTransientDbError(new Error("Failed query: select 1", { cause }))).toBe(true);
  });

  it("non considera transitorio un errore di schema o di sintassi", () => {
    // 42P01 = undefined_table: riprovare non lo risolverebbe mai.
    const cause = Object.assign(new Error('relation "worlds" does not exist'), { code: "42P01" });
    expect(isTransientDbError(new Error("Failed query: select 1", { cause }))).toBe(false);
    expect(isTransientDbError(new Error("boom"))).toBe(false);
  });
});
