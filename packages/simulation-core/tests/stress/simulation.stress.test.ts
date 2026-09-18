import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  cloneWorld,
  createWorld,
  hashWorld,
  runSimulation,
  type HistoricalEvent,
  type WorldState,
} from "../../src/index";

/**
 * Stress suite: run with `npm run test:simulation`.
 * It is the slow, exhaustive counterpart of the unit tests — long runs, integrity checks
 * after every tick, and the hard rules of the engine (no `Math.random`, strict determinism).
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

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

describe("stress del motore", () => {
  it("il package di simulazione non usa Math.random", () => {
    const offenders = sourceFiles(SRC).filter((file) => /Math\.random/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("250 tick con controllo di integrità dopo ogni tick", () => {
    const state = createWorld({ seed: "stress-invarianti" });
    const events: HistoricalEvent[] = [];
    for (let tick = 0; tick < 250; tick++) {
      const result = runSimulation(state, 1, { checkInvariants: true });
      expect(result.ticksRun).toBe(1);
      events.push(...result.events);
      const problems = checkInvariants(state, { events, knownIds: everIds(state) });
      expect(problems, `tick ${state.tick}`).toEqual([]);
    }
    expect(state.tick).toBe(250);
  });

  it("nessun evento orfano e nessuna catena causale spezzata su 300 tick", () => {
    const state = createWorld({ seed: "stress-eventi" });
    const result = runSimulation(state, 300);
    const ids = new Set(result.events.map((e) => e.id));
    const known = everIds(state);
    expect(result.events.length).toBeGreaterThan(0);
    for (const e of result.events) {
      expect(e.actors.length >= 0).toBe(true);
      for (const actor of e.actors) expect(known.has(actor.id), `${e.type} -> ${actor.id}`).toBe(true);
      for (const cause of e.causeEventIds) expect(ids.has(cause), `${e.id} -> ${cause}`).toBe(true);
      expect(e.importance).toBeGreaterThanOrEqual(1);
      expect(e.importance).toBeLessThanOrEqual(5);
      expect(e.description.length).toBeGreaterThan(10);
    }
    // No duplicates: the same story is never told twice in the same year.
    const keys = new Set<string>();
    for (const e of result.events) {
      const key = `${e.year}|${e.type}|${e.subtype ?? ""}|${e.actors.map((a) => a.id).join(",")}`;
      expect(keys.has(key), `evento duplicato ${key}`).toBe(false);
      keys.add(key);
    }
  });

  it("determinismo su 250 tick con stesso seed e stesso stato", () => {
    const a = createWorld({ seed: "stress-determinismo" });
    const b = cloneWorld(a);
    const ra = runSimulation(a, 250);
    const rb = runSimulation(b, 250);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(ra.events.length).toBe(rb.events.length);
    expect(ra.stats).toEqual(rb.stats);
  });

  it("nessun mondo si estingue prematuramente su 10 semi diversi", () => {
    const seeds = [
      "stress-1",
      "stress-2",
      "stress-3",
      "aurora",
      "duna",
      "selva",
      "vento",
      "gelo",
      "rupe",
      "fiume",
    ];
    let alive = 0;
    for (const seed of seeds) {
      const state = createWorld({ seed });
      runSimulation(state, 300);
      if (state.people.length > 0) alive++;
      expect(checkInvariants(state), seed).toEqual([]);
    }
    expect(alive).toBe(seeds.length);
  });

  it("un mondo di 48x48 si genera in meno di 3 secondi", () => {
    const started = Date.now();
    const state = createWorld({ seed: "performance" });
    const elapsed = Date.now() - started;
    expect(state.cells).toHaveLength(48 * 48);
    expect(state.people.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it("un batch di 10 tick resta sotto i 3 secondi", () => {
    const state = createWorld({ seed: "performance-batch" });
    const started = Date.now();
    runSimulation(state, 10);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
