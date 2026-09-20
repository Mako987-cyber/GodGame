import { describe, expect, it } from "vitest";
import {
  buildCommunities,
  checkInvariants,
  compositeDefinition,
  createWorld,
  FUSION,
  identityOf,
  memberKeyOf,
  renderPoliticalName,
  serializeWorld,
  updateFusions,
  type Person,
  type Relationship,
  type Tribe,
  type WorldState,
} from "../src/index";
import { nextId, type SimContext } from "../src/context";
import { buildProfiles } from "../src/diplomacy";
import { contextWithCommunities } from "./helpers";

function setup(seed = "fusione") {
  const state = createWorld({
    seed,
    width: 48,
    height: 48,
    roster: { mode: "selected", identityKeys: ["roman", "celtic", "egyptian", "greek"] },
  });
  const by = (key: string) => state.tribes.find((t) => t.identityId === key)!;
  const roman = by("roman");
  const celtic = by("celtic");
  // The Celts live next to the Romans.
  celtic.x = Math.min(state.width - 1, roman.x + 2);
  celtic.y = roman.y;
  for (const p of state.people) if (p.tribeId === celtic.id) Object.assign(p, { x: celtic.x, y: celtic.y });
  grow(state, roman, 40);
  grow(state, celtic, 30);
  return { state, roman, celtic, egyptian: by("egyptian"), greek: by("greek") };
}

function grow(state: WorldState, tribe: Tribe, n: number) {
  const template = state.people.filter((p) => p.tribeId === tribe.id && p.age >= 20);
  for (let i = 0; i < n; i++) {
    const source = template[i % template.length]!;
    const { id, seq } = nextId(state, "person", "p");
    const person: Person = {
      ...structuredClone(source),
      id,
      seq,
      age: 26,
      role: "gatherer",
      title: null,
      notable: false,
      householdId: null,
    };
    state.people.push(person);
  }
}

function bond(state: WorldState, a: Tribe, b: Tribe, patch: Partial<Relationship> = {}): Relationship {
  const [x, y] = a.seq < b.seq ? [a, b] : [b, a];
  const rel: Relationship = {
    id: `${x.id}|${y.id}`,
    aId: x.id,
    bId: y.id,
    trust: 0.85,
    hostility: 0,
    tradeVolume: 120,
    conflictMemory: 0,
    atWar: false,
    warStartYear: null,
    allied: true,
    distance: 2,
    lastInteractionYear: state.year,
    battles: 0,
    truceUntilYear: null,
    respect: 0.5,
    tradeDependency: 0.3,
    culturalDistance: 0.05,
    status: "allied",
    phase: "peace",
    lastConflictYear: null,
    phaseYears: 0,
    fusionYears: 0,
    ...patch,
  };
  state.relationships.push(rel);
  return rel;
}

function year(ctx: SimContext) {
  buildCommunities(ctx);
  updateFusions(ctx, buildProfiles(ctx));
}

describe("fusioni", () => {
  it("condizioni insufficienti non producono fusioni (e la pressione si consuma)", () => {
    const { state, roman, celtic } = setup();
    const rel = bond(state, roman, celtic, { culturalDistance: 0.6, fusionYears: FUSION.yearsRequired - 1 });
    const ctx = contextWithCommunities(state);
    year(ctx);
    expect(state.composites).toHaveLength(0);
    expect(rel.fusionYears).toBe(FUSION.yearsRequired - 1 - FUSION.decay);
    // Conditions met but not for long enough: still nothing.
    rel.culturalDistance = 0.05;
    rel.fusionYears = 0;
    for (let i = 0; i < 5; i++) year(ctx);
    expect(state.composites).toHaveLength(0);
    expect(rel.fusionYears).toBeGreaterThan(0);
    expect(roman.status).not.toBe("extinct");
  });

  it("popoli della stessa identità non formano mai una composita", () => {
    const { state, roman, celtic } = setup("stessa");
    celtic.identityId = "roman";
    const rel = bond(state, roman, celtic, { fusionYears: 100 });
    const ctx = contextWithCommunities(state);
    year(ctx);
    expect(state.composites).toHaveLength(0);
    expect(rel.fusionYears).toBeLessThan(100);
  });

  it("condizioni sufficienti e durature producono una sola fusione, con evento", () => {
    const { state, roman, celtic } = setup("matura");
    bond(state, roman, celtic, { fusionYears: FUSION.yearsRequired - 1 });
    const ctx = contextWithCommunities(state);
    year(ctx);
    expect(state.composites).toHaveLength(1);
    const composite = state.composites[0]!;
    const fused = state.tribes.find((t) => t.id === composite.civilizationId)!;
    expect(composite).toMatchObject({
      origin: "fusion",
      status: "active",
      sourceIdentityIds: ["roman", "celtic"],
      memberKey: "celtic+roman",
      displayName: "Romano-Celti",
      adjective: "romano-celtico",
      adjectiveFeminine: "romano-celtica",
      collectiveName: "i Romano-Celti",
    });
    expect(fused).toMatchObject({
      identityType: "composite",
      identityId: composite.id,
      name: "Romano-Celti",
    });
    const event = ctx.events.find((e) => e.type === "fusion")!;
    expect(event.title).toBe("I Romani e i Celti si fondono: nascono i Romano-Celti");
    expect(event.description).toMatch(
      /identità composita generata dalla simulazione, non una civiltà storica/,
    );
    expect(event.metadata).toMatchObject({ compositeId: composite.id, newCivilizationId: fused.id });
    expect(composite.causeEventId).toBe(event.id);
    // A second year changes nothing: exactly one fusion.
    year(ctx);
    expect(state.composites).toHaveLength(1);
    expect(checkInvariants(state)).toEqual([]);
  });

  it("le identità e le civiltà d'origine restano referenziabili, mai cancellate", () => {
    const { state, roman, celtic } = setup("origini");
    const population = state.people.filter(
      (p) => p.alive && (p.tribeId === roman.id || p.tribeId === celtic.id),
    ).length;
    bond(state, roman, celtic, { fusionYears: FUSION.yearsRequired });
    const ctx = contextWithCommunities(state);
    year(ctx);
    const composite = state.composites[0]!;
    for (const src of [roman, celtic]) {
      expect(state.tribes).toContain(src);
      expect(src).toMatchObject({ status: "extinct", absorbedByTribeId: composite.civilizationId });
      expect(composite.sourceCivilizationIds).toContain(src.id);
    }
    expect(roman.identityId).toBe("roman");
    expect(celtic.identityId).toBe("celtic");
    const fused = state.tribes.find((t) => t.id === composite.civilizationId)!;
    expect(fused.absorbedIdentityIds).toEqual(expect.arrayContaining(["roman", "celtic"]));
    expect(fused.parentTribeId).toBe(roman.id);
    expect(state.people.filter((p) => p.alive && p.tribeId === fused.id)).toHaveLength(population);
  });

  it("non esistono composite duplicate dello stesso insieme di identità", () => {
    const { state, roman, celtic, greek } = setup("duplicati");
    bond(state, roman, celtic, { fusionYears: FUSION.yearsRequired });
    const ctx = contextWithCommunities(state);
    year(ctx);
    const fused = state.tribes.find((t) => t.identityType === "composite")!;
    // A successor people of the Romano-Celts and a Celtic-Roman pair would be the same set.
    expect(memberKeyOf(state, [fused.identityId!])).toBe("celtic+roman");
    expect(memberKeyOf(state, ["roman", "celtic"])).toBe(memberKeyOf(state, ["celtic", "roman"]));
    // A different set fuses fine: the Romano-Celts with the Greeks.
    greek.x = fused.x;
    greek.y = fused.y;
    for (const p of state.people) if (p.tribeId === greek.id) Object.assign(p, { x: greek.x, y: greek.y });
    grow(state, greek, 30);
    bond(state, fused, greek, { fusionYears: FUSION.yearsRequired });
    ctx.tribes.set(greek.id, greek);
    year(ctx);
    expect(state.composites).toHaveLength(2);
    expect(state.composites[1]!.memberKey).toBe("celtic+greek+roman");
    expect(new Set(state.composites.map((c) => c.memberKey)).size).toBe(state.composites.length);
  });

  it("stessa situazione, stesso risultato (determinismo di nome e profilo)", () => {
    const run = () => {
      const { state, roman, celtic } = setup("determinismo");
      bond(state, roman, celtic, { fusionYears: FUSION.yearsRequired });
      const ctx = contextWithCommunities(state);
      year(ctx);
      return state;
    };
    const a = run();
    const b = run();
    expect(a.composites).toEqual(b.composites);
    expect(serializeWorld(a)).toBe(serializeWorld(b));
    const c = a.composites[0]!;
    expect(c.visualProfile.primaryColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.namingProfile.starts.length).toBeGreaterThan(10);
    expect(c.culturalProfile.tags.length).toBeGreaterThan(0);
  });

  it("l'identità composita funziona come identità nel motore, ma non è storica", () => {
    const { state, roman, celtic } = setup("motore");
    bond(state, roman, celtic, { fusionYears: FUSION.yearsRequired });
    const ctx = contextWithCommunities(state);
    year(ctx);
    const c = state.composites[0]!;
    const definition = identityOf(state, c.id)!;
    expect(definition).toBe(compositeDefinition(c));
    expect(definition.representationNotes).toMatch(/non è una civiltà storica/);
    expect(
      renderPoliticalName("{form} {adjective}", "elder_council", { capital: "Vela", identity: definition }),
    ).toBe("Lega Romano-Celtica");
    expect(
      renderPoliticalName("{form} {adjective}", "tribal_monarchy", { capital: "Vela", identity: definition }),
    ).toBe("Regno Romano-Celtico");
  });
});
