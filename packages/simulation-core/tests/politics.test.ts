import { describe, expect, it } from "vitest";
import {
  buildCommunities,
  canBecomeVassal,
  checkPoliticalInvariants,
  createVassalage,
  createWorld,
  deserializeWorld,
  serializeWorld,
  startOccupation,
  updatePolitics,
  type Person,
  type Settlement,
  type Tribe,
  type WorldState,
} from "../src/index";
import { nextId, type SimContext } from "../src/context";
import { buildProfiles } from "../src/diplomacy";
import { createSettlement } from "../src/settlements";
import { wageConflict } from "../src/warfare";
import { contextWithCommunities } from "./helpers";

const KEYS = ["roman", "celtic", "egyptian", "greek"];

function setup(seed = "politica") {
  const state = createWorld({
    seed,
    width: 48,
    height: 48,
    roster: { mode: "selected", identityKeys: KEYS },
  });
  const by = (key: string) => state.tribes.find((t) => t.identityId === key)!;
  return { state, roman: by("roman"), celtic: by("celtic"), egyptian: by("egyptian"), greek: by("greek") };
}

/** Adds `n` healthy adults to a tribe (cloned from its members). */
function inflate(
  state: WorldState,
  tribe: Tribe,
  n: number,
  at?: { x: number; y: number; settlementId?: string },
) {
  const template = state.people.filter((p) => p.tribeId === tribe.id && p.age >= 20);
  for (let i = 0; i < n; i++) {
    const source = template[i % template.length]!;
    const { id, seq } = nextId(state, "person", "p");
    const person: Person = {
      ...structuredClone(source),
      id,
      seq,
      age: 25,
      health: 1,
      role: "gatherer",
      title: null,
      notable: false,
      householdId: null,
      settlementId: at?.settlementId ?? null,
      x: at?.x ?? source.x,
      y: at?.y ?? source.y,
    };
    state.people.push(person);
  }
}

/** A settlement of `owner` next to `other`, with its people living in it. */
function settle(ctx: SimContext, owner: Tribe, near: Tribe): Settlement {
  const x = Math.min(ctx.state.width - 1, near.x + 3);
  const y = near.y;
  owner.x = x;
  owner.y = y;
  const s = createSettlement(ctx, owner, x, y);
  for (const p of ctx.state.people) {
    if (p.tribeId !== owner.id) continue;
    p.settlementId = s.id;
    p.x = x;
    p.y = y;
  }
  s.population = ctx.state.people.filter((p) => p.settlementId === s.id).length;
  owner.status = "settled";
  return s;
}

function refresh(ctx: SimContext) {
  buildCommunities(ctx);
  return buildProfiles(ctx);
}

describe("occupazione", () => {
  it("una vittoria decisiva crea un'occupazione, non un'annessione", () => {
    const { state, roman, celtic } = setup();
    const ctx = contextWithCommunities(state);
    const s = settle(ctx, celtic, roman);
    // A handful of defenders against a large army: the settlement falls.
    const defenders = state.people.filter((p) => p.tribeId === celtic.id);
    for (const p of defenders.slice(3)) p.health = 0.1;
    inflate(state, roman, 80);
    refresh(ctx);
    ctx.rng.next = () => 0.99;
    const attacker = ctx.communities.filter((c) => c.tribe.id === roman.id);
    const target = ctx.communities.find((c) => c.settlement?.id === s.id)!;
    wageConflict(ctx, {
      attacker: roman,
      defender: celtic,
      attackerCommunities: attacker,
      target,
      defenderCommunities: [target],
      relationship: {
        id: `${roman.id}|${celtic.id}`,
        aId: roman.id,
        bId: celtic.id,
        trust: 0,
        hostility: 1,
        tradeVolume: 0,
        conflictMemory: 0,
        atWar: true,
        warStartYear: state.year,
        allied: false,
        distance: 3,
        lastInteractionYear: state.year,
        battles: 0,
        truceUntilYear: null,
        respect: 0.1,
        tradeDependency: 0,
        culturalDistance: 0.3,
        status: "war",
        phase: "war",
        lastConflictYear: null,
        phaseYears: 0,
        fusionYears: 0,
      },
      kind: "battle",
      allyBonus: 0,
    });
    const occ = state.occupations.find((o) => o.occupiedSettlementId === s.id);
    expect(occ).toBeDefined();
    expect(occ).toMatchObject({
      status: "active",
      occupyingCivilizationId: roman.id,
      occupiedCivilizationId: celtic.id,
    });
    // Not annexed: owner, people and identity unchanged.
    expect(s.tribeId).toBe(celtic.id);
    expect(
      state.people.filter((p) => p.settlementId === s.id && p.alive).every((p) => p.tribeId === celtic.id),
    ).toBe(true);
    expect(ctx.events.some((e) => e.type === "occupation" && e.subtype === "started")).toBe(true);
    expect(ctx.events.some((e) => e.type === "conquest")).toBe(false);
    expect(checkPoliticalInvariants(state)).toEqual([]);
  });

  function occupied(seed = "occupata") {
    const w = setup(seed);
    const ctx = contextWithCommunities(w.state);
    const s = settle(ctx, w.celtic, w.roman);
    refresh(ctx);
    const occ = startOccupation(ctx, w.roman, w.celtic, s)!;
    return { ...w, ctx, s, occ };
  }

  it("una seconda occupazione dello stesso insediamento non è possibile", () => {
    const { ctx, egyptian, celtic, s } = occupied();
    expect(startOccupation(ctx, egyptian, celtic, s)).toBeNull();
  });

  it("l'occupante paga la guarnigione ed estrae secondo la politica; la stabilità ne risente", () => {
    const { state, ctx, roman, s, occ } = occupied("costi");
    const profiles = refresh(ctx);
    const romanFood = () =>
      ctx.communities.filter((c) => c.tribe.id === roman.id).reduce((a, c) => a + c.stock.food, 0);
    s.stock.food = 200;
    const before = romanFood();
    const tension = roman.stability.tension;
    updatePolitics(ctx, profiles);
    expect(occ.upkeepPaid).toBeGreaterThan(0);
    expect(occ.extracted).toBeGreaterThan(0);
    expect(s.stock.food).toBeLessThan(200);
    // The seat receives the extraction net of what the garrison ate.
    expect(romanFood()).not.toBe(before);
    expect(roman.stability.tension).toBeGreaterThanOrEqual(tension);
    expect(state.occupations[0]!.status).toBe("active");
  });

  it("una civiltà occupata può liberarsi", () => {
    const { state, ctx, celtic, s, occ } = occupied("liberazione");
    occ.resistance = 0.9;
    occ.control = 0.2;
    updatePolitics(ctx, refresh(ctx));
    expect(occ.status).toBe("liberated");
    expect(occ.endedYear).toBe(state.year);
    expect(s.tribeId).toBe(celtic.id);
    expect(ctx.events.some((e) => e.type === "occupation" && e.subtype === "liberated")).toBe(true);
    // The record is kept, never deleted.
    expect(state.occupations).toContain(occ);
  });

  it("dopo anni di controllo saldo l'occupazione diventa annessione, e l'identità sopravvive", () => {
    const { state, ctx, roman, celtic, s, occ } = occupied("annessione");
    occ.startedYear = state.year - 10;
    occ.control = 0.95;
    occ.resistance = 0.05;
    updatePolitics(ctx, refresh(ctx));
    expect(occ.status).toBe("annexed");
    expect(s.tribeId).toBe(roman.id);
    expect(
      state.people.filter((p) => p.settlementId === s.id && p.alive).every((p) => p.tribeId === roman.id),
    ).toBe(true);
    expect(roman.absorbedIdentityIds).toContain("celtic");
    expect(celtic.identityId).toBe("celtic");
    const annexation = ctx.events.find((e) => e.type === "conquest" && e.subtype === "annexation");
    expect(annexation?.metadata.occupationId).toBe(occ.id);
    expect(checkPoliticalInvariants(state)).toEqual([]);
  });

  it("autonomia negoziata dopo una lunga occupazione senza controllo", () => {
    const { state, ctx, occ } = occupied("autonomia");
    occ.startedYear = state.year - 30;
    occ.control = 0.3;
    occ.resistance = 0.4;
    updatePolitics(ctx, refresh(ctx));
    expect(occ.status).toBe("autonomous");
  });
});

describe("vassallaggio", () => {
  function bound(seed = "vassalli") {
    const w = setup(seed);
    const ctx = contextWithCommunities(w.state);
    const rel = createVassalage(ctx, w.roman, w.egyptian)!;
    return { ...w, ctx, rel };
  }

  it("il vassallo mantiene identità, guida e cultura; il rapporto è distinto dall'occupazione", () => {
    const { state, ctx, egyptian, rel } = bound();
    const leader = egyptian.leaderId;
    const culture = { ...egyptian.culture };
    expect(rel).toMatchObject({
      diplomaticStatus: "active",
      vassalCivilizationId: egyptian.id,
      endReason: null,
    });
    expect(egyptian.status).not.toBe("extinct");
    expect(egyptian.identityId).toBe("egyptian");
    expect(egyptian.leaderId).toBe(leader);
    expect(egyptian.culture).toEqual(culture);
    expect(state.occupations).toHaveLength(0);
    const event = ctx.events.find((e) => e.type === "vassalage" && e.subtype === "formed")!;
    expect(event.title).toBe("Gli Egizi diventano vassalli dei Romani");
    expect(rel.causeEventId).toBe(event.id);
  });

  it("il tributo passa dal vassallo al signore (con perdite di trasporto)", () => {
    const { ctx, roman, egyptian, rel } = bound("tributo");
    const profiles = refresh(ctx);
    const food = (t: Tribe) =>
      ctx.communities.filter((c) => c.tribe.id === t.id).reduce((a, c) => a + c.stock.food, 0);
    for (const c of ctx.communities.filter((c) => c.tribe.id === egyptian.id)) c.stock.food = 100;
    const vBefore = food(egyptian);
    const oBefore = food(roman);
    updatePolitics(ctx, profiles);
    expect(rel.lastTribute).toBeGreaterThan(0);
    expect(food(egyptian)).toBeCloseTo(vBefore - rel.lastTribute, 1);
    expect(food(roman)).toBeGreaterThan(oBefore);
    expect(food(roman) - oBefore).toBeLessThanOrEqual(rel.lastTribute + 1e-6);
    expect(rel.totalTribute).toBe(rel.lastTribute);
  });

  it("un vassallo può ribellarsi; la ribellione vinta porta all'indipendenza", () => {
    const { state, ctx, roman, egyptian, rel } = bound("ribellione");
    inflate(state, egyptian, 120);
    state.relationships.push({
      id: `${roman.id}|${egyptian.id}`,
      aId: roman.id,
      bId: egyptian.id,
      trust: 0,
      hostility: 0.9,
      tradeVolume: 0,
      conflictMemory: 0,
      atWar: false,
      warStartYear: null,
      allied: false,
      distance: 5,
      lastInteractionYear: state.year,
      battles: 0,
      truceUntilYear: null,
      respect: 0.1,
      tradeDependency: 0,
      culturalDistance: 0.3,
      status: "vassalage",
      phase: "peace",
      lastConflictYear: null,
      phaseYears: 0,
      fusionYears: 0,
    });
    ctx.rng.chance = () => true;
    updatePolitics(ctx, refresh(ctx));
    expect(rel.diplomaticStatus).toBe("rebellion");
    const bond = state.relationships.at(-1)!;
    expect(bond.atWar).toBe(true);
    expect(ctx.events.some((e) => e.type === "vassalage" && e.subtype === "rebellion")).toBe(true);
    // The war ends with the rebels still strong: independence.
    bond.atWar = false;
    updatePolitics(ctx, refresh(ctx));
    expect(rel).toMatchObject({ diplomaticStatus: "ended", endReason: "rebellion_won" });
    expect(state.vassalages).toContain(rel);
  });

  it("una ribellione fallita riporta il vassallo sotto il signore, con meno autonomia", () => {
    const { state, ctx, roman, egyptian, rel } = bound("ribellione-fallita");
    inflate(state, roman, 150);
    rel.diplomaticStatus = "rebellion";
    const autonomy = rel.autonomy;
    updatePolitics(ctx, refresh(ctx));
    expect(rel.diplomaticStatus).toBe("active");
    expect(rel.autonomy).toBeLessThan(autonomy);
    expect(rel.tributePolicy).toBe("heavy");
    expect(egyptian.status).not.toBe("extinct");
  });

  it("autonomia massima: indipendenza pacifica", () => {
    const { ctx, rel } = bound("indipendenza");
    rel.autonomy = 0.9;
    updatePolitics(ctx, refresh(ctx));
    expect(rel).toMatchObject({ diplomaticStatus: "ended", endReason: "independence" });
    expect(ctx.events.some((e) => e.type === "vassalage" && e.subtype === "independence")).toBe(true);
  });

  it("nessun ciclo, nessun vassallo di sé stesso, un solo signore alla volta", () => {
    const { state, ctx, roman, celtic, egyptian, greek } = bound("cicli");
    // egyptian is a vassal of roman.
    expect(canBecomeVassal(state, roman.id, roman.id)).toBe("self");
    expect(createVassalage(ctx, egyptian, roman)).toBeNull();
    expect(canBecomeVassal(state, egyptian.id, roman.id)).toBe("cycle");
    expect(canBecomeVassal(state, greek.id, egyptian.id)).toBe("already_vassal");
    // celtic becomes vassal of egyptian (a vassal can have vassals)…
    expect(createVassalage(ctx, egyptian, celtic)).not.toBeNull();
    // …but roman can never become vassal of celtic: celtic → egyptian → roman.
    expect(canBecomeVassal(state, celtic.id, roman.id)).toBe("cycle");
    expect(checkPoliticalInvariants(state)).toEqual([]);
    // A corrupted state is detected.
    state.vassalages.push({
      ...state.vassalages[0]!,
      id: "vx",
      overlordCivilizationId: celtic.id,
      vassalCivilizationId: roman.id,
    });
    state.vassalages.push({
      ...state.vassalages[0]!,
      id: "vy",
      overlordCivilizationId: greek.id,
      vassalCivilizationId: greek.id,
    });
    const problems = checkPoliticalInvariants(state).join("\n");
    expect(problems).toMatch(/ciclo/);
    expect(problems).toMatch(/sé stesso/);
  });

  it("il vassallaggio segue il mondo: serializzazione e determinismo", () => {
    const run = () => {
      const { state, ctx } = bound("determinismo");
      updatePolitics(ctx, refresh(ctx));
      return state;
    };
    const a = run();
    const b = run();
    expect(serializeWorld(a)).toBe(serializeWorld(b));
    const restored = deserializeWorld(serializeWorld(a));
    expect(restored.vassalages).toEqual(a.vassalages);
    expect(restored.occupations).toEqual(a.occupations);
  });
});

describe("mondi simulati", () => {
  it("occupazioni e vassallaggi emergono dalla simulazione rispettando le invarianti", async () => {
    const { runSimulation, checkInvariants } = await import("../src/index");
    let occupations = 0;
    let vassalages = 0;
    for (const seed of ["pol-1", "pol-2", "pol-3", "pol-4", "pol-5"]) {
      const state = createWorld({
        seed,
        width: 48,
        height: 48,
        roster: { mode: "random-real", civilizationCount: 8 },
      });
      for (let i = 0; i < 8; i++) {
        runSimulation(state, 25);
        expect(checkInvariants(state), `${seed} ${state.tick}`).toEqual([]);
      }
      occupations += state.occupations.length;
      vassalages += state.vassalages.length;
    }
    expect(occupations + vassalages).toBeGreaterThan(0);
  });
});
