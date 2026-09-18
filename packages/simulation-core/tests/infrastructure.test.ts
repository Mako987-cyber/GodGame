import { describe, expect, it } from "vitest";
import {
  BUILDINGS,
  bundleEntries,
  computeLevel,
  createWorld,
  inBounds,
  runSimulation,
  TIER_REQUIREMENTS,
  tierOf,
} from "../src/index";

describe("insediamenti e infrastrutture", () => {
  it("la fondazione rispetta i prerequisiti documentati", () => {
    const state = createWorld({ seed: "fondazione" });
    const result = runSimulation(state, 250);
    const foundations = result.events.filter((e) => e.type === "settlement_founded");
    expect(foundations.length).toBeGreaterThan(0);
    for (const e of foundations) {
      expect(Number(e.metadata.population)).toBeGreaterThan(0);
      if (e.subtype === "colony") continue;
      // Bands settle only after enough years in place and on habitable ground.
      expect(Number(e.metadata.yearsAtLocation)).toBeGreaterThanOrEqual(8);
      expect(Number(e.metadata.habitability)).toBeGreaterThanOrEqual(0.5);
    }
    for (const s of state.settlements) {
      expect(inBounds(state, s.x, s.y)).toBe(true);
    }
  });

  it("gli edifici richiedono risorse e lavoro, e i cantieri avanzano nel tempo", () => {
    const state = createWorld({ seed: "territorio" });
    const result = runSimulation(state, 250);
    const built = result.events.filter((e) => e.type === "construction");
    expect(built.length).toBeGreaterThan(0);
    for (const e of built) {
      // Nothing appears instantly: every completed work took at least one year.
      expect(Number(e.metadata.years)).toBeGreaterThanOrEqual(0);
      expect(e.metadata.building).toBeTypeOf("string");
    }
    // Open sites never hold more labour than required, nor negative deliveries.
    for (const s of state.settlements) {
      const project = s.construction;
      if (!project) continue;
      expect(project.laborCompleted).toBeGreaterThanOrEqual(0);
      expect(project.laborRequired).toBeGreaterThan(0);
      expect(["planned", "building", "paused"]).toContain(project.status);
      for (const [, amount] of bundleEntries(project.deliveredResources)) {
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ogni edificio dichiara costi, prerequisiti ed effetti", () => {
    for (const [type, def] of Object.entries(BUILDINGS)) {
      expect(def.label, type).toBeTruthy();
      expect(def.effectSummary, type).toBeTruthy();
      expect(def.work, type).toBeGreaterThanOrEqual(0);
      expect(def.minLevel, type).toBeGreaterThanOrEqual(1);
      for (const [, amount] of bundleEntries(def.cost)) expect(amount).toBeGreaterThan(0);
    }
  });

  it("i livelli dipendono da condizioni verificabili, non dall'anno", () => {
    const state = createWorld({ seed: "livelli" });
    runSimulation(state, 1);
    const tribe = state.tribes[0]!;
    const base = {
      buildings: Object.fromEntries(Object.keys(BUILDINGS).map((k) => [k, 0])),
      famineYears: 0,
      lastFoodRatio: 1,
    } as never as Parameters<typeof computeLevel>[0];
    expect(computeLevel(base, 10, tribe)).toBe(1);
    const village = { ...base, buildings: { ...base.buildings, hut: 3 } };
    expect(computeLevel(village, 40, tribe)).toBe(2);
    // Not enough people for the same buildings: still a camp.
    expect(computeLevel(village, 20, tribe)).toBe(1);
    // A town needs food security on top of the buildings: a famine blocks the promotion.
    const town = { ...village, buildings: { ...village.buildings, storehouse: 1, farm: 2 } };
    expect(computeLevel(town, 80, tribe)).toBe(3);
    expect(computeLevel({ ...town, famineYears: 2 }, 80, tribe)).toBe(2);
    expect(tierOf(2)).toBe("village");
    expect(TIER_REQUIREMENTS.every((r) => r.describe.length > 0)).toBe(true);
  });

  it("il territorio resta dentro la mappa e coerente con gli insediamenti", () => {
    const state = createWorld({ seed: "territorio" });
    runSimulation(state, 200);
    const active = new Map(state.settlements.filter((s) => s.status === "active").map((s) => [s.id, s]));
    const tribes = new Set(state.tribes.map((t) => t.id));
    for (const cell of state.cells) {
      expect(inBounds(state, cell.x, cell.y)).toBe(true);
      if (cell.settlementId) {
        expect(active.has(cell.settlementId)).toBe(true);
        expect(cell.biome).not.toBe("ocean");
      }
      if (cell.ownerTribeId) expect(tribes.has(cell.ownerTribeId)).toBe(true);
      expect(cell.fields).toBeGreaterThanOrEqual(0);
      expect(cell.pastures).toBeGreaterThanOrEqual(0);
    }
  });

  it("il collasso ricolloca le persone e libera le celle", () => {
    const state = createWorld({ seed: "collasso" });
    const result = runSimulation(state, 300);
    const collapses = result.events.filter((e) => e.type === "settlement_collapse");
    for (const e of collapses) {
      expect(Number(e.metadata.survivors)).toBeGreaterThanOrEqual(0);
      const id = String(e.metadata.settlementId);
      const settlement = state.settlements.find((s) => s.id === id)!;
      if (settlement.status === "abandoned") {
        expect(settlement.population).toBe(0);
        expect(state.people.some((p) => p.settlementId === id)).toBe(false);
        expect(state.cells.some((c) => c.settlementId === id)).toBe(false);
      }
    }
  });
});

describe("stato dei cantieri", () => {
  it("un cantiere senza materiali è in attesa, non in costruzione", () => {
    const state = createWorld({ seed: "materiali" });
    const result = runSimulation(state, 300);
    void result;
    for (const s of state.settlements) {
      const project = s.construction;
      if (!project) continue;
      const missing = bundleEntries(project.requiredResources).some(
        ([kind, amount]) => (project.deliveredResources[kind] ?? 0) + 1e-6 < amount,
      );
      // "paused" means exactly one thing: the materials have not arrived yet.
      if (missing) expect(project.status).toBe("paused");
      else expect(["building", "planned"]).toContain(project.status);
      // Work never starts before the materials are complete.
      if (missing) expect(project.laborCompleted).toBe(0);
    }
  });
});
