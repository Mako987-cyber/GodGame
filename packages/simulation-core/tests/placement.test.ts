import { describe, expect, it } from "vitest";
import {
  createWorld,
  distance,
  isHabitableStart,
  mapSizeClass,
  PLACEMENT_BANDS,
  placementBandFor,
  placeStarts,
  type WorldState,
} from "../src/index";

const world = (seed: string, size: number, count: number, balancedPlacement = true) =>
  createWorld({
    seed,
    width: size,
    height: size,
    roster: { mode: "random-real", civilizationCount: count, balancedPlacement },
  });

function assertValid(state: WorldState, minSpacing: number) {
  const entries = state.roster!.entries;
  for (const e of entries) {
    const cell = state.cells[e.startY * state.width + e.startX]!;
    expect(isHabitableStart(cell), `${state.seed}: ${e.startX},${e.startY} ${cell.biome}`).toBe(true);
  }
  for (const a of entries)
    for (const b of entries)
      if (a !== b)
        expect(distance(a.startX, a.startY, b.startX, b.startY)).toBeGreaterThanOrEqual(minSpacing);
}

describe("fasce di qualità per dimensione della mappa", () => {
  it("le fasce sono esplicite: più ampie sulle mappe piccole, più strette sulle grandi", () => {
    expect(mapSizeClass(24, 24)).toBe("small");
    expect(mapSizeClass(48, 48)).toBe("medium");
    expect(mapSizeClass(96, 96)).toBe("large");
    const { small, medium, large } = PLACEMENT_BANDS;
    expect(small.preferredMax).toBeGreaterThan(medium.preferredMax);
    expect(medium.preferredMax).toBeGreaterThan(large.preferredMax);
    expect(small.preferredMin).toBeLessThan(large.preferredMin);
    for (const band of [small, medium, large]) {
      expect(band.fallbackMin).toBeLessThanOrEqual(band.preferredMin);
      expect(band.fallbackMax).toBeGreaterThanOrEqual(band.preferredMax);
    }
    expect(placementBandFor(32, 32)).toBe(small);
  });
});

describe("posizionamento iniziale", () => {
  it("mappe piccole: non falliscono inutilmente e restano valide", () => {
    for (let i = 1; i <= 8; i++) {
      const state = world(`piccola-${i}`, 24, 4);
      expect(state.roster!.entries).toHaveLength(4);
      assertValid(state, 3);
      const report = state.roster!.placement!;
      expect(report.band.mapSize).toBe("small");
      expect(["preferred", "fallback", "unbalanced"]).toContain(report.tier);
    }
  });

  it("mappe medie: fascia standard, acqua e distanza", () => {
    for (let i = 1; i <= 6; i++) {
      const state = world(`media-${i}`, 48, 6);
      assertValid(state, 3);
      const report = state.roster!.placement!;
      expect(report.band.mapSize).toBe("medium");
      if (report.tier === "preferred") {
        expect(report.maxQuality - report.minQuality).toBeLessThanOrEqual(report.band.preferredMax + 1e-9);
        expect(report.minQuality).toBeGreaterThanOrEqual(report.band.preferredMin);
        expect(state.roster!.entries.every((e) => e.startWater)).toBe(true);
      }
    }
  });

  it("mappe grandi: rispettano la fascia preferita", () => {
    for (let i = 1; i <= 5; i++) {
      const state = world(`grande-${i}`, 96, 8);
      const report = state.roster!.placement!;
      expect(report.band.mapSize).toBe("large");
      expect(report.tier, state.seed).toBe("preferred");
      expect(report.maxQuality - report.minQuality).toBeLessThanOrEqual(
        PLACEMENT_BANDS.large.preferredMax + 1e-9,
      );
      expect(report.minQuality).toBeGreaterThanOrEqual(PLACEMENT_BANDS.large.preferredMin);
      expect(report.minDistance).toBeGreaterThanOrEqual(5);
      expect(report.fallbackCount).toBe(state.roster!.entries.filter((e) => e.placementFallback).length);
      assertValid(state, 5);
    }
  });

  it("il fallback è deterministico: stesso seed, stesse celle, stesso rapporto", () => {
    const a = world("fallback-det", 24, 5);
    const b = world("fallback-det", 24, 5);
    expect(a.roster!.entries.map((e) => [e.startX, e.startY, e.placementFallback])).toEqual(
      b.roster!.entries.map((e) => [e.startX, e.startY, e.placementFallback]),
    );
    expect(a.roster!.placement).toEqual(b.roster!.placement);
    // Placement has its own stream: calling it again on the same state gives the same answer.
    expect(placeStarts(a, 5, { balanced: true }).report).toEqual(
      placeStarts(a, 5, { balanced: true }).report,
    );
  });

  it("nessuna civiltà riceve sistematicamente il punto migliore", () => {
    const bestSlot: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const state = world(`rotazione-${i}`, 48, 6);
      const q = state.roster!.entries.map((e) => e.startQuality);
      bestSlot.push(q.indexOf(Math.max(...q)));
    }
    const first = bestSlot.filter((s) => s === 0).length;
    expect(first, bestSlot.join(",")).toBeLessThan(12);
    expect(new Set(bestSlot).size).toBeGreaterThan(2);
  });

  it("registra le metriche di ogni partenza e del mondo", () => {
    const state = world("metriche", 48, 5);
    const report = state.roster!.placement!;
    expect(report).toMatchObject({
      band: PLACEMENT_BANDS.medium,
      requiredDistance: expect.any(Number),
      rotation: expect.any(Number),
    });
    for (const e of state.roster!.entries) {
      for (const key of ["fertility", "resources", "climatePenalty"] as const) {
        expect(e[key], key).toBeGreaterThanOrEqual(0);
        expect(e[key], key).toBeLessThanOrEqual(1.5);
      }
      expect(e.nearestStartDistance).toBeGreaterThanOrEqual(report.requiredDistance);
      expect(typeof e.placementFallback).toBe("boolean");
    }
  });

  it("senza bilanciamento le partenze sono comunque valide e marcate come fuori fascia", () => {
    const state = world("libero", 48, 6, false);
    assertValid(state, 3);
    expect(state.roster!.placement!.tier).toBe("unbalanced");
    expect(state.roster!.entries.every((e) => e.placementFallback)).toBe(true);
  });
});
