import { describe, expect, it } from "vitest";
import {
  cloneWorld,
  createWorld,
  deserializeWorld,
  hashWorld,
  inBounds,
  runSimulation,
  serializeWorld,
  type HistoricalEvent,
  type WorldState,
} from "../src/index";

function assertInvariants(state: WorldState, events: HistoricalEvent[], everIds: Set<string>) {
  const tribes = new Map(state.tribes.map((t) => [t.id, t]));
  const settlements = new Map(state.settlements.map((s) => [s.id, s]));
  expect(state.people.length).toBeGreaterThanOrEqual(0);
  for (const cell of state.cells) {
    for (const v of [cell.fauna, cell.wood, cell.fertility, cell.stone, cell.copper, cell.habitability]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  }
  for (const holder of [...state.tribes.map((t) => t.stock), ...state.settlements.map((s) => s.stock)]) {
    for (const v of Object.values(holder)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  }
  for (const p of state.people) {
    expect(p.alive).toBe(true);
    expect(inBounds(state, p.x, p.y)).toBe(true);
    const tribe = tribes.get(p.tribeId);
    expect(tribe, `tribe of ${p.id}`).toBeDefined();
    expect(tribe?.status).not.toBe("extinct");
    if (p.settlementId) {
      const s = settlements.get(p.settlementId);
      expect(s?.status).toBe("active");
      expect(s?.tribeId).toBe(p.tribeId);
    }
    expect(Number.isFinite(p.health)).toBe(true);
  }
  // Dead people never act again: they are archived with a death year and cause.
  for (const p of state.archive.people) {
    expect(p.alive).toBe(false);
    expect(p.deathYear).not.toBeNull();
    expect(p.deathCause).not.toBeNull();
    expect(state.people.some((q) => q.id === p.id)).toBe(false);
  }
  for (const t of state.tribes) expect(inBounds(state, t.x, t.y)).toBe(true);
  for (const s of state.settlements) expect(inBounds(state, s.x, s.y)).toBe(true);
  for (const e of events) {
    if (e.x !== null && e.y !== null) expect(inBounds(state, e.x, e.y)).toBe(true);
    for (const a of e.actors)
      expect(everIds.has(a.id), `event ${e.type} references ${a.kind} ${a.id}`).toBe(true);
  }
}

describe("motore di simulazione", () => {
  it("100 tick rispettano gli invarianti", () => {
    const state = createWorld({ seed: "invarianti" });
    const all: HistoricalEvent[] = [];
    let changedPopulation = false;
    const initialPopulation = state.people.length;
    for (let batch = 0; batch < 10; batch++) {
      const result = runSimulation(state, 10);
      expect(result.ticksRun).toBe(10);
      all.push(...result.events);
      for (const s of result.stats) {
        expect(s.population).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s.foodProduced)).toBe(true);
        expect(Number.isFinite(s.foodStored)).toBe(true);
      }
      const everIds = new Set<string>([
        ...state.people.map((p) => p.id),
        ...state.archive.people.map((p) => p.id),
        ...state.tribes.map((t) => t.id),
        ...state.settlements.map((s) => s.id),
        ...state.civilizations.map((c) => c.id),
      ]);
      assertInvariants(state, all, everIds);
      if (state.people.length !== initialPopulation) changedPopulation = true;
    }
    expect(state.tick).toBe(100);
    expect(state.year).toBe(state.settings.startYear + 100);
    expect(changedPopulation).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });

  it("è deterministico: stesso stato + stesso seed + stessi tick = stesso risultato", () => {
    const a = createWorld({ seed: "determinismo" });
    const b = cloneWorld(a);
    const ra = runSimulation(a, 60);
    const rb = runSimulation(b, 60);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(ra.events).toEqual(rb.events);
    expect(ra.stats).toEqual(rb.stats);
  });

  it("un batch da 60 equivale a batch più piccoli con salvataggio intermedio", () => {
    const whole = createWorld({ seed: "batch" });
    runSimulation(whole, 60);

    let split = createWorld({ seed: "batch" });
    for (const n of [10, 25, 25]) {
      runSimulation(split, n);
      split.archive = { people: [], households: [] };
      // Round-trip through JSON, like persisting to and reloading from the database.
      split = deserializeWorld(serializeWorld(split));
    }
    whole.archive = { people: [], households: [] };
    expect(hashWorld(split)).toBe(hashWorld(whole));
  });

  it("rispetta la deadline e restituisce un batch parziale", () => {
    const state = createWorld({ seed: "timeout" });
    let calls = 0;
    const result = runSimulation(state, 50, { deadline: 3, now: () => calls++ });
    expect(result.partial).toBe(true);
    expect(result.ticksRun).toBeLessThan(50);
    expect(state.tick).toBe(result.ticksRun);
  });
});
