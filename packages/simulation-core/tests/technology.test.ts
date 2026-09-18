import { describe, expect, it } from "vitest";
import { canResearch, runSimulation, TECH_BY_ID, TECHNOLOGIES, techEffects } from "../src/index";
import type { TechConditionInput } from "../src/technology";
import { world } from "./helpers";

function input(techs: string[], overrides: Partial<TechConditionInput> = {}): TechConditionInput {
  const state = world("tech");
  const tribe = { ...state.tribes[0]!, techs, yearsAtLocation: 10 };
  const fertile = state.cells
    .filter((c) => c.biome !== "ocean")
    .sort((a, b) => b.baseFertility - a.baseFertility)
    .slice(0, 25);
  return {
    tribe,
    population: 200,
    settled: true,
    settlements: 2,
    maxSettlementLevel: 3,
    area: fertile.map((c) => ({ ...c, wood: 100, stone: 100, copper: 50, water: 1, maxFauna: 30 })),
    maxHostility: 0.6,
    conflictMemory: 0.5,
    ...overrides,
  };
}

describe("tecnologie", () => {
  it("rispettano i prerequisiti", () => {
    const agriculture = TECH_BY_ID.get("agriculture")!;
    expect(canResearch(agriculture, input([]))).toBe(false);
    expect(canResearch(agriculture, input(["stone_tools"]))).toBe(true);
    const writing = TECH_BY_ID.get("writing")!;
    expect(canResearch(writing, input(["fire", "stone_tools", "agriculture"]))).toBe(false);
    expect(canResearch(writing, input(["fire", "stone_tools", "agriculture", "pottery"]))).toBe(true);
  });

  it("rispettano soglie di popolazione, insediamento e geografia", () => {
    const copper = TECH_BY_ID.get("copper_working")!;
    const base = input(["fire", "stone_tools"]);
    expect(canResearch(copper, base)).toBe(true);
    expect(canResearch(copper, { ...base, population: 10 })).toBe(false);
    expect(canResearch(copper, { ...base, settled: false })).toBe(false);
    expect(canResearch(copper, { ...base, area: base.area.map((c) => ({ ...c, copper: 0 })) })).toBe(false);
  });

  it("gli effetti sono misurabili e cumulativi", () => {
    expect(techEffects([]).farmMultiplier).toBe(0);
    expect(techEffects(["agriculture"]).farmMultiplier).toBeGreaterThan(0);
    expect(techEffects(["fire"]).mortalityMultiplier).toBeLessThan(1);
    expect(techEffects(["copper_working", "military_org"]).militaryMultiplier).toBeGreaterThan(
      techEffects(["copper_working"]).militaryMultiplier,
    );
  });

  it("in simulazione ogni tecnologia scoperta ha i prerequisiti già noti", () => {
    const state = world("genesis");
    const result = runSimulation(state, 400);
    const discovered = result.events.filter((e) => e.type === "tech_discovered");
    expect(discovered.length).toBeGreaterThan(0);
    const known = new Map<string, Set<string>>();
    for (const e of discovered) {
      const tribeId = e.actors[0]!.id;
      const techId = String(e.metadata.techId);
      const set = known.get(tribeId) ?? new Set<string>();
      const def = TECHNOLOGIES.find((t) => t.id === techId)!;
      // Tribes created by a split inherit their parent's knowledge.
      const tribe = state.tribes.find((t) => t.id === tribeId)!;
      const inherited = tribe.parentTribeId ? known.get(tribe.parentTribeId) : undefined;
      for (const p of def.prerequisites)
        expect(set.has(p) || !!inherited?.has(p) || tribe.techs.includes(p)).toBe(true);
      set.add(techId);
      known.set(tribeId, set);
    }
    for (const tribe of state.tribes) {
      for (const techId of tribe.techs) {
        for (const p of TECH_BY_ID.get(techId)!.prerequisites) expect(tribe.techs).toContain(p);
      }
    }
  });
});
