import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  createWorld,
  deriveCulture,
  deriveDeposits,
  deserializeWorld,
  hashWorld,
  migrateState,
  normalizeSkills,
  runSimulation,
  serializeWorld,
  SIMULATION_VERSION,
  STATE_VERSION,
  type WorldState,
} from "../src/index";

/** Strips every field introduced after the first release: simulates a world stored long ago. */
function toLegacy(state: WorldState): Record<string, unknown> {
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  delete legacy.simulationVersion;
  delete legacy.config;
  delete legacy.dynasties;
  delete legacy.crises;
  const climate = legacy.climate as Record<string, unknown>;
  delete climate.hazards;
  delete climate.trend;
  delete climate.seasons;
  delete climate.harshWinter;
  delete climate.winterSeverity;
  const counters = legacy.counters as Record<string, unknown>;
  delete counters.dynasty;
  delete counters.construction;
  delete counters.crisis;
  for (const cell of legacy.cells as Record<string, unknown>[]) {
    delete cell.clay;
    delete cell.tin;
    delete cell.coal;
    delete cell.pastures;
  }
  for (const person of legacy.people as Record<string, unknown>[]) {
    delete person.prestige;
    delete person.education;
    delete person.wealth;
    delete person.birthSettlementId;
    delete person.dynastyId;
    delete person.title;
    delete person.titleSinceYear;
    delete (person.skills as Record<string, unknown>).leadership;
  }
  for (const tribe of legacy.tribes as Record<string, unknown>[]) {
    delete tribe.techAdoption;
    delete tribe.culture;
    delete tribe.government;
    delete tribe.stability;
    delete tribe.distribution;
    delete tribe.dynastyId;
    delete tribe.lastLeaderChangeYear;
    delete (tribe.stock as Record<string, unknown>).goods;
  }
  for (const settlement of legacy.settlements as Record<string, unknown>[]) {
    delete settlement.tier;
    delete settlement.hygiene;
    delete settlement.unrest;
    delete settlement.influence;
    delete settlement.founderId;
    delete settlement.lastEpidemicYear;
    delete (settlement.stock as Record<string, unknown>).goods;
    if (settlement.construction) {
      // Old projects only had { type, progress, required, targetId }.
      const project = settlement.construction as Record<string, unknown>;
      settlement.construction = {
        type: project.buildingType ?? "hut",
        progress: project.laborCompleted ?? 0,
        required: project.laborRequired ?? 10,
        targetId: project.targetId ?? null,
      };
    }
  }
  for (const rel of legacy.relationships as Record<string, unknown>[]) {
    delete rel.respect;
    delete rel.tradeDependency;
    delete rel.culturalDistance;
    delete rel.status;
    delete rel.phase;
    delete rel.lastConflictYear;
    delete rel.phaseYears;
  }
  return legacy;
}

describe("compatibilità con i mondi esistenti", () => {
  it("uno stato in formato 1 viene caricato e completato", () => {
    const original = createWorld({ seed: "legacy" });
    runSimulation(original, 60);
    original.archive = { people: [], households: [] };
    const legacy = toLegacy(original);

    const migrated = deserializeWorld(JSON.stringify({ version: 1, state: legacy }));
    expect(migrated.simulationVersion).toBe(SIMULATION_VERSION);
    expect(migrated.config.climate.droughtChance).toBeGreaterThan(0);
    expect(migrated.dynasties).toEqual([]);
    expect(migrated.crises).toEqual([]);
    for (const cell of migrated.cells) {
      expect(Number.isFinite(cell.clay)).toBe(true);
      expect(Number.isFinite(cell.tin)).toBe(true);
      expect(Number.isFinite(cell.coal)).toBe(true);
      expect(cell.pastures).toBe(0);
    }
    for (const person of migrated.people) {
      expect(Number.isFinite(person.prestige)).toBe(true);
      expect(Number.isFinite(person.skills.leadership)).toBe(true);
    }
    for (const tribe of migrated.tribes) {
      expect(tribe.culture.cooperation).toBeGreaterThan(0);
      expect(tribe.government).toBeTruthy();
      expect(tribe.stability.legitimacy).toBeGreaterThan(0);
      expect(tribe.stock.goods).toBeDefined();
    }
    expect(checkInvariants(migrated)).toEqual([]);
  });

  it("un mondo migrato continua a simulare senza errori", () => {
    const original = createWorld({ seed: "legacy-run" });
    runSimulation(original, 40);
    original.archive = { people: [], households: [] };
    const migrated = deserializeWorld(JSON.stringify({ version: 1, state: toLegacy(original) }));
    const result = runSimulation(migrated, 50);
    expect(result.ticksRun).toBe(50);
    expect(checkInvariants(migrated, { events: result.events })).toEqual([]);
  });

  it("la migrazione è idempotente", () => {
    const state = createWorld({ seed: "idempotente" });
    runSimulation(state, 20);
    state.archive = { people: [], households: [] };
    const once = migrateState(structuredClone(state));
    const twice = migrateState(structuredClone(once));
    expect(hashWorld(twice)).toBe(hashWorld(once));
  });

  it("il round-trip non perde dati", () => {
    const state = createWorld({ seed: "roundtrip" });
    runSimulation(state, 30);
    state.archive = { people: [], households: [] };
    const restored = deserializeWorld(serializeWorld(state));
    expect(hashWorld(restored)).toBe(hashWorld(state));
    expect(restored.tribes[0]?.culture).toEqual(state.tribes[0]?.culture);
    expect(restored.config).toEqual(state.config);
  });

  it("rifiuta versioni future e accetta quelle supportate", () => {
    const state = createWorld({ seed: "versioni" });
    expect(() => deserializeWorld(JSON.stringify({ version: STATE_VERSION + 1, state }))).toThrowError(
      /più recente/,
    );
    expect(() => deserializeWorld(JSON.stringify({ version: 0, state }))).toThrowError(/non supportata/);
    expect(deserializeWorld(JSON.stringify({ version: 1, state })).tick).toBe(state.tick);
  });

  it("i valori derivati per i mondi legacy sono deterministici", () => {
    const state = createWorld({ seed: "derivati" });
    const cell = state.cells.find((c) => c.biome !== "ocean")!;
    expect(deriveDeposits("derivati", cell)).toEqual(deriveDeposits("derivati", cell));
    expect(deriveCulture("derivati", "t1")).toEqual(deriveCulture("derivati", "t1"));
    expect(deriveCulture("derivati", "t1")).not.toEqual(deriveCulture("derivati", "t2"));
    expect(normalizeSkills(undefined).leadership).toBeGreaterThan(0);
  });
});
