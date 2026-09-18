import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  cloneWorld,
  createWorld,
  deserializeWorld,
  hashWorld,
  runSimulation,
  serializeWorld,
  type HistoricalEvent,
  type WorldState,
} from "../src/index";

function everIds(state: WorldState): Set<string> {
  return new Set<string>([
    ...state.people.map((p) => p.id),
    ...state.archive.people.map((p) => p.id),
    ...state.tribes.map((t) => t.id),
    ...state.settlements.map((s) => s.id),
    ...state.civilizations.map((c) => c.id),
    ...state.dynasties.map((d) => d.id),
  ]);
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
        expect(Number.isFinite(s.wealth)).toBe(true);
      }
      expect(checkInvariants(state, { events: all, knownIds: everIds(state) })).toEqual([]);
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
    expect(ra.civStats).toEqual(rb.civStats);
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

  it("la pipeline produce metriche coerenti ogni tick", () => {
    const state = createWorld({ seed: "metriche" });
    const result = runSimulation(state, 40);
    expect(result.stats).toHaveLength(40);
    for (const s of result.stats) {
      expect(["spring", "summer", "autumn", "winter"]).toContain(s.season);
      expect(s.averageTemperature).toBeGreaterThanOrEqual(0);
      expect(s.averageTemperature).toBeLessThanOrEqual(1);
      expect(s.climateStress).toBeGreaterThanOrEqual(0);
      expect(s.territory).toBeGreaterThanOrEqual(0);
      expect(s.deaths).toBeGreaterThanOrEqual(
        s.starvationDeaths + s.conflictDeaths + s.epidemicDeaths - s.deaths,
      );
    }
  });
});
