import { describe, expect, it } from "vitest";
import {
  CIVIL_WAR_MIN_CLAIMANTS,
  CIVIL_WAR_RISK,
  MARRIAGE_MAX_AGE,
  MARRIAGE_MIN_AGE,
  createWorld,
  marryHouses,
  runSimulation,
  successionCrisisRisk,
  type Person,
  type Relationship,
  type Tribe,
  type WorldState,
} from "../src/index";
import { createSettlement } from "../src/settlements";
import { createContext } from "../src/simulation-engine";
import { nextId } from "../src/context";
import { world } from "./helpers";

/** Clones `template` into `tribe` `n` times, so a people is large enough to fight over. */
function populate(state: WorldState, tribe: Tribe, template: Person, n: number, patch: Partial<Person> = {}) {
  const made: Person[] = [];
  for (let i = 0; i < n; i++) {
    const { id, seq } = nextId(state, "person", "p");
    const person = { ...structuredClone(template), id, seq, tribeId: tribe.id, householdId: null, ...patch };
    state.people.push(person);
    made.push(person);
  }
  return made;
}

describe("guerra civile e frammentazione", () => {
  it("il rischio di una successione contesa cresce con un pretendente forte", () => {
    const calm = successionCrisisRisk({
      heirs: 1,
      rivals: 0,
      minorHeir: false,
      suddenDeath: false,
      dynastyLegitimacy: 0.9,
      legitimacy: 0.8,
      centralization: 0.7,
      vassalPressure: 0,
    });
    const contested = successionCrisisRisk({
      heirs: 2,
      rivals: 2,
      minorHeir: false,
      suddenDeath: true,
      dynastyLegitimacy: 0.3,
      legitimacy: 0.3,
      centralization: 0.2,
      vassalPressure: 0.5,
    });
    expect(calm).toBe(0);
    expect(contested).toBeGreaterThan(CIVIL_WAR_RISK);
  });

  it("un popolo che si spezza produce due governi dello stesso popolo", () => {
    const state = createWorld({ seed: "guerra-civile", width: 48, height: 48 });
    const result = runSimulation(state, 600);
    const splits = result.events.filter((e) => e.subtype === "fragmentation");
    for (const split of splits) {
      const rebel = state.tribes.find((t) => t.id === split.actors[0]?.id)!;
      const parent = state.tribes.find((t) => t.id === split.metadata.parentTribeId)!;
      expect(rebel.parentTribeId).toBe(parent.id);
      // Same people, second government: identity, technologies and belief travel with them.
      expect(rebel.identityId).toBe(parent.identityId);
      expect(rebel.identityType).toBe(parent.identityType);
      expect(rebel.beliefSystemId).toBe(parent.beliefSystemId);
      // Born of a war over the throne: they do not start as friends.
      const rel = state.relationships.find(
        (r) => (r.aId === rebel.id && r.bId === parent.id) || (r.aId === parent.id && r.bId === rebel.id),
      )!;
      expect(rel.hostility).toBeGreaterThan(0.4);
      // The civil war that caused it is on record.
      expect(split.causeEventIds.length).toBeGreaterThan(0);
    }
  });

  it("una guerra civile costa vite e ordine, e non si dichiara in un gruppo minuscolo", () => {
    const state = createWorld({ seed: "guerre-civili-mondo", width: 64, height: 64 });
    const result = runSimulation(state, 600);
    for (const war of result.events.filter((e) => e.subtype === "civil_war")) {
      expect(Number(war.metadata.victims)).toBeGreaterThan(0);
      expect(Number(war.metadata.claimants)).toBeGreaterThanOrEqual(CIVIL_WAR_MIN_CLAIMANTS);
      expect(war.description).toContain("con le armi");
    }
    // Every succession says how it went, civil wars included.
    for (const s of result.events.filter((e) => e.type === "leadership" && e.subtype === "succession")) {
      expect(["peaceful", "regency", "disputed", "usurpation", "interregnum", "civil_war"]).toContain(
        s.metadata.outcome,
      );
    }
  });
});

describe("matrimoni dinastici", () => {
  const relation = (a: Tribe, b: Tribe): Relationship => ({
    id: `${a.id}|${b.id}`,
    aId: a.id,
    bId: b.id,
    trust: 0.5,
    hostility: 0.05,
    tradeVolume: 20,
    conflictMemory: 0,
    atWar: false,
    warStartYear: null,
    allied: false,
    distance: 5,
    lastInteractionYear: 0,
    battles: 0,
    truceUntilYear: null,
    respect: 0.3,
    tradeDependency: 0.1,
    culturalDistance: 0.2,
    status: "neutral",
    phase: "peace",
    lastConflictYear: null,
    phaseYears: 20,
    fusionYears: 0,
  });

  it("unisce due case, sposta la sposa e avvicina i due popoli", () => {
    const state = world("nozze", 48);
    const ctx = createContext(state);
    const [a, b] = state.tribes;
    const template = state.people.find((p) => p.tribeId === a!.id)!;
    createSettlement(ctx, a!, a!.x, a!.y);
    a!.dynastyId = "dy1";
    b!.dynastyId = "dy2";
    const [groom] = populate(state, a!, template, 1, {
      sex: "M",
      age: 25,
      dynastyId: "dy1",
      motherId: null,
      fatherId: null,
    });
    const [bride] = populate(state, b!, template, 1, {
      sex: "F",
      age: 22,
      dynastyId: "dy2",
      motherId: null,
      fatherId: null,
    });
    const rel = relation(a!, b!);

    expect(marryHouses(ctx, rel, a!, b!)).toBe(true);
    expect(bride!.tribeId).toBe(a!.id);
    expect(groom!.householdId).toBe(bride!.householdId);
    expect(groom!.householdId).not.toBeNull();
    expect(rel.trust).toBeGreaterThan(0.5);
    const event = ctx.events.find((e) => e.subtype === "dynastic_marriage");
    expect(event?.metadata.brideId).toBe(bride!.id);
    // The bride brings what her new people knows nothing of, as any exogamy in this engine does.
    for (const tech of a!.techs) expect(bride!.knowledge).toContain(tech);
  });

  it("senza due case, o senza nessuno da sposare, non si celebra nulla", () => {
    const state = world("nozze-impossibili", 48);
    const ctx = createContext(state);
    const [a, b] = state.tribes;
    const rel = relation(a!, b!);
    // No houses at all.
    expect(marryHouses(ctx, rel, a!, b!)).toBe(false);
    a!.dynastyId = "dy1";
    b!.dynastyId = "dy2";
    // Houses, but nobody of the right age and free.
    for (const p of state.people) p.householdId = "h-taken";
    expect(marryHouses(ctx, rel, a!, b!)).toBe(false);
    expect(ctx.events.some((e) => e.subtype === "dynastic_marriage")).toBe(false);
  });

  it("le età ammesse comprendono le promesse fra ragazzi, sotto l'età fertile", () => {
    expect(MARRIAGE_MIN_AGE).toBeLessThan(16);
    expect(MARRIAGE_MAX_AGE).toBeGreaterThanOrEqual(45);
  });
});
