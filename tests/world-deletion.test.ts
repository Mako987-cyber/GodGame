import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteRoute } from "@/app/api/worlds/[worldId]/route";
import { setDbForTesting, type Database } from "@/lib/db";
import { InMemorySimulationLock, PostgresSimulationLock } from "@/lib/db/lock";
import * as schema from "@/lib/db/schema";
import { countWorldRows, WORLD_CHILD_TABLES } from "@/lib/db/world-deletion";
import {
  createWorldService,
  deleteWorldService,
  getWorldDetailService,
  simulateWorldService,
} from "@/lib/services/world-service";
import { AppError } from "@/lib/utils/errors";
import { deleteConfirmationPhrase, isDeleteConfirmed } from "@/lib/validation/world";
import { createTestDb } from "./db-helpers";

// Every test runs on an in-memory PGlite database created here: never on a real database.
let db: Database;
let close: () => Promise<void>;
const memLock = () => new InMemorySimulationLock();

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  setDbForTesting(db);
});
afterAll(async () => {
  setDbForTesting(null);
  await close();
});

async function makeWorld(name: string, ticks = 10) {
  const world = await createWorldService({ name, seed: `seed-${name}`, width: 32 }, { db, lock: memLock() });
  if (ticks) await simulateWorldService(world.id, ticks as 10, { db, lock: memLock() });
  return world;
}

const confirm = (name: string) => ({ confirmation: deleteConfirmationPhrase(name), worldName: name });
const deps = () => ({ db, lock: new PostgresSimulationLock(db) });
const ctx = (id: string) => ({ params: Promise.resolve({ worldId: id }) });
const del = (id: string, body: unknown) =>
  deleteRoute(
    new Request(`http://test/api/worlds/${id}`, {
      method: "DELETE",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    ctx(id),
  );
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

describe("frase di conferma", () => {
  it("richiede la frase esatta e il nome esatto", () => {
    expect(deleteConfirmationPhrase("Terra")).toBe("ELIMINA Terra");
    expect(isDeleteConfirmed("Terra", { confirmation: "ELIMINA Terra", worldName: "Terra" })).toBe(true);
    expect(isDeleteConfirmed("Terra", { confirmation: "elimina Terra", worldName: "Terra" })).toBe(false);
    expect(isDeleteConfirmed("Terra", { confirmation: "ELIMINA Terra ", worldName: "Terra" })).toBe(false);
    expect(isDeleteConfirmed("Terra", { confirmation: "ELIMINA Terra", worldName: "terra" })).toBe(false);
    expect(isDeleteConfirmed("Terra", { confirmation: "ELIMINA Marte", worldName: "Terra" })).toBe(false);
  });

  it("confronta i nomi con la stessa normalizzazione Unicode", () => {
    const composed = "Citt\u00e0";
    const decomposed = "Citta\u0300";
    expect(
      isDeleteConfirmed(composed, { confirmation: `ELIMINA ${decomposed}`, worldName: decomposed }),
    ).toBe(true);
  });
});

describe("DELETE /api/worlds/:id — validazione", () => {
  it("worldId non valido → 404 senza toccare il database", async () => {
    const res = await del("non-un-uuid", confirm("x"));
    expect(res.status).toBe(404);
  });

  it("corpo mancante, non JSON o con campi extra → 400", async () => {
    const w = await makeWorld("Validazione", 0);
    expect((await del(w.id, "{rotto")).status).toBe(400);
    expect((await del(w.id, {})).status).toBe(400);
    expect((await del(w.id, { confirm: true })).status).toBe(400);
    expect((await del(w.id, { ...confirm("Validazione"), extra: 1 })).status).toBe(400);
    // `confirm=true` alone is never enough.
    expect((await del(w.id, { confirmation: "true", worldName: "Validazione" })).status).toBe(422);
    expect((await countWorldRows(db, w.id)).worlds).toBe(1);
  });

  it("mondo inesistente → 404 NOT_FOUND", async () => {
    const res = await del(crypto.randomUUID(), confirm("Fantasma"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("non espone SQL né stack trace negli errori", async () => {
    const res = await del(crypto.randomUUID(), confirm("Fantasma"));
    const text = await res.text();
    expect(text).not.toMatch(/select|delete from|stack|at \w+ \(/i);
  });
});

describe("cancellazione di un mondo", () => {
  it("conferma errata → 422 e nessun dato eliminato", async () => {
    const w = await makeWorld("Conferma");
    const before = await countWorldRows(db, w.id);
    const res = await del(w.id, { confirmation: "ELIMINA Altro", worldName: "Conferma" });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("CONFIRMATION_MISMATCH");
    expect(await countWorldRows(db, w.id)).toEqual(before);
  });

  it("nome del mondo errato → 422 anche se la frase è coerente con il nome inviato", async () => {
    const w = await makeWorld("Nome giusto", 0);
    const res = await del(w.id, confirm("Nome sbagliato"));
    expect(res.status).toBe(422);
    expect((await countWorldRows(db, w.id)).worlds).toBe(1);
  });

  it("utente non autorizzato: un mondo con proprietario non può essere eliminato da un anonimo", async () => {
    const w = await makeWorld("Privato", 0);
    await db.update(schema.worlds).set({ ownerId: "utente-1" }).where(eq(schema.worlds.id, w.id));
    const res = await del(w.id, confirm("Privato"));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    await expect(
      deleteWorldService(w.id, confirm("Privato"), { ...deps(), actor: { userId: "utente-2" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The owner can.
    const done = await deleteWorldService(w.id, confirm("Privato"), {
      ...deps(),
      actor: { userId: "utente-1" },
    });
    expect(done.deleted.worlds).toBe(1);
  });

  it("mondo in esecuzione → 409 WORLD_RUNNING", async () => {
    const w = await makeWorld("In corsa", 0);
    await db.update(schema.worlds).set({ status: "running" }).where(eq(schema.worlds.id, w.id));
    const res = await del(w.id, confirm("In corsa"));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("WORLD_RUNNING");
    expect((await countWorldRows(db, w.id)).worlds).toBe(1);
  });

  it("simulazione in corso (lock preso) → 409 e nessun dato eliminato", async () => {
    const w = await makeWorld("Bloccato", 0);
    const lock = new PostgresSimulationLock(db);
    const held = await lock.acquire(w.id, 60_000);
    expect(held).not.toBeNull();
    await expect(deleteWorldService(w.id, confirm("Bloccato"), { db, lock })).rejects.toMatchObject({
      code: "SIMULATION_IN_PROGRESS",
      status: 409,
    });
    expect((await countWorldRows(db, w.id)).worlds).toBe(1);
    await lock.release(held!);
  });

  it("elimina il mondo e tutti i dati figli, senza toccare altri mondi né il catalogo globale", async () => {
    const target = await makeWorld("Bersaglio", 50);
    const other = await makeWorld("Vicino", 10);
    const before = await countWorldRows(db, target.id);
    const otherBefore = await countWorldRows(db, other.id);
    const [catalogBefore] = await db.select({ n: count() }).from(schema.technologies);
    // The world has real data in the main tables.
    for (const t of [
      "world_cells",
      "tribes",
      "people",
      "historical_events",
      "world_stats",
      "simulation_runs",
    ] as const)
      expect(before[t]).toBeGreaterThan(0);

    const res = await del(target.id, confirm("Bersaglio"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { deleted: Record<string, number>; total: number; name: string };
    };
    expect(body.data.name).toBe("Bersaglio");
    for (const { name } of WORLD_CHILD_TABLES) expect(body.data.deleted[name]).toBe(before[name]);
    // The report also counts the lock row the deletion itself held (removed by the cascade).
    expect(body.data.deleted.simulation_locks).toBe(1);
    expect(body.data.total).toBe(total(before) + 1);

    // No orphan rows anywhere.
    expect(total(await countWorldRows(db, target.id))).toBe(0);
    // Nothing else changed.
    expect(await countWorldRows(db, other.id)).toEqual(otherBefore);
    const [catalogAfter] = await db.select({ n: count() }).from(schema.technologies);
    expect(catalogAfter?.n).toBe(catalogBefore?.n);
    // The world page now answers "not found".
    await expect(getWorldDetailService(target.id, { db })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("è idempotente: una seconda richiesta sullo stesso mondo risponde 404 senza effetti", async () => {
    const w = await makeWorld("Due volte", 0);
    expect((await del(w.id, confirm("Due volte"))).status).toBe(200);
    const again = await del(w.id, confirm("Due volte"));
    expect(again.status).toBe(404);
  });

  it("due richieste concorrenti: una sola elimina, l'altra fallisce in modo sicuro", async () => {
    const w = await makeWorld("Concorrenza");
    const lock = new PostgresSimulationLock(db);
    const results = await Promise.allSettled([
      deleteWorldService(w.id, confirm("Concorrenza"), { db, lock }),
      deleteWorldService(w.id, confirm("Concorrenza"), { db, lock }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    for (const f of failed)
      expect(["NOT_FOUND", "SIMULATION_IN_PROGRESS"]).toContain((f.reason as AppError).code);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("rollback: se il passo finale fallisce, nessuna tabella perde righe", async () => {
    const w = await makeWorld("Rollback");
    const before = await countWorldRows(db, w.id);
    // Fault injection on the test database only: the world row refuses to be deleted.
    await db.execute(sql`
      create or replace function genesis_test_block_delete() returns trigger as $$
      begin
        if old.name = 'Rollback' then raise exception 'blocked by test'; end if;
        return old;
      end $$ language plpgsql`);
    await db.execute(sql`
      create trigger genesis_test_block before delete on worlds
      for each row execute function genesis_test_block_delete()`);
    try {
      await expect(deleteWorldService(w.id, confirm("Rollback"), deps())).rejects.toMatchObject({
        code: "DATABASE_ERROR",
      });
      // Child tables were deleted inside the transaction before the failure: all rolled back.
      expect(await countWorldRows(db, w.id)).toEqual(before);
      // The lock was released: a later deletion can proceed.
    } finally {
      await db.execute(sql`drop trigger genesis_test_block on worlds`);
      await db.execute(sql`drop function genesis_test_block_delete()`);
    }
    const done = await deleteWorldService(w.id, confirm("Rollback"), deps());
    expect(done.total).toBe(total(before) + 1);
  });
});
