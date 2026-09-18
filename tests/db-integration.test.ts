import { createWorld, hashWorld, runSimulation } from "@genesis/simulation-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import { InMemorySimulationLock, PostgresSimulationLock } from "@/lib/db/lock";
import { loadWorldState } from "@/lib/db/queries";
import {
  createWorldService,
  getEventsService,
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

    const stats = await getStatsService(world.id, 50, deps);
    expect(stats[0]!.tick).toBe(0);
    expect(stats.at(-1)!.tick).toBe(100);
    expect(stats.length).toBeLessThanOrEqual(52);

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
