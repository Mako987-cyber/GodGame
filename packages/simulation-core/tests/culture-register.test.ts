import { describe, expect, it } from "vitest";
import {
  CULTURE_LABELS,
  CULTURE_RECORD_THRESHOLD,
  CULTURE_TRAITS,
  MAX_CULTURE_HISTORY,
  createWorld,
  recordCultureChanges,
  runSimulation,
  updateCulture,
  type CulturePressure,
  type CultureTraits,
} from "../src/index";
import { world } from "./helpers";

const pressure = (overrides: Partial<CulturePressure> = {}): CulturePressure => ({
  war: 0.1,
  trade: 0.3,
  scarcity: 0.1,
  discovery: 0.3,
  expansion: 0.2,
  complexity: 0.3,
  contact: 0.3,
  belief: 0.2,
  ...overrides,
});

describe("i quattro tratti aggiunti", () => {
  it("l'elenco canonico copre esattamente i tratti, senza buchi né doppioni", () => {
    const state = world("tratti");
    const culture = state.tribes[0]!.culture;
    expect([...CULTURE_TRAITS].sort()).toEqual(Object.keys(culture).sort());
    expect(new Set(CULTURE_TRAITS).size).toBe(CULTURE_TRAITS.length);
    for (const trait of CULTURE_TRAITS) expect(CULTURE_LABELS[trait]).toBeTruthy();
  });

  it("restano nei limiti sotto qualsiasi pressione", () => {
    const state = world("limiti-nuovi");
    const tribe = state.tribes[0]!;
    for (const extreme of [
      pressure({ war: 1, scarcity: 1, contact: 0, belief: 0, complexity: 1 }),
      pressure({ war: 0, scarcity: 0, contact: 1, belief: 1, complexity: 0, trade: 1 }),
    ]) {
      for (let i = 0; i < 400; i++) updateCulture(tribe, extreme, 0.2, state.seed);
      for (const trait of CULTURE_TRAITS) {
        expect(tribe.culture[trait], trait).toBeGreaterThanOrEqual(1);
        expect(tribe.culture[trait], trait).toBeLessThanOrEqual(99);
      }
    }
  });

  it("reagiscono a ciò che il gruppo vive", () => {
    const state = world("reazioni");
    const open = structuredClone(state.tribes[0]!);
    const besieged = structuredClone(state.tribes[0]!);
    for (let i = 0; i < 80; i++) {
      updateCulture(open, pressure({ contact: 1, war: 0, trade: 1 }), 0.06, state.seed);
      updateCulture(besieged, pressure({ contact: 0, war: 1, scarcity: 0.8 }), 0.06, state.seed);
    }
    expect(open.culture.tolerance).toBeGreaterThan(besieged.culture.tolerance);
    expect(open.culture.exploration).toBeGreaterThan(besieged.culture.exploration);
    expect(open.culture.culturalCohesion).toBeGreaterThan(besieged.culture.culturalCohesion);

    const simple = structuredClone(state.tribes[0]!);
    const complex = structuredClone(state.tribes[0]!);
    for (let i = 0; i < 80; i++) {
      updateCulture(simple, pressure({ complexity: 0 }), 0.06, state.seed);
      updateCulture(complex, pressure({ complexity: 1 }), 0.06, state.seed);
    }
    expect(complex.culture.administrativeCapacity).toBeGreaterThan(simple.culture.administrativeCapacity);
  });
});

describe("registro delle variazioni culturali", () => {
  it("non registra nulla se la cultura non si muove abbastanza", () => {
    const state = world("registro-quieto");
    const tribe = state.tribes[0]!;
    const before = { ...tribe.culture };
    recordCultureChanges(tribe, before, { tick: 1, year: -9990 });
    expect(tribe.cultureHistory).toEqual([]);
  });

  it("registra le variazioni con valore precedente, nuovo, causa e motivo", () => {
    const state = world("registro");
    const tribe = state.tribes[0]!;
    const before = { ...tribe.culture };
    tribe.culture.militarism = Math.min(99, before.militarism + 10);
    recordCultureChanges(tribe, before, { tick: 7, year: -9950, causeEventId: "e42" });
    const record = tribe.cultureHistory.find((r) => r.trait === "militarism");
    expect(record).toBeDefined();
    expect(record!.previousValue).toBe(before.militarism);
    expect(record!.newValue).toBe(tribe.culture.militarism);
    expect(record!.cause).toBe("war");
    expect(record!.reason).toContain(CULTURE_LABELS.militarism);
    expect(record!.causeEventId).toBe("e42");
    expect(record!.tick).toBe(7);
    expect(record!.year).toBe(-9950);
  });

  it("l'ordine non dipende dall'ordine delle chiavi dell'oggetto cultura", () => {
    const state = world("ordine");
    const a = structuredClone(state.tribes[0]!);
    const b = structuredClone(state.tribes[0]!);
    // JSONB does not preserve key order: a culture reloaded from the database can arrive with
    // its keys in any order, and the register must come out the same all the same.
    const shuffled = Object.fromEntries(
      [...CULTURE_TRAITS].reverse().map((t) => [t, b.culture[t]]),
    ) as unknown as CultureTraits;
    b.culture = shuffled;
    const beforeA = { ...a.culture };
    const beforeB = { ...b.culture };
    for (const trait of CULTURE_TRAITS) {
      a.culture[trait] = Math.min(99, a.culture[trait] + 5);
      b.culture[trait] = Math.min(99, b.culture[trait] + 5);
    }
    recordCultureChanges(a, beforeA, { tick: 1, year: 0 });
    recordCultureChanges(b, beforeB, { tick: 1, year: 0 });
    expect(b.cultureHistory.map((r) => r.trait)).toEqual(a.cultureHistory.map((r) => r.trait));
    expect(a.cultureHistory.map((r) => r.trait)).toEqual([...CULTURE_TRAITS]);
  });

  it("il registro è limitato: le voci più vecchie escono", () => {
    const state = world("limite-registro");
    const tribe = state.tribes[0]!;
    for (let i = 0; i < MAX_CULTURE_HISTORY * 3; i++) {
      const before = { ...tribe.culture };
      tribe.culture.militarism = 5 + ((i * 13) % 90);
      recordCultureChanges(tribe, before, { tick: i, year: i });
    }
    expect(tribe.cultureHistory.length).toBeLessThanOrEqual(MAX_CULTURE_HISTORY);
    // What is kept is the most recent.
    expect(tribe.cultureHistory.at(-1)!.tick).toBe(MAX_CULTURE_HISTORY * 3 - 1);
  });

  it("in simulazione ogni voce è coerente e limitata", () => {
    const state = createWorld({ seed: "registro-mondo", width: 64, height: 64 });
    runSimulation(state, 400);
    let recorded = 0;
    for (const tribe of state.tribes) {
      expect(tribe.cultureHistory.length).toBeLessThanOrEqual(MAX_CULTURE_HISTORY);
      recorded += tribe.cultureHistory.length;
      for (const r of tribe.cultureHistory) {
        expect(CULTURE_TRAITS).toContain(r.trait);
        expect(Math.abs(r.newValue - r.previousValue)).toBeGreaterThanOrEqual(CULTURE_RECORD_THRESHOLD);
        expect(r.reason).toBeTruthy();
        expect(r.year).toBeLessThanOrEqual(state.year);
      }
      // Records arrive in chronological order.
      const ticks = tribe.cultureHistory.map((r) => r.tick);
      expect([...ticks].sort((x, y) => x - y)).toEqual(ticks);
    }
    expect(recorded).toBeGreaterThan(0);
  });

  it("un mondo salvato prima del registro si carica con i tratti derivati e nessuna voce", async () => {
    const { deserializeState, serializeWorld } = await import("../src/index");
    const original = world("legacy-registro");
    const payload = JSON.parse(serializeWorld(original)) as {
      version: number;
      state: { tribes: Record<string, unknown>[] };
    };
    for (const tribe of payload.state.tribes) {
      delete tribe.cultureHistory;
      const culture = tribe.culture as Record<string, unknown>;
      for (const trait of ["tolerance", "exploration", "administrativeCapacity", "culturalCohesion"]) {
        delete culture[trait];
      }
    }
    const restored = deserializeState(payload as never);
    const again = deserializeState(JSON.parse(JSON.stringify(payload)) as never);
    const added = ["tolerance", "exploration", "administrativeCapacity", "culturalCohesion"] as const;
    for (const [i, tribe] of restored.tribes.entries()) {
      expect(tribe.cultureHistory).toEqual([]);
      // A world that never had these traits has nothing to restore, so they are derived from
      // the seed and the tribe id: always the same values, never drawn from the simulation RNG.
      for (const trait of added) {
        expect(tribe.culture[trait]).toBe(again.tribes[i]!.culture[trait]);
        expect(tribe.culture[trait]).toBeGreaterThanOrEqual(5);
        expect(tribe.culture[trait]).toBeLessThanOrEqual(95);
      }
      // The nine traits it did have are untouched.
      for (const trait of CULTURE_TRAITS.filter((t) => !added.includes(t as never))) {
        expect(tribe.culture[trait]).toBe(original.tribes[i]!.culture[trait]);
      }
    }
  });
});
