import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteRoute } from "@/app/api/worlds/[worldId]/route";
import { GET as deletionGet, POST as deletionPost } from "@/app/api/worlds/[worldId]/deletion/route";
import { setDbForTesting, type Database } from "@/lib/db";
import { InMemorySimulationLock, PostgresSimulationLock } from "@/lib/db/lock";
import { loadWorldState, persistSimulation, WorldDeletedError } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import { boundedTransaction } from "@/lib/db/tx";
import {
  countWorldRows,
  residualTables,
  tombstoneWorld,
  WORLD_CASCADE_ONLY_TABLES,
  WORLD_CHILD_TABLES,
  WORLD_ID_NON_CHILD_TABLES,
} from "@/lib/db/world-deletion";
import {
  createWorldService,
  deleteWorldService,
  getWorldDetailService,
  listWorldsService,
  resumeWorldDeletionService,
  setWorldStatusService,
  simulateWorldService,
  type DeleteWorldResult,
} from "@/lib/services/world-service";
import { runSimulation } from "@genesis/simulation-core";
import { AppError } from "@/lib/utils/errors";
import { deleteConfirmationPhrase, isDeleteConfirmed } from "@/lib/validation/world";
import { createTestDb, QueryRecorder } from "./db-helpers";

// Every test runs on an in-memory PGlite database created here: never on a real database.
let db: Database;
let close: () => Promise<void>;
const recorder = new QueryRecorder();
const memLock = () => new InMemorySimulationLock();

beforeAll(async () => {
  ({ db, close } = await createTestDb({ logger: recorder }));
  setDbForTesting(db);
});
afterAll(async () => {
  setDbForTesting(null);
  await close();
});
beforeEach(() => recorder.reset());

async function makeWorld(name: string, ticks = 10) {
  const world = await createWorldService({ name, seed: `seed-${name}`, width: 32 }, { db, lock: memLock() });
  if (ticks) await simulateWorldService(world.id, ticks as 10, { db, lock: memLock() });
  return world;
}

const confirm = (name: string) => ({ confirmation: deleteConfirmationPhrase(name), worldName: name });
const deps = (extra: Record<string, unknown> = {}) => ({
  db,
  lock: new PostgresSimulationLock(db),
  ...extra,
});
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
const resume = (id: string) =>
  deletionPost(new Request(`http://test/api/worlds/${id}/deletion`, { method: "POST" }), ctx(id));
const errorBody = async (res: Response) =>
  ((await res.json()) as { error: { code: string; requestId?: string; message: string } }).error;
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
const worldStatus = async (id: string) =>
  (await db.select({ status: schema.worlds.status }).from(schema.worlds).where(eq(schema.worlds.id, id)))[0]
    ?.status;
const jobsOf = (id: string) =>
  db.select().from(schema.worldDeletionJobs).where(eq(schema.worldDeletionJobs.worldId, id));

/**
 * No transaction left open on the connection: a transaction-local setting survives into the
 * next statement only if that statement runs inside the same (still open) transaction.
 */
async function assertNoOpenTransaction() {
  await db.execute(sql`select set_config('genesis.probe', 'open', true)`);
  const result = (await db.execute(sql`select current_setting('genesis.probe', true) as v`)) as unknown as {
    rows: { v: string | null }[];
  };
  expect(result.rows[0]?.v ?? "").not.toBe("open");
}

/** Gives every child table at least one row, so a deletion is tested against all of them. */
async function fillEveryTable(worldId: string) {
  const counts = await countWorldRows(db, worldId);
  if (counts.civilizations === 0)
    await db.insert(schema.civilizations).values({
      worldId,
      id: "c999",
      seq: 999,
      name: "Stato di prova",
      color: "#ffffff",
      founderTribeId: "t1",
      capitalSettlementId: null,
      foundedYear: 0,
      status: "active",
    });
  if (counts.civilization_stats === 0)
    await db.insert(schema.civilizationStats).values({
      worldId,
      civilizationId: "c999",
      tick: 0,
      year: 0,
      population: 1,
      settlements: 0,
      technologies: 0,
      foodStored: 0,
      wealth: 0,
      territory: 0,
      stability: 0.5,
      atWar: false,
    });
  if (counts.dynasties === 0)
    await db.insert(schema.dynasties).values({
      worldId,
      id: "d999",
      seq: 999,
      name: "Casa di prova",
      tribeId: "t1",
      founderId: "p1",
      foundedYear: 0,
      prestige: 0,
      rulers: 1,
    });
  if (counts.relationships === 0)
    await db.insert(schema.relationships).values({
      worldId,
      id: "t1|t999",
      aId: "t1",
      bId: "t999",
      trust: 0,
      hostility: 0,
      tradeVolume: 0,
      conflictMemory: 0,
      atWar: false,
      allied: false,
      distance: 1,
      lastInteractionYear: 0,
      battles: 0,
    });
  if (counts.households === 0)
    await db.insert(schema.households).values({
      worldId,
      id: "h999",
      seq: 999,
      tribeId: "t1",
      partnerAId: "p1",
      partnerBId: "p2",
      formedYear: 0,
    });
  if (counts.settlements === 0)
    await db.execute(sql`insert into settlements
      select ${worldId}::uuid, 's999', 999, 'Villaggio di prova', 't1', null, 0, 0, 1, 'active', 0, null,
             0, 0, 0, 0, '{}'::jsonb, null, 0, 1, 0, '[]'::jsonb, '{}'::jsonb, 1, 1`);
  if (counts.vassal_relationships === 0)
    await db.insert(schema.vassalRelationships).values({
      worldId,
      id: "v999",
      seq: 999,
      overlordCivilizationId: "t1",
      vassalCivilizationId: "t2",
      startedAtTick: 0,
      startedYear: 0,
      tributePolicy: "standard",
      autonomy: 0.4,
      militaryObligation: 0.3,
      diplomaticStatus: "active",
    });
  if (counts.occupations === 0)
    await db.insert(schema.occupations).values({
      worldId,
      id: "o999",
      seq: 999,
      occupyingCivilizationId: "t1",
      occupiedCivilizationId: "t2",
      occupiedSettlementId: "s999",
      occupiedTerritory: { settlementId: "s999", x: 0, y: 0, radius: 1 },
      startedAtTick: 0,
      startedYear: 0,
      occupationPolicy: "military",
      resistance: 0.2,
      control: 0.5,
      status: "active",
    });
  if (counts.composite_identities === 0)
    await db.insert(schema.compositeIdentities).values({
      worldId,
      id: "ci999",
      seq: 999,
      sourceIdentityIds: ["roman", "celtic"],
      sourceCivilizationIds: ["t1", "t2"],
      memberKey: "celtic+roman",
      displayName: "Romano-Celti",
      singularNoun: "Romano-Celta",
      adjective: "romano-celtico",
      adjectiveFeminine: "romano-celtica",
      collectiveName: "i Romano-Celti",
      namingProfile: {} as never,
      visualProfile: {} as never,
      culturalProfile: {} as never,
      createdAtTick: 0,
      createdYear: 0,
      origin: "fusion",
      status: "active",
      civilizationId: "t999",
    });
  // An expired lock row (a crashed batch): removed by the cascade with the world.
  if (counts.simulation_locks === 0)
    await db.insert(schema.simulationLocks).values({
      worldId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() - 60_000),
    });
  const after = await countWorldRows(db, worldId);
  for (const [table, n] of Object.entries(after)) expect(n, table).toBeGreaterThan(0);
  return after;
}

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
    const composed = "Città";
    const decomposed = "Città";
    expect(
      isDeleteConfirmed(composed, { confirmation: `ELIMINA ${decomposed}`, worldName: decomposed }),
    ).toBe(true);
  });
});

describe("audit dello schema", () => {
  it("ogni tabella con world_id è registrata nella cancellazione", async () => {
    const result = (await db.execute(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'world_id'`)) as unknown as {
      rows: { table_name: string }[];
    };
    const withWorldId = result.rows.map((r) => r.table_name).sort();
    const registered = [
      ...WORLD_CHILD_TABLES.map((t) => t.name),
      ...WORLD_CASCADE_ONLY_TABLES.map((t) => t.name),
      ...WORLD_ID_NON_CHILD_TABLES,
    ].sort();
    expect(withWorldId).toEqual(registered);
  });

  it("ogni foreign key verso worlds è ON DELETE CASCADE e indicizzata sulla colonna figlia", async () => {
    const result = (await db.execute(sql`
      select c.conrelid::regclass::text as child, a.attname as col, c.confdeltype as on_delete,
             exists (
               select 1 from pg_index i
               where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
             ) as indexed
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = 'worlds'::regclass`)) as unknown as {
      rows: { child: string; col: string; on_delete: string; indexed: boolean }[];
    };
    const children = result.rows.map((r) => r.child).sort();
    expect(children).toEqual(
      [...WORLD_CHILD_TABLES.map((t) => t.name), ...WORLD_CASCADE_ONLY_TABLES.map((t) => t.name)].sort(),
    );
    for (const fk of result.rows) {
      expect(fk.col, fk.child).toBe("world_id");
      expect(fk.on_delete, `${fk.child}: ON DELETE`).toBe("c");
      // Without an index on the child column a cascade scans the whole child table.
      expect(fk.indexed, `${fk.child}: indice su world_id`).toBe(true);
    }
    // The job table must NOT cascade: the record of a deletion outlives the world.
    expect(children).not.toContain("world_deletion_jobs");
  });

  it("nessun trigger applicativo sulle tabelle del mondo", async () => {
    const result = (await db.execute(sql`
      select tgrelid::regclass::text as t, tgname from pg_trigger
      where not tgisinternal`)) as unknown as { rows: unknown[] };
    expect(result.rows).toEqual([]);
  });
});

describe("DELETE /api/worlds/:id — validazione", () => {
  it("worldId non valido → 404 senza toccare il database", async () => {
    const res = await del("non-un-uuid", confirm("x"));
    expect(res.status).toBe(404);
    expect(recorder.queries).toHaveLength(0);
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
    expect(await worldStatus(w.id)).toBe("paused");
  });

  it("mondo inesistente → 404 NOT_FOUND con request id", async () => {
    const res = await del(crypto.randomUUID(), confirm("Fantasma"));
    expect(res.status).toBe(404);
    const error = await errorBody(res);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.requestId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBe(error.requestId);
  });

  it("non espone SQL né stack trace negli errori", async () => {
    const res = await del(crypto.randomUUID(), confirm("Fantasma"));
    const text = await res.text();
    expect(text).not.toMatch(/select|delete from|stack|at \w+ \(/i);
  });
});

describe("precondizioni: nessun dato toccato", () => {
  it("conferma errata → 422, mondo intatto e non marcato", async () => {
    const w = await makeWorld("Conferma");
    const before = await countWorldRows(db, w.id);
    const res = await del(w.id, { confirmation: "ELIMINA Altro", worldName: "Conferma" });
    expect(res.status).toBe(422);
    expect((await errorBody(res)).code).toBe("CONFIRMATION_MISMATCH");
    expect(await countWorldRows(db, w.id)).toEqual(before);
    expect(await worldStatus(w.id)).toBe("paused");
    expect(await jobsOf(w.id)).toHaveLength(0);
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
    expect((await errorBody(res)).code).toBe("FORBIDDEN");
    await expect(
      deleteWorldService(w.id, confirm("Privato"), deps({ actor: { userId: "utente-2" } })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await worldStatus(w.id)).toBe("paused");
    // The owner can.
    const done = await deleteWorldService(w.id, confirm("Privato"), deps({ actor: { userId: "utente-1" } }));
    expect(done.completed).toBe(true);
    expect(done.deleted.worlds).toBe(1);
  });

  it("mondo in esecuzione → 409 WORLD_RUNNING", async () => {
    const w = await makeWorld("In corsa", 0);
    await db.update(schema.worlds).set({ status: "running" }).where(eq(schema.worlds.id, w.id));
    const res = await del(w.id, confirm("In corsa"));
    expect(res.status).toBe(409);
    expect((await errorBody(res)).code).toBe("WORLD_RUNNING");
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
    expect(await worldStatus(w.id)).toBe("paused");
    await lock.release(held!);
    await assertNoOpenTransaction();
  });
});

describe("cancellazione", () => {
  it("mondo piccolo: 200, tutte le tabelle svuotate, altri mondi e catalogo intatti", async () => {
    const target = await makeWorld("Bersaglio", 50);
    const other = await makeWorld("Vicino", 10);
    const before = await countWorldRows(db, target.id);
    const otherBefore = await countWorldRows(db, other.id);
    const [catalogBefore] = await db.select({ n: count() }).from(schema.technologies);
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
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { data: DeleteWorldResult };
    expect(body.data).toMatchObject({ name: "Bersaglio", completed: true, status: "completed", progress: 1 });
    for (const { name } of WORLD_CHILD_TABLES) expect(body.data.deleted[name], name).toBe(before[name]);
    expect(body.data.deleted.worlds).toBe(1);
    expect(body.data.total).toBe(total(before));

    expect(total(await countWorldRows(db, target.id))).toBe(0);
    expect(await residualTables(db, target.id)).toEqual([]);
    expect(await countWorldRows(db, other.id)).toEqual(otherBefore);
    const [catalogAfter] = await db.select({ n: count() }).from(schema.technologies);
    expect(catalogAfter?.n).toBe(catalogBefore?.n);
    await expect(getWorldDetailService(target.id, { db })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The job record outlives the world and says what happened.
    const [job] = await jobsOf(target.id);
    expect(job).toMatchObject({ status: "completed", leaseToken: null, leaseUntil: null, progress: 1 });
    expect(job?.finishedAt).toBeInstanceOf(Date);
    await assertNoOpenTransaction();
  });

  it("mondo con dati in ogni tabella figlia (incluso un lock scaduto)", async () => {
    const w = await makeWorld("Completo", 30);
    const before = await fillEveryTable(w.id);
    const done = await deleteWorldService(w.id, confirm("Completo"), deps());
    expect(done.completed).toBe(true);
    for (const name of Object.keys(before))
      expect(done.deleted[name as keyof typeof before], name).toBe(before[name as keyof typeof before]);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("mondo legacy (creato prima delle identità e dei job)", async () => {
    const w = await makeWorld("Legacy", 10);
    await db
      .update(schema.worlds)
      .set({ roster: null, simulationVersion: 1, config: {} })
      .where(eq(schema.worlds.id, w.id));
    await db
      .update(schema.tribes)
      .set({ identityId: null, identityType: "legacy" })
      .where(eq(schema.tribes.worldId, w.id));
    const done = await deleteWorldService(w.id, confirm("Legacy"), deps());
    expect(done.completed).toBe(true);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("nessuna query per-record: le DELETE sono una per blocco di righe", async () => {
    const w = await makeWorld("Set based", 30);
    const before = await countWorldRows(db, w.id);
    recorder.reset();
    const done = await deleteWorldService(w.id, confirm("Set based"), deps());
    expect(done.completed).toBe(true);
    const deletes = recorder.count(/^\s*(with gone as \(\s*)?delete from/i);
    // One batch per table (plus one empty confirmation batch when a table fills a whole batch),
    // one for the world row: nowhere near one statement per person, event or cell.
    const maxBatches = WORLD_CHILD_TABLES.reduce(
      (acc, t) => acc + Math.floor(before[t.name] / t.batch) + 1,
      1,
    );
    expect(deletes).toBeLessThanOrEqual(maxBatches);
    expect(deletes).toBeLessThan(total(before) / 50);
    // No SELECT of whole rows into JavaScript either.
    expect(recorder.count(/select .*"people"\."name"/i)).toBe(0);
  });

  it("idempotente: dopo il completamento DELETE risponde 404, la ripresa risponde completata", async () => {
    const w = await makeWorld("Due volte", 0);
    expect((await del(w.id, confirm("Due volte"))).status).toBe(200);
    expect((await del(w.id, confirm("Due volte"))).status).toBe(404);
    const again = await resume(w.id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: DeleteWorldResult }).data.completed).toBe(true);
    const status = await deletionGet(new Request("http://test"), ctx(w.id));
    expect(status.status).toBe(200);
    expect(await jobsOf(w.id)).toHaveLength(1);
  });

  it("due richieste concorrenti: un solo job, il mondo è eliminato una volta", async () => {
    const w = await makeWorld("Concorrenza");
    const results = await Promise.allSettled([
      deleteWorldService(w.id, confirm("Concorrenza"), deps()),
      deleteWorldService(w.id, confirm("Concorrenza"), deps()),
    ]);
    for (const r of results)
      if (r.status === "rejected")
        expect(["NOT_FOUND", "SIMULATION_IN_PROGRESS"]).toContain((r.reason as AppError).code);
    // Whatever interleaving, finishing is always possible and there is exactly one job.
    let state = await resumeWorldDeletionService(w.id, deps());
    for (let i = 0; !state.completed && i < 20; i++) state = await resumeWorldDeletionService(w.id, deps());
    expect(state.completed).toBe(true);
    expect(await jobsOf(w.id)).toHaveLength(1);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });
});

describe("mondo in eliminazione (tombstone)", () => {
  it("è invisibile a letture e scritture, visibile nella lista con il progresso", async () => {
    const w = await makeWorld("Tomba", 10);
    const { job } = await tombstoneWorld(db, w.id, () => undefined, { requestedBy: null });
    expect(job.status).toBe("queued");
    expect(await worldStatus(w.id)).toBe("deleting");
    await expect(getWorldDetailService(w.id, { db })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(simulateWorldService(w.id, 1, deps())).rejects.toMatchObject({ code: "NOT_FOUND" });
    // It cannot be brought back to life by pause/resume.
    await expect(setWorldStatusService(w.id, "running", { db })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await worldStatus(w.id)).toBe("deleting");
    const listed = (await listWorldsService({ db })).find((x) => x.id === w.id);
    expect(listed).toMatchObject({
      status: "deleting",
      deletion: { jobId: job.id, status: "queued", progress: 0 },
    });
    // Resuming needs no confirmation: the deletion was already confirmed.
    const done = await resumeWorldDeletionService(w.id, deps());
    expect(done.completed).toBe(true);
  });

  it("un batch di simulazione calcolato prima del tombstone non viene salvato", async () => {
    const w = await makeWorld("Gara di scrittura", 5);
    const loaded = await loadWorldState(db, w.id);
    const result = runSimulation(loaded!.state, 3);
    await tombstoneWorld(db, w.id, () => undefined, { requestedBy: null });
    const before = await countWorldRows(db, w.id);
    await expect(
      boundedTransaction(db, (tx) => persistSimulation(tx, loaded!, result)),
    ).rejects.toBeInstanceOf(WorldDeletedError);
    expect(await countWorldRows(db, w.id)).toEqual(before);
    expect((await resumeWorldDeletionService(w.id, deps())).completed).toBe(true);
  });
});

describe("robustezza del job", () => {
  it("budget esaurito (timeout simulato): 202, poi la ripresa completa senza perdite né duplicati", async () => {
    const w = await makeWorld("A blocchi", 30);
    const before = await countWorldRows(db, w.id);
    const tiny = { budgetMs: 0, batchSizes: Object.fromEntries(WORLD_CHILD_TABLES.map((t) => [t.name, 50])) };
    const first = await deleteWorldService(w.id, confirm("A blocchi"), deps(tiny));
    expect(first.completed).toBe(false);
    expect(first.retryAfterMs).toBeGreaterThan(0);
    // Route shape: a paused slice is a 202 Accepted.
    let polls = 0;
    let last = first;
    const progress: number[] = [first.progress];
    while (!last.completed && polls < 5000) {
      last = await resumeWorldDeletionService(w.id, deps({ budgetMs: 5, batchSizes: tiny.batchSizes }));
      progress.push(last.progress);
      polls++;
    }
    expect(last.completed).toBe(true);
    expect(polls).toBeGreaterThan(3);
    // Monotonic progress, exact accounting across all slices.
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
    for (const { name } of WORLD_CHILD_TABLES) expect(last.deleted[name], name).toBe(before[name]);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("la rotta risponde 202 finché il job non è finito", async () => {
    process.env.WORLD_DELETE_BUDGET_MS = "500";
    const w = await makeWorld("Rotta 202", 0);
    await tombstoneWorld(db, w.id, () => undefined, { requestedBy: null });
    // Hold the lease as if another function were working on it.
    await db
      .update(schema.worldDeletionJobs)
      .set({ leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(schema.worldDeletionJobs.worldId, w.id));
    const busy = await resume(w.id);
    expect(busy.status).toBe(202);
    expect(((await busy.json()) as { data: DeleteWorldResult }).data.completed).toBe(false);
    delete process.env.WORLD_DELETE_BUDGET_MS;
  });

  it("job ripreso dopo un'interruzione (lease scaduto di una funzione terminata)", async () => {
    const w = await makeWorld("Interrotto", 10);
    await tombstoneWorld(db, w.id, () => undefined, { requestedBy: null });
    // A function claimed the job and died: its lease is still in the future.
    await db
      .update(schema.worldDeletionJobs)
      .set({ status: "running", leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(schema.worldDeletionJobs.worldId, w.id));
    const blocked = await resumeWorldDeletionService(w.id, deps());
    expect(blocked.completed).toBe(false);
    expect((await countWorldRows(db, w.id)).people).toBeGreaterThan(0);
    // The lease expires by itself.
    await db
      .update(schema.worldDeletionJobs)
      .set({ leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.worldDeletionJobs.worldId, w.id));
    const done = await resumeWorldDeletionService(w.id, deps());
    expect(done.completed).toBe(true);
    const [job] = await jobsOf(w.id);
    expect(job).toMatchObject({ leaseToken: null, leaseUntil: null });
  });

  it("rollback di un blocco: l'errore non perde righe, il job è ripreso dopo la correzione", async () => {
    const w = await makeWorld("Rollback", 20);
    const other = await makeWorld("Spettatore", 5);
    const otherBefore = await countWorldRows(db, other.id);
    const before = await countWorldRows(db, w.id);
    // Fault injection on the test database only: deleting people of this world fails.
    await db.execute(sql`
      create or replace function genesis_test_block_delete() returns trigger as $$
      begin raise exception 'blocked by test'; end $$ language plpgsql`);
    await db.execute(sql`create trigger genesis_test_block before delete on people
      for each row execute function genesis_test_block_delete()`);
    let res: Response;
    try {
      res = await del(w.id, confirm("Rollback"));
      expect(res.status).toBe(500);
      const error = await errorBody(res);
      expect(error.code).toBe("DELETION_FAILED");
      expect(error.requestId).toBeTruthy();
      // The failing batch rolled back: every person is still there, and so is the world row.
      const mid = await countWorldRows(db, w.id);
      expect(mid.people).toBe(before.people);
      expect(mid.worlds).toBe(1);
      const [job] = await jobsOf(w.id);
      expect(job).toMatchObject({ status: "failed", currentPhase: "people", leaseToken: null });
      expect(job?.errorCode).toBe("P0001");
      // The world stays hidden: a half-deleted world is never shown.
      await expect(getWorldDetailService(w.id, { db })).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await db.execute(sql`drop trigger genesis_test_block on people`);
      await db.execute(sql`drop function genesis_test_block_delete()`);
    }
    const done = await resumeWorldDeletionService(w.id, deps());
    expect(done.completed).toBe(true);
    expect(done.total).toBe(total(before));
    expect(total(await countWorldRows(db, w.id))).toBe(0);
    expect(await countWorldRows(db, other.id)).toEqual(otherBefore);
    await assertNoOpenTransaction();
  });

  it("rollback del passo finale: la riga del mondo resta finché la verifica non passa", async () => {
    const w = await makeWorld("Passo finale", 5);
    await db.execute(sql`
      create or replace function genesis_test_block_world() returns trigger as $$
      begin raise exception 'blocked by test'; end $$ language plpgsql`);
    await db.execute(sql`create trigger genesis_test_block_w before delete on worlds
      for each row execute function genesis_test_block_world()`);
    try {
      await expect(deleteWorldService(w.id, confirm("Passo finale"), deps())).rejects.toMatchObject({
        code: "DELETION_FAILED",
      });
      expect(await worldStatus(w.id)).toBe("deleting");
      const [job] = await jobsOf(w.id);
      expect(job?.currentPhase).toBe("worlds");
    } finally {
      await db.execute(sql`drop trigger genesis_test_block_w on worlds`);
      await db.execute(sql`drop function genesis_test_block_world()`);
    }
    expect((await resumeWorldDeletionService(w.id, deps())).completed).toBe(true);
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("errore transitorio (lock/statement timeout): 202 riprendibile, nessun dato perso", async () => {
    const w = await makeWorld("Transitorio", 10);
    const before = await countWorldRows(db, w.id);
    await db.execute(sql`
      create or replace function genesis_test_timeout() returns trigger as $$
      begin raise exception 'canceling statement due to lock timeout' using errcode = '55P03'; end $$ language plpgsql`);
    await db.execute(sql`create trigger genesis_test_timeout before delete on households
      for each row execute function genesis_test_timeout()`);
    try {
      const res = await del(w.id, confirm("Transitorio"));
      expect(res.status).toBe(202);
      const body = (await res.json()) as { data: DeleteWorldResult };
      expect(body.data).toMatchObject({ completed: false, status: "running", errorCode: "55P03" });
      expect((await countWorldRows(db, w.id)).households).toBe(before.households);
    } finally {
      await db.execute(sql`drop trigger genesis_test_timeout on households`);
      await db.execute(sql`drop function genesis_test_timeout()`);
    }
    const done = await resumeWorldDeletionService(w.id, deps());
    expect(done).toMatchObject({ completed: true, errorCode: null });
    expect(total(await countWorldRows(db, w.id))).toBe(0);
  });

  it("l'endpoint risponde sempre: un errore inatteso diventa 500 con request id, senza dettagli interni", async () => {
    const w = await makeWorld("Guasto", 0);
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") return () => Promise.reject(new Error("connessione persa: segreto=xyz"));
        return Reflect.get(target, prop, receiver);
      },
    });
    setDbForTesting(broken);
    try {
      const res = await del(w.id, confirm("Guasto"));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toMatch(/segreto|stack|connessione persa/);
      expect(JSON.parse(text).error.requestId).toBeTruthy();
    } finally {
      setDbForTesting(db);
    }
    expect(await worldStatus(w.id)).toBe("paused");
  });

  it("dopo ogni esito il lock di simulazione e il lease sono rilasciati", async () => {
    const w = await makeWorld("Rilascio", 5);
    await deleteWorldService(w.id, confirm("Rilascio"), deps());
    const locks = await db
      .select()
      .from(schema.simulationLocks)
      .where(eq(schema.simulationLocks.worldId, w.id));
    expect(locks).toHaveLength(0);
    const [job] = await jobsOf(w.id);
    expect(job?.leaseToken).toBeNull();
    await assertNoOpenTransaction();
  });
});
