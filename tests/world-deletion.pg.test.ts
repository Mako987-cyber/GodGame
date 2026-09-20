/**
 * World deletion against a REAL Postgres with several connections: the scenario PGlite (one
 * connection) cannot reproduce — an orphaned transaction holding the world row, i.e. the cause of
 * the former HTTP 504.
 *
 * Runs only when TEST_DATABASE_URL points to a disposable database whose name contains "test"
 * (the suite migrates it and creates/deletes worlds). Example:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/genesis_test npm run test:world-delete
 */
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteRoute } from "@/app/api/worlds/[worldId]/route";
import { setDbForTesting, type Database } from "@/lib/db";
import { InMemorySimulationLock, PostgresSimulationLock } from "@/lib/db/lock";
import * as schema from "@/lib/db/schema";
import { countWorldRows } from "@/lib/db/world-deletion";
import {
  createWorldService,
  deleteWorldService,
  resumeWorldDeletionService,
  simulateWorldService,
} from "@/lib/services/world-service";
import { deleteConfirmationPhrase } from "@/lib/validation/world";

const url = process.env.TEST_DATABASE_URL;
const usable = !!url && /test/i.test(new URL(url).pathname);

describe.skipIf(!usable)("cancellazione su Postgres reale (multi-connessione)", () => {
  let client: postgres.Sql;
  let db: Database;

  beforeAll(async () => {
    client = postgres(url!, { max: 6, prepare: false, onnotice: () => undefined });
    db = drizzle(client, { schema }) as unknown as Database;
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    setDbForTesting(db);
  });
  afterAll(async () => {
    setDbForTesting(null);
    await client?.end({ timeout: 5 });
  });

  const confirm = (name: string) => ({ confirmation: deleteConfirmationPhrase(name), worldName: name });
  const del = (id: string, name: string) =>
    deleteRoute(
      new Request(`http://test/api/worlds/${id}`, {
        method: "DELETE",
        body: JSON.stringify(confirm(name)),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ worldId: id }) },
    );
  async function makeWorld(name: string, ticks = 10, width = 32) {
    const w = await createWorldService(
      { name, seed: `pg-${name}-${Date.now()}`, width },
      { db, lock: new InMemorySimulationLock() },
    );
    for (let done = 0; done < ticks; done += 100)
      await simulateWorldService(w.id, Math.min(100, ticks - done) as 100, {
        db,
        lock: new InMemorySimulationLock(),
      });
    return w;
  }
  /** Another session: BEGIN + UPDATE of the world row, then silence (a frozen function). */
  async function orphanTransaction(worldId: string, idleTimeoutMs?: number) {
    const zombie = postgres(url!, { max: 1, onnotice: () => undefined });
    const conn = await zombie.reserve();
    await conn`begin`;
    if (idleTimeoutMs)
      await conn`select set_config('idle_in_transaction_session_timeout', ${`${idleTimeoutMs}ms`}, true)`;
    await conn`update worlds set updated_at = now() where id = ${worldId}`;
    const [{ pid }] = (await conn`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    return {
      pid,
      async end() {
        await conn`rollback`.catch(() => undefined);
        conn.release();
        await zombie.end({ timeout: 1 });
      },
      /** The server already closed the session: never write to it again. */
      async abandon() {
        await zombie.end({ timeout: 0 }).catch(() => undefined);
      },
    };
  }

  it("prima della correzione la DELETE restava in attesa: ora risponde 409 WORLD_BUSY entro il lock_timeout", async () => {
    const w = await makeWorld("Orfano");
    const zombie = await orphanTransaction(w.id);
    try {
      const t0 = Date.now();
      const res = await del(w.id, "Orfano");
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; requestId: string } };
      expect(body.error.code).toBe("WORLD_BUSY");
      expect(body.error.requestId).toBeTruthy();
      // Default lock_timeout 3 s: far from any platform limit.
      expect(elapsed).toBeLessThan(10_000);
      // Nothing happened: not tombstoned, no job.
      const [row] = await db
        .select({ status: schema.worlds.status })
        .from(schema.worlds)
        .where(eq(schema.worlds.id, w.id));
      expect(row?.status).toBe("paused");
    } finally {
      await zombie.end();
    }
    const res = await del(w.id, "Orfano");
    expect(res.status).toBe(200);
    expect(Object.values(await countWorldRows(db, w.id)).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("anche il lock di simulazione non si blocca dietro una transazione orfana", async () => {
    const w = await makeWorld("Orfano sim");
    const zombie = await orphanTransaction(w.id);
    try {
      const t0 = Date.now();
      await expect(
        simulateWorldService(w.id, 1, { db, lock: new PostgresSimulationLock(db) }),
      ).rejects.toMatchObject({
        status: 409,
      });
      expect(Date.now() - t0).toBeLessThan(10_000);
    } finally {
      await zombie.end();
    }
  });

  it("idle_in_transaction_session_timeout: Postgres chiude da solo la transazione orfana e la cancellazione procede", async () => {
    const w = await makeWorld("Orfano scaduto");
    const zombie = await orphanTransaction(w.id, 500);
    await new Promise((r) => setTimeout(r, 1_500));
    // The orphan was terminated by the server: its backend is gone, and so are its locks.
    const alive = await client`select 1 from pg_stat_activity where pid = ${zombie.pid}`;
    expect(alive).toHaveLength(0);
    await zombie.abandon();
    const res = await del(w.id, "Orfano scaduto");
    expect(res.status).toBe(200);
  });

  it("richieste concorrenti su più connessioni: un job, un'eliminazione", async () => {
    const w = await makeWorld("Parallelo", 30);
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => deleteWorldService(w.id, confirm("Parallelo"), { db })),
    );
    for (const r of results)
      if (r.status === "rejected") expect([404, 409]).toContain((r.reason as { status: number }).status);
    let state = await resumeWorldDeletionService(w.id, { db });
    for (let i = 0; !state.completed && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 50));
      state = await resumeWorldDeletionService(w.id, { db });
    }
    expect(state.completed).toBe(true);
    const jobs = await db
      .select()
      .from(schema.worldDeletionJobs)
      .where(eq(schema.worldDeletionJobs.worldId, w.id));
    expect(jobs).toHaveLength(1);
    expect(Object.values(await countWorldRows(db, w.id)).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("mondo grande (96×96, 300 anni): cancellato ben dentro il budget", async () => {
    const w = await makeWorld("Grande", 300, 96);
    const before = await countWorldRows(db, w.id);
    const t0 = Date.now();
    const done = await deleteWorldService(w.id, confirm("Grande"), { db });
    const elapsed = Date.now() - t0;
    expect(done.completed).toBe(true);
    expect(done.total).toBe(Object.values(before).reduce((a, b) => a + b, 0));
    expect(elapsed).toBeLessThan(15_000);
    const [leftover] = (await db.execute(
      sql`select count(*)::int as n from world_cells where world_id = ${w.id}`,
    )) as unknown as { n: number }[];
    expect(leftover?.n).toBe(0);
    console.log(`[pg] mondo 96×96 dopo 300 anni: ${done.total} righe eliminate in ${elapsed} ms`);
  }, 300_000);
});
