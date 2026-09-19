import { describe, expect, it } from "vitest";
import {
  checkIdentityLineage,
  cloneWorld,
  createWorld,
  deserializeState,
  hashWorld,
  recordAbsorbedIdentity,
  runSimulation,
  serializeWorld,
  STATE_VERSION,
  type Person,
  type Tribe,
  type WorldState,
} from "../src/index";
import { nextId, type Community } from "../src/context";
import { fixArticles } from "../src/events";
import { joinNearbyGroup, splitBand } from "../src/migration";
import {
  checkCivilization,
  createSettlement,
  recordCivilizationCollapse,
  trySecession,
  updateCivilizationForm,
} from "../src/settlements";
import { contextWithCommunities } from "./helpers";

const historicalWorld = (seed = "continuita") =>
  createWorld({
    seed,
    width: 48,
    height: 48,
    roster: { mode: "selected", identityKeys: ["egyptian", "roman", "maya", "inca"] },
  });

const byIdentity = (state: WorldState, key: string) => state.tribes.find((t) => t.identityId === key)!;

/** Adds `n` members to a tribe, cloned household by household so bands can split. */
function inflate(state: WorldState, tribe: Tribe, n: number) {
  const template = state.people.filter((p) => p.tribeId === tribe.id);
  for (let i = 0; i < n; i++) {
    const source = template[i % template.length]!;
    const { id, seq } = nextId(state, "person", "p");
    state.people.push({ ...structuredClone(source), id, seq, role: "gatherer", title: null, notable: false });
  }
}

function members(state: WorldState, tribe: Tribe): Person[] {
  return state.people.filter((p) => p.tribeId === tribe.id && p.alive);
}

describe("continuità delle identità", () => {
  it("una banda che si divide resta lo stesso popolo: stessa identità, genitore registrato, evento", () => {
    const state = historicalWorld();
    const egizi = byIdentity(state, "egyptian");
    inflate(state, egizi, 90);
    const ctx = contextWithCommunities(state);
    ctx.rng.chance = () => true;
    const band = ctx.communities.find((c) => c.tribe.id === egizi.id)!;
    const child = splitBand(ctx, band);
    expect(child).not.toBeNull();
    expect(child!.identityId).toBe("egyptian");
    expect(child!.identityType).toBe("historical");
    expect(child!.parentTribeId).toBe(egizi.id);
    expect(child!.name).toMatch(/^Egizi di /);
    expect(egizi.name).toBe("Egizi");
    const event = ctx.events.find((e) => e.subtype === "split");
    expect(event?.metadata.identityId).toBe("egyptian");
    expect(event?.title).toContain(child!.name);
    expect(checkIdentityLineage(state)).toEqual([]);
  });

  it("una colonia che si separa diventa uno stato successore con nome collegato", () => {
    const state = historicalWorld("secessione");
    const romani = byIdentity(state, "roman");
    const ctx = contextWithCommunities(state);
    const spots = [
      { x: romani.x, y: romani.y },
      { x: Math.min(state.width - 1, romani.x + 2), y: romani.y },
      { x: romani.x, y: Math.min(state.height - 1, romani.y + 12) },
    ];
    const [capital, , colony] = spots.map((p) => createSettlement(ctx, romani, p.x, p.y));
    capital!.population = 200;
    colony!.population = 45;
    inflate(state, romani, 40);
    const colonists = members(state, romani).slice(0, 45);
    for (const p of colonists) p.settlementId = colony!.id;
    const community: Community = {
      key: colony!.id,
      kind: "settlement",
      tribe: romani,
      settlement: colony!,
      x: colony!.x,
      y: colony!.y,
      radius: 2,
      area: [],
      members: colonists,
      stock: colony!.stock,
      foodRatio: 1,
      threat: 0,
    };
    ctx.rng.chance = () => true;
    const successor = trySecession(ctx, community);
    expect(successor).not.toBeNull();
    expect(successor!.identityId).toBe("roman");
    expect(successor!.parentTribeId).toBe(romani.id);
    expect(successor!.name).toBe("Romani del Sud");
    const event = ctx.events.find((e) => e.subtype === "secession");
    expect(event?.metadata.identityId).toBe("roman");
    expect(checkIdentityLineage(state)).toEqual([]);
  });

  it("un popolo assorbito lascia la scena con un evento e la sua identità vive nell'ospite", () => {
    const state = historicalWorld("assorbimento");
    const maya = byIdentity(state, "maya");
    const inca = byIdentity(state, "inca");
    // The last Maya live next to the Inca and choose to join them.
    const survivors = members(state, maya).slice(0, 4);
    state.people = state.people.filter((p) => p.tribeId !== maya.id || survivors.includes(p));
    maya.leaderId = survivors[0]!.id;
    maya.x = inca.x;
    maya.y = inca.y;
    for (const p of survivors) {
      p.x = inca.x;
      p.y = inca.y;
      p.action = "join_group";
    }
    const ctx = contextWithCommunities(state);
    expect(joinNearbyGroup(ctx, maya, survivors, new Map())).toBe(true);
    expect(maya.status).toBe("extinct");
    expect(maya.absorbedByTribeId).toBe(inca.id);
    expect(inca.absorbedIdentityIds).toContain("maya");
    expect(inca.identityId).toBe("inca");
    const event = ctx.events.find((e) => e.subtype === "absorption");
    expect(event?.metadata).toMatchObject({ absorbedIdentityId: "maya", hostIdentityId: "inca" });
  });

  it("la conquista conserva l'identità dei vinti sotto il nuovo governo, senza duplicati", () => {
    const state = historicalWorld();
    const romani = byIdentity(state, "roman");
    const maya = byIdentity(state, "maya");
    maya.absorbedIdentityIds.push("inca");
    recordAbsorbedIdentity(romani, maya);
    recordAbsorbedIdentity(romani, maya);
    expect(romani.absorbedIdentityIds).toEqual(["maya", "inca"]);
    expect(romani.identityId).toBe("roman");
  });

  it("lo stato di un popolo storico eredita l'identità e cambia forma col governo, con eventi", () => {
    const state = historicalWorld("stato");
    const egizi = byIdentity(state, "egyptian");
    inflate(state, egizi, 90);
    const ctx = contextWithCommunities(state);
    const a = createSettlement(ctx, egizi, egizi.x, egizi.y);
    createSettlement(ctx, egizi, Math.min(state.width - 1, egizi.x + 3), egizi.y);
    a.population = 80;
    checkCivilization(ctx, egizi, members(state, egizi).length);
    const civ = state.civilizations[0]!;
    expect(civ.identityId).toBe("egyptian");
    expect(civ.name).toBe(`Confederazione di ${a.name}`);
    expect(egizi.name).toBe("Egizi");

    egizi.government = "tribal_monarchy";
    updateCivilizationForm(ctx, civ);
    expect(civ.name).toBe(`Regno di ${a.name}`);
    expect(civ.formerNames).toEqual([`Confederazione di ${a.name}`]);
    expect(civ.identityId).toBe("egyptian");
    const transformed = ctx.events.find(
      (e) => e.type === "civilization_transformed" && e.subtype === "government",
    );
    expect(transformed?.metadata.previousName).toBe(`Confederazione di ${a.name}`);
    // Same government again: no new name, no new event.
    const before = ctx.events.length;
    updateCivilizationForm(ctx, civ);
    expect(ctx.events.length).toBe(before);

    civ.status = "collapsed";
    recordCivilizationCollapse(ctx, civ);
    const collapse = ctx.events.find((e) => e.subtype === "collapse");
    expect(collapse?.title).toBe(`Crolla Regno di ${a.name}`);
    expect(collapse?.description).toContain("Gli Egizi sopravvivono");
  });

  it("un'identità comparsa dal nulla viola le invarianti (nessuna ricreazione silenziosa)", () => {
    const state = historicalWorld();
    const egizi = byIdentity(state, "egyptian");
    const { id, seq } = nextId(state, "tribe", "t");
    state.tribes.push({ ...structuredClone(egizi), id, seq, name: "Egizi redivivi", parentTribeId: null });
    expect(checkIdentityLineage(state).join("\n")).toMatch(/non discende dal roster/);
  });

  it("una civiltà scomparsa non ricompare: le tribù estinte restano estinte", () => {
    const state = createWorld({
      seed: "estinzioni",
      width: 48,
      height: 48,
      roster: { mode: "random-real", civilizationCount: 8 },
    });
    const extinct = new Set<string>();
    for (let tick = 0; tick < 150; tick++) {
      const result = runSimulation(state, 1);
      for (const t of state.tribes) {
        if (extinct.has(t.id)) expect(t.status, `${t.name} ricomparsa`).toBe("extinct");
        if (t.status === "extinct" && !extinct.has(t.id)) {
          extinct.add(t.id);
          // The end of a people is always told by an event of that very tick.
          const told = result.events.some(
            (e) =>
              e.actors.some((a) => a.id === t.id) &&
              (e.type === "tribe_extinct" || (e.type === "migration" && e.subtype === "absorption")),
          );
          expect(told, `${t.name} scomparsa senza evento`).toBe(true);
        }
      }
    }
    // The scenario must actually lose someone, or the check above proves nothing.
    expect(extinct.size).toBeGreaterThan(0);
    expect(checkIdentityLineage(state)).toEqual([]);
  });

  it("la successione dei leader è deterministica", () => {
    const run = () => {
      const s = historicalWorld("successione");
      const r = runSimulation(s, 150);
      return r.events.filter((e) => e.type === "leadership").map((e) => `${e.year}:${e.title}`);
    };
    expect(run()).toEqual(run());
  });

  it("gli articoli si accordano con i nomi reali negli eventi", () => {
    expect(fixArticles("I Egizi migrano verso i Romani", ["Egizi", "Romani"])).toBe(
      "Gli Egizi migrano verso i Romani",
    );
    expect(fixArticles("la forza dei Inca e ai Assiri", ["Inca", "Assiri"])).toBe(
      "la forza degli Inca e agli Assiri",
    );
    expect(fixArticles("Dai Egizi del Nord", ["Egizi del Nord"])).toBe("Dagli Egizi del Nord");
  });
});

describe("mondi legacy", () => {
  /** A state as written before identities existed: no identity fields, no roster. */
  function legacySnapshot(): string {
    const state = createWorld({ seed: "legacy-identita" });
    runSimulation(state, 30);
    const raw = JSON.parse(serializeWorld(state)) as { state: Record<string, unknown> };
    delete raw.state.roster;
    for (const t of raw.state.tribes as Record<string, unknown>[]) {
      delete t.identityId;
      delete t.identityType;
      delete t.absorbedIdentityIds;
      delete t.absorbedByTribeId;
    }
    for (const c of raw.state.civilizations as Record<string, unknown>[]) {
      delete c.identityId;
      delete c.identityType;
      delete c.politicalStem;
      delete c.formerNames;
    }
    return JSON.stringify({ version: STATE_VERSION, state: raw.state });
  }

  it("le civiltà inventate restano legacy, senza rinomine né identità assegnate", () => {
    const loaded = deserializeState(JSON.parse(legacySnapshot()));
    expect(loaded.roster).toBeNull();
    for (const t of loaded.tribes) {
      expect(t.identityType).toBe("legacy");
      expect(t.identityId).toBeNull();
      expect(t.absorbedIdentityIds).toEqual([]);
    }
    const names = loaded.tribes.map((t) => t.name);
    runSimulation(loaded, 60, { checkInvariants: true });
    // Existing peoples keep their names; newcomers (splits) are legacy too.
    expect(loaded.tribes.slice(0, names.length).map((t) => t.name)).toEqual(names);
    expect(loaded.tribes.every((t) => t.identityType === "legacy" && t.identityId === null)).toBe(true);
    expect(loaded.civilizations.every((c) => c.identityType === "legacy")).toBe(true);
  });

  it("caricare un mondo legacy è deterministico e non consuma casualità in più", () => {
    const a = deserializeState(JSON.parse(legacySnapshot()));
    const b = deserializeState(JSON.parse(legacySnapshot()));
    const c = cloneWorld(a);
    runSimulation(a, 40);
    runSimulation(b, 40);
    runSimulation(c, 40);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(hashWorld(a)).toBe(hashWorld(c));
  });
});
