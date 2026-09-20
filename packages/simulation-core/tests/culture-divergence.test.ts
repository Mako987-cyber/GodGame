import { describe, expect, it } from "vitest";
import { createWorld, CULTURE_LABELS, runSimulation } from "../src/index";
import { cultureDisposition, CULTURE_DISPOSITION_RANGE, updateCulture } from "../src/culture";
import type { CulturePressure } from "../src/culture";
import type { CultureTraits } from "../src/types";
import { world } from "./helpers";

const TRAITS = Object.keys(CULTURE_LABELS) as (keyof CultureTraits)[];

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

function spread(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

describe("cultura emergente", () => {
  it("i valori restano sempre nei limiti", () => {
    const state = world("limiti-cultura");
    const tribe = state.tribes[0]!;
    for (const extreme of [
      pressure({ war: 1, scarcity: 1, complexity: 1, expansion: 1 }),
      pressure({ war: 0, trade: 0, scarcity: 0, discovery: 0, expansion: 0, complexity: 0 }),
    ]) {
      for (let i = 0; i < 400; i++) updateCulture(tribe, extreme, 0.2, state.seed);
      for (const trait of TRAITS) {
        expect(tribe.culture[trait], trait).toBeGreaterThanOrEqual(1);
        expect(tribe.culture[trait], trait).toBeLessThanOrEqual(99);
        expect(Number.isFinite(tribe.culture[trait])).toBe(true);
      }
    }
  });

  it("lo stesso evento produce sempre la stessa variazione", () => {
    const state = world("determinismo-cultura");
    const a = structuredClone(state.tribes[0]!);
    const b = structuredClone(state.tribes[0]!);
    for (let i = 0; i < 30; i++) {
      updateCulture(a, pressure({ war: 0.8 }), 0.05, state.seed);
      updateCulture(b, pressure({ war: 0.8 }), 0.05, state.seed);
    }
    expect(a.culture).toEqual(b.culture);
  });

  it("la cultura reagisce a ciò che il gruppo vive davvero", () => {
    const state = world("pressioni");
    const warlike = structuredClone(state.tribes[0]!);
    const merchant = structuredClone(state.tribes[0]!);
    for (let i = 0; i < 60; i++) {
      updateCulture(warlike, pressure({ war: 1, trade: 0 }), 0.06, state.seed);
      updateCulture(merchant, pressure({ war: 0, trade: 1 }), 0.06, state.seed);
    }
    expect(warlike.culture.militarism).toBeGreaterThan(merchant.culture.militarism);
    expect(merchant.culture.tradeOpenness).toBeGreaterThan(warlike.culture.tradeOpenness);
  });

  it("la cultura si muove per piccoli passi, mai a scatti", () => {
    const state = world("gradualita");
    const tribe = structuredClone(state.tribes[0]!);
    const before = { ...tribe.culture };
    updateCulture(tribe, pressure({ war: 1, scarcity: 1 }), 0.05, state.seed);
    for (const trait of TRAITS) {
      expect(Math.abs(tribe.culture[trait] - before[trait]), trait).toBeLessThan(6);
    }
  });

  it("due popoli con la stessa storia non diventano lo stesso popolo", () => {
    const state = world("disposizioni");
    const [a, b] = [structuredClone(state.tribes[0]!), structuredClone(state.tribes[1]!)];
    // Identical starting culture and identical history: only their disposition differs.
    b.culture = { ...a.culture };
    for (let i = 0; i < 200; i++) {
      updateCulture(a, pressure(), 0.05, state.seed);
      updateCulture(b, pressure(), 0.05, state.seed);
    }
    expect(a.culture).not.toEqual(b.culture);
  });

  it("la disposizione è stabile, limitata e non dipende dall'identità storica", () => {
    const state = createWorld({
      seed: "disposizione-identita",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["egyptian", "roman"] },
    });
    for (const tribe of state.tribes) {
      for (const trait of TRAITS) {
        const value = cultureDisposition(state.seed, tribe.id, trait);
        expect(value).toBe(cultureDisposition(state.seed, tribe.id, trait));
        expect(Math.abs(value)).toBeLessThanOrEqual(CULTURE_DISPOSITION_RANGE);
      }
    }
    const egizi = state.tribes.find((t) => t.identityId === "egyptian")!;
    const romani = state.tribes.find((t) => t.identityId === "roman")!;
    expect(cultureDisposition(state.seed, egizi.id, "militarism")).not.toBe(
      cultureDisposition(state.seed, romani.id, "militarism"),
    );
  });

  it("senza seme la deriva resta quella dei mondi legacy", () => {
    const state = world("legacy-cultura");
    const legacy = structuredClone(state.tribes[0]!);
    const seeded = structuredClone(state.tribes[0]!);
    updateCulture(legacy, pressure(), 0.05);
    updateCulture(seeded, pressure(), 0.05, state.seed);
    expect(legacy.culture).not.toEqual(seeded.culture);
    // The legacy path still produces valid, finite traits.
    for (const trait of TRAITS) expect(Number.isFinite(legacy.culture[trait])).toBe(true);
  });

  it("in un mondo simulato le culture restano distinguibili", () => {
    const state = createWorld({ seed: "culture-mondo", width: 64, height: 64 });
    runSimulation(state, 400);
    const alive = state.tribes.filter((t) => t.status !== "extinct");
    expect(alive.length).toBeGreaterThan(3);
    // At least half the traits must still tell the peoples apart after four centuries.
    const spreads = TRAITS.map((trait) => spread(alive.map((t) => t.culture[trait])));
    expect(spreads.filter((s) => s > 5).length).toBeGreaterThanOrEqual(TRAITS.length / 2);
  });

  it("due mondi con storie diverse producono culture diverse", () => {
    const a = createWorld({ seed: "storia-a", width: 48, height: 48 });
    const b = createWorld({ seed: "storia-b", width: 48, height: 48 });
    runSimulation(a, 200);
    runSimulation(b, 200);
    const profile = (s: typeof a) => {
      const alive = s.tribes.filter((t) => t.status !== "extinct");
      return TRAITS.map(
        (trait) => alive.reduce((acc, t) => acc + t.culture[trait], 0) / Math.max(1, alive.length),
      );
    };
    expect(profile(a)).not.toEqual(profile(b));
  });
});
