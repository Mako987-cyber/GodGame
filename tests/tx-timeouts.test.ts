import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { isEmbeddedDatabase, markEmbeddedDatabase } from "@/lib/db/driver";
import { boundedTransaction } from "@/lib/db/tx";
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
