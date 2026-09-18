import { createWorld, hashWorld, runSimulation } from "@genesis/simulation-core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock, PostgresSimulationLock } from "@/lib/db/lock";
import { loadWorldState } from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import {
  createWorldService,
  getEventsService,
  getPersonService,
  getStatsService,
  getWorldDetailService,
  simulateWorldService,
} from "@/lib/services/world-service";
import { AppError } from "@/lib/utils/errors";
import { createTestDb } from "./db-helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("lock di simulazione (Postgres)", () => {
  it("impedisce simulazioni concorrenti sullo stesso mondo", async () => {
    const world = await createWorldService(
      { name: "Lock", seed: "lock" },
      { db, lock: new InMemorySimulationLock() },
    );
    const lock = new PostgresSimulationLock(db);
    const first = await lock.acquire(world.id, 60_000);
    expect(first).not.toBeNull();
    expect(await lock.acquire(world.id, 60_000)).toBeNull();

    const denied = simulateWorldService(world.id, 1, { db, lock });
    await expect(denied).rejects.toMatchObject({ code: "SIMULATION_IN_PROGRESS", status: 409 });

    await lock.release(first!);
    const second = await lock.acquire(world.id, 60_000);
    expect(second).not.toBeNull();
    await lock.release(second!);
  });

  it("un lock scaduto può essere ripreso", async () => {
    const world = await createWorldService(
      { name: "Scaduto", seed: "scaduto" },
      { db, lock: new InMemorySimulationLock() },
    );
    const lock = new PostgresSimulationLock(db);
    expect(await lock.acquire(world.id, 1)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(await lock.acquire(world.id, 60_000)).not.toBeNull();
  });

  it("due richieste simultanee: una sola viene eseguita", async () => {
    const world = await createWorldService(
      { name: "Gara", seed: "gara" },
      { db, lock: new InMemorySimulationLock() },
    );
    const lock = new PostgresSimulationLock(db);
    const results = await Promise.allSettled([
      simulateWorldService(world.id, 10, { db, lock }),
      simulateWorldService(world.id, 10, { db, lock }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) expect((r.reason as AppError).code).toBe("SIMULATION_IN_PROGRESS");
    const reloaded = await loadWorldState(db, world.id);
    expect(reloaded?.state.tick).toBe(10 * fulfilled.length);
  });
});

describe("persistenza", () => {
  it("salva e ricarica il mondo: il risultato coincide con la simulazione in memoria", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Persistenza", seed: "persistenza" }, deps);
    const first = await simulateWorldService(world.id, 50, deps);
    expect(first.ticksRun).toBe(50);
    await simulateWorldService(world.id, 10, deps);

    const loaded = await loadWorldState(db, world.id);
    const expected = createWorld({ seed: "persistenza" });
    runSimulation(expected, 60);
    expected.archive = { people: [], households: [] };
    expect(loaded).not.toBeNull();
    expect(loaded!.state.tick).toBe(60);
    expect(hashWorld(loaded!.state)).toBe(hashWorld(expected));
  });

  it("stesso seed produce lo stesso stato iniziale anche su database", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const a = await createWorldService({ name: "A", seed: "gemelli" }, deps);
    const b = await createWorldService({ name: "B", seed: "gemelli" }, deps);
    const la = await loadWorldState(db, a.id);
    const lb = await loadWorldState(db, b.id);
    expect(hashWorld(la!.state)).toBe(hashWorld(lb!.state));
  });

  it("eventi, statistiche e dettaglio sono consultabili", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Timeline", seed: "timeline" }, deps);
    await simulateWorldService(world.id, 100, deps);

    const page = await getEventsService(world.id, { page: 1, pageSize: 5 }, deps);
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < page.items.length; i++)
      expect(page.items[i - 1]!.tick).toBeGreaterThanOrEqual(page.items[i]!.tick);

    const important = await getEventsService(world.id, { page: 1, pageSize: 100, minImportance: 3 }, deps);
    expect(important.items.every((e) => e.importance >= 3)).toBe(true);

    const stats = await getStatsService(world.id, 50, { civilizations: true }, deps);
    expect(stats.world[0]!.tick).toBe(0);
    expect(stats.world.at(-1)!.tick).toBe(100);
    expect(stats.world.length).toBeLessThanOrEqual(52);
    expect(stats.world.every((s) => Number.isFinite(s.foodSurplus))).toBe(true);

    const detail = await getWorldDetailService(world.id, deps);
    expect(detail.world.currentTick).toBe(100);
    expect(detail.map.biome).toHaveLength(48 * 48);
    const population = detail.tribes.reduce((acc, t) => acc + t.population, 0);
    expect(population).toBe(detail.world.summary.population);
    expect(detail.map.population.reduce((a, b) => a + b, 0)).toBe(population);
  });

  it("gestisce mondi inesistenti e tick oltre il limite", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    await expect(simulateWorldService(crypto.randomUUID(), 10, deps)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(simulateWorldService(crypto.randomUUID(), 5000, deps)).rejects.toMatchObject({
      code: "TICKS_NOT_ALLOWED",
    });
  });
});

describe("persistenza delle nuove entità", () => {
  it("salva e ricarica cultura, stabilità, dinastie e crisi", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Evoluzione", seed: "evoluzione" }, deps);
    await simulateWorldService(world.id, 100, deps);
    await simulateWorldService(world.id, 100, deps);

    const loaded = await loadWorldState(db, world.id);
    expect(loaded).not.toBeNull();
    const state = loaded!.state;
    expect(state.simulationVersion).toBeGreaterThanOrEqual(2);
    expect(state.config.climate.droughtChance).toBeGreaterThan(0);
    for (const tribe of state.tribes) {
      expect(tribe.culture.cooperation).toBeGreaterThan(0);
      expect(tribe.government).toBeTruthy();
      expect(tribe.stability.legitimacy).toBeGreaterThanOrEqual(0);
      expect(tribe.stock.goods).toBeDefined();
      expect(tribe.techAdoption).toBeDefined();
    }
    for (const cell of state.cells) {
      expect(Number.isFinite(cell.clay)).toBe(true);
      expect(Number.isFinite(cell.tin)).toBe(true);
      expect(Number.isFinite(cell.coal)).toBe(true);
    }
    // A reloaded state keeps replaying identically to one kept in memory.
    const detail = await getWorldDetailService(world.id, deps);
    expect(detail.world.simulationVersion).toBeGreaterThanOrEqual(2);
    expect(detail.world.climate.seasons.length).toBe(4);
    expect(detail.dynasties.length).toBe(state.dynasties.length);
  });

  it("il dettaglio persona è consultabile su richiesta", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Persone", seed: "persone" }, deps);
    await simulateWorldService(world.id, 60, deps);
    const detail = await getWorldDetailService(world.id, deps);
    const someone = detail.notablePeople[0];
    expect(someone).toBeDefined();

    const person = await getPersonService(world.id, someone!.id, deps);
    expect(person.id).toBe(someone!.id);
    expect(person.name).toBe(someone!.name);
    expect(person.tribeName).toBeTruthy();
    expect(person.family).toBeDefined();
    expect(Array.isArray(person.events)).toBe(true);
    await expect(getPersonService(world.id, "p999999", deps)).rejects.toMatchObject({ status: 404 });
  });

  it("gli eventi sono filtrabili per periodo, tipo, importanza, attore e testo", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Filtri", seed: "filtri" }, deps);
    await simulateWorldService(world.id, 100, deps);
    const all = await getEventsService(world.id, { page: 1, pageSize: 100 }, deps);
    expect(all.total).toBeGreaterThan(0);

    const ranged = await getEventsService(
      { ...world }.id,
      { page: 1, pageSize: 100, fromYear: -9980, toYear: -9950 },
      deps,
    );
    for (const e of ranged.items) {
      expect(e.year).toBeGreaterThanOrEqual(-9980);
      expect(e.year).toBeLessThanOrEqual(-9950);
    }

    const climate = await getEventsService(world.id, { page: 1, pageSize: 50, type: ["climate"] }, deps);
    expect(climate.items.every((e) => e.type === "climate")).toBe(true);

    const actorId = all.items.find((e) => e.actors.length > 0)?.actors[0]?.id;
    if (actorId) {
      const byActor = await getEventsService(world.id, { page: 1, pageSize: 50, actorId }, deps);
      expect(byActor.total).toBeGreaterThan(0);
      expect(byActor.items.every((e) => e.actors.some((a) => a.id === actorId))).toBe(true);
    }

    const word = all.items[0]!.title.split(" ")[0]!;
    const found = await getEventsService(world.id, { page: 1, pageSize: 50, search: word }, deps);
    expect(found.total).toBeGreaterThan(0);

    // SQL wildcards are escaped, not interpreted: "%" only matches a literal per-cent sign.
    const wildcard = await getEventsService(world.id, { page: 1, pageSize: 100, search: "%" }, deps);
    expect(wildcard.total).toBeLessThan(all.total);
    for (const e of wildcard.items) {
      expect(`${e.title} ${e.description}`).toContain("%");
    }
    const noMatch = await getEventsService(world.id, { page: 1, pageSize: 50, search: "%zqx%" }, deps);
    expect(noMatch.total).toBe(0);
  });

  it("le statistiche per civiltà sono campionate e filtrabili", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Serie", seed: "territorio" }, deps);
    for (let i = 0; i < 4; i++) await simulateWorldService(world.id, 100, deps);
    const stats = await getStatsService(world.id, 200, { civilizations: true }, deps);
    expect(stats.world.length).toBeGreaterThan(0);
    for (const point of stats.world) {
      expect(point.season).toBeTruthy();
      expect(point.territory).toBeGreaterThanOrEqual(0);
      expect(point.wealth).toBeGreaterThanOrEqual(0);
    }
    for (const point of stats.civilizations) {
      expect(point.civilizationId).toMatch(/^c\d+$/);
      expect(point.population).toBeGreaterThanOrEqual(0);
      expect(point.stability).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("regressioni di caricamento", () => {
  it("un mondo con celle prive dei nuovi giacimenti li ricalcola al caricamento", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Legacy", seed: "legacy-db" }, deps);
    // Simulates rows written before the extended economy: the columns exist but are NULL.
    await db
      .update(schema.worldCells)
      .set({ clay: null, tin: null, coal: null })
      .where(eq(schema.worldCells.worldId, world.id));

    const loaded = await loadWorldState(db, world.id);
    expect(loaded).not.toBeNull();
    for (const cell of loaded!.state.cells) {
      expect(Number.isFinite(cell.clay), `clay ${cell.x},${cell.y}`).toBe(true);
      expect(Number.isFinite(cell.tin)).toBe(true);
      expect(Number.isFinite(cell.coal)).toBe(true);
      expect(cell.clay).toBeGreaterThanOrEqual(0);
    }
    // At least some deposits are derived: the world is not left barren.
    expect(loaded!.state.cells.some((c) => c.clay > 0)).toBe(true);
    // And they are persisted on the next save, identical to what was derived.
    const derived = loaded!.state.cells.map((c) => c.clay);
    await simulateWorldService(world.id, 1, deps);
    const reloaded = await loadWorldState(db, world.id);
    expect(reloaded!.state.cells.map((c) => c.clay)).toEqual(derived);
  });

  it("il dettaglio di un figlio non lo dà per accoppiato con un genitore", async () => {
    const deps = { db, lock: new InMemorySimulationLock() };
    const world = await createWorldService({ name: "Nuclei", seed: "nuclei" }, deps);
    await simulateWorldService(world.id, 50, deps);
    const rows = await db
      .select()
      .from(schema.people)
      .where(and(eq(schema.people.worldId, world.id), eq(schema.people.alive, true)))
      .limit(400);
    const child = rows.find((p) => p.motherId !== null && p.householdId !== null);
    if (!child) return;
    const person = await getPersonService(world.id, child.id, deps);
    const relatives = [person.family.mother?.id, person.family.father?.id].filter(Boolean);
    expect(relatives).not.toContain(person.family.partner?.id);
    if (person.family.partner) expect(person.family.partner.id).not.toBe(person.id);
  });
});
