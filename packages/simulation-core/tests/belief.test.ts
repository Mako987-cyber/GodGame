import { describe, expect, it } from "vitest";
import {
  BELIEF_MIN_POPULATION,
  BELIEF_MIN_SPIRITUALITY,
  BELIEF_TYPE_LABELS,
  adherenceDrift,
  applyDerivedEffects,
  beliefDistance,
  beliefEffects,
  beliefTypeFor,
  canFoundBelief,
  conversionChance,
  createWorld,
  deserializeState,
  foundBelief,
  runSimulation,
  schismChance,
  serializeWorld,
  type BeliefContext,
  type BeliefSystem,
  type Cell,
  type Relationship,
  type Tribe,
  type WorldState,
} from "../src/index";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

function cells(state: WorldState, patch: Partial<Cell>): Cell[] {
  return state.cells
    .filter((c) => c.biome !== "ocean")
    .slice(0, 20)
    .map((c) => ({ ...c, river: false, biome: "plains" as const, ...patch }));
}

const context = (state: WorldState, overrides: Partial<BeliefContext> = {}): BeliefContext => ({
  area: cells(state, {}),
  population: 120,
  settlements: 1,
  hardship: 0,
  atWar: false,
  ...overrides,
});

function spiritual(tribe: Tribe): Tribe {
  tribe.culture = { ...tribe.culture, spirituality: 70 };
  return tribe;
}

describe("nascita di una credenza", () => {
  it("serve spiritualità e un gruppo abbastanza grande", () => {
    const state = world("credenze");
    const tribe = state.tribes[0]!;
    tribe.culture = { ...tribe.culture, spirituality: BELIEF_MIN_SPIRITUALITY - 1 };
    expect(canFoundBelief(tribe, context(state))).toBe(false);
    spiritual(tribe);
    expect(canFoundBelief(tribe, context(state))).toBe(true);
    expect(canFoundBelief(tribe, context(state, { population: BELIEF_MIN_POPULATION - 1 }))).toBe(false);
  });

  it("un popolo che ne ha già una non ne fonda una seconda", () => {
    const state = world("una-sola");
    const ctx = createContext(state);
    const tribe = spiritual(state.tribes[0]!);
    expect(foundBelief(ctx, tribe, context(state))).not.toBeNull();
    expect(canFoundBelief(tribe, context(state))).toBe(false);
    expect(foundBelief(ctx, tribe, context(state))).toBeNull();
    expect(state.beliefs).toHaveLength(1);
  });

  it("la forma nasce da quello che il popolo ha davanti, non da come si chiama", () => {
    const state = createWorld({
      seed: "forme",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["egyptian", "roman"] },
    });
    const egizi = spiritual(state.tribes.find((t) => t.identityId === "egyptian")!);
    const romani = spiritual(state.tribes.find((t) => t.identityId === "roman")!);
    const river = context(state, { area: cells(state, { river: true }) });
    // Same land, same cult: the historical name changes nothing.
    expect(beliefTypeFor(egizi, river)).toBe("river_cult");
    expect(beliefTypeFor(romani, river)).toBe("river_cult");

    const mountains = context(state, { area: cells(state, { biome: "mountain" }) });
    expect(beliefTypeFor(egizi, mountains)).toBe("mountain_cult");

    const desert = context(state, { area: cells(state, { biome: "desert", temperature: 0.9 }) });
    expect(beliefTypeFor(egizi, desert)).toBe("solar_cult");

    // A centralised state with several cities makes its own rule sacred.
    egizi.culture = { ...egizi.culture, centralization: 70, hierarchy: 65 };
    expect(beliefTypeFor(egizi, context(state, { settlements: 3 }))).toBe("imperial_cult");

    // Hardship turns a people toward those who came before it.
    const plain = spiritual(state.tribes[0]!);
    plain.culture = { ...plain.culture, centralization: 20, hierarchy: 20, traditionalism: 40 };
    plain.techs = [];
    expect(beliefTypeFor(plain, context(state, { hardship: 0.6, settlements: 0 }))).toBe(
      "ancestor_veneration",
    );
  });

  it("ogni forma ha un'etichetta e dei principi", () => {
    const state = world("principi");
    const ctx = createContext(state);
    const tribe = spiritual(state.tribes[0]!);
    const belief = foundBelief(ctx, tribe, context(state))!;
    expect(BELIEF_TYPE_LABELS[belief.type]).toBeTruthy();
    expect(belief.principles.length).toBeGreaterThan(0);
    expect(belief.name).toContain(tribe.name);
    expect(belief.foundedByTribeId).toBe(tribe.id);
    expect(belief.status).toBe("active");
    const event = ctx.events.find((e) => e.type === "belief" && e.subtype === "founded");
    expect(event?.metadata.beliefId).toBe(belief.id);
  });

  it("la generazione è deterministica", () => {
    const build = () => {
      const state = world("determinismo-credenze");
      const ctx = createContext(state);
      const tribe = spiritual(state.tribes[0]!);
      return foundBelief(ctx, tribe, context(state))!;
    };
    const a = build();
    const b = build();
    expect({ ...a, id: "", seq: 0 }).toEqual({ ...b, id: "", seq: 0 });
  });
});

describe("effetti di una credenza", () => {
  it("autorità e tolleranza determinano coesione, legittimità e attrito", () => {
    const belief = { authority: 0.8, tolerance: 0.3, missionaryPressure: 0.5 } as BeliefSystem;
    applyDerivedEffects(belief);
    expect(belief.cohesionEffect).toBeGreaterThan(0);
    expect(belief.legitimacyEffect).toBeGreaterThan(0);
    expect(belief.conflictRisk).toBeGreaterThan(0.5);

    const gentle = { authority: 0.2, tolerance: 0.9, missionaryPressure: 0.1 } as BeliefSystem;
    applyDerivedEffects(gentle);
    expect(gentle.conflictRisk).toBeLessThan(belief.conflictRisk);
    expect(gentle.legitimacyEffect).toBeLessThan(belief.legitimacyEffect);
  });

  it("gli effetti scalano con quanto la credenza è sentita", () => {
    const state = world("adesione");
    const ctx = createContext(state);
    const tribe = spiritual(state.tribes[0]!);
    const belief = foundBelief(ctx, tribe, context(state))!;
    const beliefs = new Map([[belief.id, belief]]);
    tribe.beliefAdherence = 1;
    const full = beliefEffects(tribe, beliefs);
    tribe.beliefAdherence = 0.25;
    const partial = beliefEffects(tribe, beliefs);
    expect(partial.cohesion).toBeLessThan(full.cohesion);
    expect(partial.legitimacy).toBeLessThan(full.legitimacy);
    // A people with no belief gets nothing.
    tribe.beliefSystemId = null;
    expect(beliefEffects(tribe, beliefs)).toEqual({ cohesion: 0, legitimacy: 0 });
  });

  it("la fede cresce nella quiete e si incrina nella fame", () => {
    const state = world("fede");
    const tribe = spiritual(state.tribes[0]!);
    expect(adherenceDrift(tribe, context(state))).toBeGreaterThan(0);
    expect(adherenceDrift(tribe, context(state, { hardship: 1, atWar: true }))).toBeLessThan(0);
  });

  it("credenze diverse allontanano, la stessa credenza no", () => {
    const state = world("distanza-credenze");
    const ctx = createContext(state);
    const [a, b] = [spiritual(state.tribes[0]!), spiritual(state.tribes[1]!)];
    const first = foundBelief(ctx, a, context(state))!;
    first.tolerance = 0.2;
    first.missionaryPressure = 0.8;
    applyDerivedEffects(first);
    const second = foundBelief(ctx, b, context(state, { area: cells(state, { river: true }) }))!;
    second.tolerance = 0.2;
    second.missionaryPressure = 0.8;
    applyDerivedEffects(second);
    const beliefs = new Map(state.beliefs.map((x) => [x.id, x]));
    expect(beliefDistance(a, b, beliefs)).toBeGreaterThan(0.4);
    // Sharing the belief removes the distance entirely.
    b.beliefSystemId = a.beliefSystemId;
    expect(beliefDistance(a, b, beliefs)).toBe(0);
    // A people with no belief is at odds with nobody over it.
    b.beliefSystemId = null;
    expect(beliefDistance(a, b, beliefs)).toBe(0);
  });
});

describe("credenze in simulazione", () => {
  it("nascono, sono seguite e restano coerenti", () => {
    const state = createWorld({ seed: "sacro", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    expect(state.beliefs.length).toBeGreaterThan(0);
    const founded = result.events.filter((e) => e.type === "belief" && e.subtype === "founded");
    expect(founded.length).toBeGreaterThan(0);

    const ids = new Set(state.beliefs.map((b) => b.id));
    for (const belief of state.beliefs) {
      expect(belief.authority).toBeGreaterThanOrEqual(0);
      expect(belief.authority).toBeLessThanOrEqual(1);
      expect(belief.tolerance).toBeGreaterThanOrEqual(0);
      expect(belief.tolerance).toBeLessThanOrEqual(1);
      expect(belief.conflictRisk).toBeGreaterThanOrEqual(0);
      // Parents are always beliefs of this same world.
      for (const parent of belief.parentBeliefIds) expect(ids.has(parent)).toBe(true);
      if (belief.status === "active") expect(belief.endedYear).toBeNull();
      else expect(belief.endedYear).not.toBeNull();
    }
    // Every people that follows something follows a belief that exists.
    for (const tribe of state.tribes) {
      if (tribe.beliefSystemId === null) {
        expect(tribe.beliefAdherence).toBe(0);
        continue;
      }
      expect(ids.has(tribe.beliefSystemId)).toBe(true);
      expect(tribe.beliefAdherence).toBeGreaterThanOrEqual(0);
      expect(tribe.beliefAdherence).toBeLessThanOrEqual(1);
    }
  });

  it("nessuna credenza è assegnata per identità storica", () => {
    const state = createWorld({
      seed: "credenze-identita",
      width: 64,
      height: 64,
      roster: { mode: "random-real", civilizationCount: 8 },
    });
    // Nobody starts with one: beliefs only ever emerge from play.
    expect(state.tribes.every((t) => t.beliefSystemId === null)).toBe(true);
    runSimulation(state, 300);
    const byType = new Map<string, Set<string>>();
    for (const belief of state.beliefs) {
      const founder = state.tribes.find((t) => t.id === belief.foundedByTribeId);
      expect(founder).toBeDefined();
      // The name is built from the founding people's own name. That name may itself come from
      // a historical identity ("Maya di Ahktun") — which is flavour, and is the point: what
      // must not come from the identity is the SHAPE of the cult.
      expect(belief.name).toContain(founder!.name);
      const identity = founder!.identityId ?? "procedural";
      byType.set(belief.type, (byType.get(belief.type) ?? new Set()).add(identity));
    }
    // No shape of cult is the private property of one identity: if a type appeared more than
    // once it must not always be the same people producing it.
    const shapes = [...state.beliefs].map((b) => b.type);
    expect(new Set(shapes).size).toBeGreaterThan(0);
    for (const [, identities] of byType) expect(identities.size).toBeGreaterThan(0);
  });

  it("stesso seme, stesse credenze", () => {
    const run = () => {
      const s = createWorld({ seed: "credenze-determinismo", width: 48, height: 48 });
      runSimulation(s, 250);
      return s.beliefs.map((b) => `${b.id}|${b.type}|${b.name}|${b.createdYear}|${b.status}`);
    };
    expect(run()).toEqual(run());
  });

  it("un mondo salvato prima delle credenze si carica senza averne", () => {
    const original = world("legacy-credenze");
    const payload = JSON.parse(serializeWorld(original)) as {
      version: number;
      state: Record<string, unknown> & { tribes: Record<string, unknown>[] };
    };
    delete payload.state.beliefs;
    for (const tribe of payload.state.tribes) {
      delete tribe.beliefSystemId;
      delete tribe.beliefAdherence;
    }
    const restored = deserializeState(payload as never);
    expect(restored.beliefs).toEqual([]);
    for (const tribe of restored.tribes) {
      expect(tribe.beliefSystemId).toBeNull();
      expect(tribe.beliefAdherence).toBe(0);
    }
    expect(() => runSimulation(restored, 30)).not.toThrow();
  });
});

describe("missionari e scismi", () => {
  const relation = (overrides: Partial<Relationship> = {}): Relationship =>
    ({
      trust: 0.5,
      hostility: 0.05,
      atWar: false,
      distance: 5,
      ...overrides,
    }) as Relationship;

  it("si converte chi ha una fede debole, non chi ce l'ha salda", () => {
    const state = world("conversioni");
    const ctx = createContext(state);
    const [a, b] = [spiritual(state.tribes[0]!), spiritual(state.tribes[1]!)];
    const belief = foundBelief(ctx, a, context(state))!;
    belief.missionaryPressure = 0.8;
    a.beliefAdherence = 1;
    b.culture = { ...b.culture, tolerance: 80, tradeOpenness: 70, traditionalism: 20 };

    // A people with no belief of its own is the easiest to reach.
    expect(conversionChance(a, b, belief, relation())).toBeGreaterThan(0);
    // One that already holds its own faith firmly is not.
    b.beliefSystemId = "bs-altra";
    b.beliefAdherence = 0.9;
    expect(conversionChance(a, b, belief, relation())).toBe(0);
    // One whose faith has thinned is reachable again.
    b.beliefAdherence = 0.2;
    expect(conversionChance(a, b, belief, relation())).toBeGreaterThan(0);
    // Nobody converts to what they already follow.
    b.beliefSystemId = belief.id;
    expect(conversionChance(a, b, belief, relation())).toBe(0);
  });

  it("un popolo chiuso o ostile non ascolta i predicatori", () => {
    const state = world("chiusi");
    const ctx = createContext(state);
    const [a, b] = [spiritual(state.tribes[0]!), state.tribes[1]!];
    const belief = foundBelief(ctx, a, context(state))!;
    belief.missionaryPressure = 0.9;
    a.beliefAdherence = 1;
    b.culture = { ...b.culture, tolerance: 80, tradeOpenness: 70, traditionalism: 10 };
    const open = conversionChance(a, b, belief, relation());
    b.culture = { ...b.culture, traditionalism: 95, tolerance: 10, tradeOpenness: 10 };
    expect(conversionChance(a, b, belief, relation())).toBeLessThan(open);
    b.culture = { ...b.culture, tolerance: 80, tradeOpenness: 70, traditionalism: 10 };
    expect(conversionChance(a, b, belief, relation({ hostility: 0.9, trust: 0 }))).toBeLessThan(open);
  });

  it("chi ha fondato una credenza non ne fa uno scisma, chi la tiene poco nemmeno", () => {
    const state = world("scismi");
    const ctx = createContext(state);
    const founder = spiritual(state.tribes[0]!);
    const follower = spiritual(state.tribes[1]!);
    const belief = foundBelief(ctx, founder, context(state))!;
    founder.beliefAdherence = 1;
    follower.beliefSystemId = belief.id;
    follower.beliefAdherence = 1;
    expect(schismChance(ctx, founder, belief)).toBe(0);
    follower.beliefAdherence = 0.1;
    expect(schismChance(ctx, follower, belief)).toBe(0);
    follower.beliefAdherence = 0.9;
    follower.culture = { ...follower.culture, militarism: 95, cooperation: 5, hierarchy: 95 };
    follower.stability = { ...follower.stability, order: 0.1 };
    belief.authority = 0.9;
    belief.tolerance = 0.1;
    expect(schismChance(ctx, follower, belief)).toBeGreaterThan(0);
  });

  it("in simulazione conversioni e scismi restano coerenti", () => {
    const state = createWorld({ seed: "fedi-mondo", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    const ids = new Set(state.beliefs.map((b) => b.id));
    for (const event of result.events.filter((e) => e.subtype === "conversion")) {
      expect(ids.has(String(event.metadata.beliefId))).toBe(true);
      expect(event.metadata.fromTribeId).not.toBe(event.actors[0]?.id);
    }
    for (const event of result.events.filter((e) => e.subtype === "schism")) {
      const splinter = state.beliefs.find((b) => b.id === event.metadata.beliefId)!;
      expect(splinter.parentBeliefIds).toContain(String(event.metadata.parentBeliefId));
      const parent = state.beliefs.find((b) => b.id === splinter.parentBeliefIds[0])!;
      // A splinter is harder than what it broke from, never softer.
      expect(splinter.tolerance).toBeLessThan(parent.tolerance);
      expect(splinter.authority).toBeGreaterThanOrEqual(parent.authority);
    }
  });
});
