import { describe, expect, it } from "vitest";
import {
  createWorld,
  deserializeState,
  runSimulation,
  serializeWorld,
  TECH_BY_ID,
  TECHNOLOGIES,
  type WorldState,
} from "../src/index";
import {
  allocateResearch,
  canBeLost,
  decayTechnologies,
  grantTech,
  knowledgeStrain,
  researchAptitude,
  researchBudget,
  researchWeight,
  shareKnowledge,
  techAffinity,
  techNeeds,
  techStatus,
  tribeEffects,
  type ResearchBudgetInput,
  type TechConditionInput,
} from "../src/technology";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

function conditionInput(state: WorldState, overrides: Partial<TechConditionInput> = {}): TechConditionInput {
  const tribe = state.tribes[0]!;
  const area = state.cells.filter((c) => c.biome !== "ocean").slice(0, 25);
  return {
    tribe,
    population: 120,
    settled: true,
    settlements: 2,
    maxSettlementLevel: 3,
    area,
    maxHostility: 0.2,
    conflictMemory: 0.1,
    tradePartners: 1,
    culture: tribe.culture,
    foodRatio: 1,
    order: 0.8,
    ...overrides,
  };
}

const budget = (overrides: Partial<ResearchBudgetInput> = {}): ResearchBudgetInput => ({
  knowledge: 18,
  surplus: 1.2,
  innovationMultiplier: 1,
  leaderSupport: 1.1,
  culturalDrive: 1,
  stability: 0.9,
  urbanKnowledge: 1,
  externalContact: 1,
  ...overrides,
});

describe("parità iniziale", () => {
  it("ogni popolo parte dalle stesse tecnologie, qualunque sia l'identità storica", () => {
    const state = createWorld({
      seed: "parita",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["egyptian", "roman", "sumerian", "phoenician"] },
    });
    const sets = state.tribes.map((t) => [...t.techs].sort().join(","));
    expect(new Set(sets).size).toBe(1);
    // ...and nobody starts with the technology their real-world name would suggest.
    const byIdentity = (key: string) => state.tribes.find((t) => t.identityId === key)!;
    expect(byIdentity("egyptian").techs).not.toContain("agriculture");
    expect(byIdentity("sumerian").techs).not.toContain("writing");
    expect(byIdentity("roman").techs).not.toContain("advanced_construction");
    expect(byIdentity("phoenician").techs).not.toContain("long_distance_trade");
  });

  it("l'inclinazione alla ricerca dipende dal seme e dal popolo, non dall'identità storica", () => {
    const state = createWorld({
      seed: "inclinazioni",
      width: 48,
      height: 48,
      roster: { mode: "selected", identityKeys: ["egyptian", "roman"] },
    });
    const egizi = state.tribes.find((t) => t.identityId === "egyptian")!;
    const romani = state.tribes.find((t) => t.identityId === "roman")!;
    // Same id, same world: same aptitude, whichever people carries that id.
    expect(researchAptitude(state.seed, egizi.id, "metals")).toBe(
      researchAptitude(state.seed, egizi.id, "metals"),
    );
    expect(researchAptitude(state.seed, egizi.id, "metals")).not.toBe(
      researchAptitude(state.seed, romani.id, "metals"),
    );
    // A different world draws different inclinations for the same people.
    expect(researchAptitude("altro-mondo", egizi.id, "metals")).not.toBe(
      researchAptitude(state.seed, egizi.id, "metals"),
    );
    for (const category of ["survival", "neolithic", "metals", "organization"] as const) {
      const value = researchAptitude(state.seed, egizi.id, category);
      expect(value).toBeGreaterThanOrEqual(0.55);
      expect(value).toBeLessThanOrEqual(1.65);
    }
  });
});

describe("budget e allocazione della ricerca", () => {
  it("ogni contributo del budget è monotono e spiegabile", () => {
    const base = researchBudget(budget());
    expect(base).toBeGreaterThan(0);
    expect(researchBudget(budget({ knowledge: 36 }))).toBeGreaterThan(base);
    expect(researchBudget(budget({ surplus: 0.4 }))).toBeLessThan(base);
    expect(researchBudget(budget({ stability: 0.6 }))).toBeLessThan(base);
    expect(researchBudget(budget({ urbanKnowledge: 1.5 }))).toBeGreaterThan(base);
    expect(researchBudget(budget({ externalContact: 1.3 }))).toBeGreaterThan(base);
    // A starving group researches almost nothing.
    expect(researchBudget(budget({ surplus: 0 }))).toBe(0);
  });

  it("il budget si concentra su ciò che serve e che la terra favorisce", () => {
    const state = world("allocazione");
    const input = conditionInput(state);
    const candidates = [TECH_BY_ID.get("agriculture")!, TECH_BY_ID.get("military_org")!];
    const shares = allocateResearch(
      candidates,
      { ...input, maxHostility: 0.9, conflictMemory: 0.8 },
      10,
      () => 1,
      () => 0,
      () => false,
    );
    const total = shares.reduce((acc, s) => acc + s.share, 0);
    expect(total).toBeCloseTo(1, 5);
    const military = shares.find((s) => s.techId === "military_org")!;
    const agriculture = shares.find((s) => s.techId === "agriculture")!;
    // Under threat, warriors get the attention that would otherwise go to the fields.
    expect(military.share).toBeGreaterThan(agriculture.share);

    const peaceful = allocateResearch(
      candidates,
      { ...input, maxHostility: 0, conflictMemory: 0, foodRatio: 0.6 },
      10,
      () => 1,
      () => 0,
      () => false,
    );
    expect(peaceful.find((s) => s.techId === "agriculture")!.share).toBeGreaterThan(
      peaceful.find((s) => s.techId === "military_org")!.share,
    );
  });

  it("l'allocazione è deterministica e non distribuisce nulla senza candidati", () => {
    const state = world("determinismo-alloc");
    const input = conditionInput(state);
    const run = () =>
      allocateResearch(
        [TECH_BY_ID.get("agriculture")!, TECH_BY_ID.get("pottery")!],
        input,
        7,
        (t) => researchAptitude(state.seed, input.tribe.id, t.category),
        () => 0,
        () => false,
      );
    expect(run()).toEqual(run());
    expect(
      allocateResearch(
        [],
        input,
        7,
        () => 1,
        () => 0,
        () => false,
      ),
    ).toEqual([]);
  });

  it("la terra decide l'affinità: stessa tecnologia, popoli diversi, ritmi diversi", () => {
    const state = world("affinita");
    const fishing = TECH_BY_ID.get("fishing")!;
    const coastal = conditionInput(state, {
      area: state.cells.slice(0, 20).map((c) => ({ ...c, coastal: true, river: false })),
    });
    const inland = conditionInput(state, {
      area: state.cells.slice(0, 20).map((c) => ({ ...c, coastal: false, river: false })),
    });
    expect(techAffinity(fishing, coastal)).toBeGreaterThan(techAffinity(fishing, inland));

    const copperTech = TECH_BY_ID.get("copper_working")!;
    const rich = conditionInput(state, {
      area: state.cells.slice(0, 20).map((c) => ({ ...c, copper: 8 })),
    });
    const barren = conditionInput(state, {
      area: state.cells.slice(0, 20).map((c) => ({ ...c, copper: 0 })),
    });
    expect(techAffinity(copperTech, rich)).toBeGreaterThan(techAffinity(copperTech, barren));
    expect(researchWeight(copperTech, rich, 1)).toBeGreaterThan(researchWeight(copperTech, barren, 1));
  });

  it("i bisogni riflettono la situazione reale del gruppo", () => {
    const state = world("bisogni");
    const hungry = techNeeds(conditionInput(state, { foodRatio: 0.5 }));
    const fed = techNeeds(conditionInput(state, { foodRatio: 1 }));
    expect(hungry.food).toBeGreaterThan(fed.food);
    const threatened = techNeeds(conditionInput(state, { maxHostility: 0.9 }));
    expect(threatened.war).toBeGreaterThan(fed.war);
    for (const value of Object.values(hungry)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("una tecnologia scoperta resta locale", () => {
  it("scoprire una tecnologia non la sblocca per gli altri popoli", () => {
    const state = world("localita");
    const ctx = createContext(state);
    const [first, ...others] = state.tribes;
    expect(grantTech(ctx, first!, "fire", "invention")).toBe(true);
    expect(first!.techs).toContain("fire");
    for (const other of others) expect(other.techs).not.toContain("fire");
    // The catalog is global, the state is not.
    expect(TECHNOLOGIES.some((t) => t.id === "fire")).toBe(true);
    expect(techStatus(others[0]!, "fire")).not.toBe("adopted");
  });

  it("in una simulazione lunga i popoli seguono percorsi diversi", () => {
    const state = createWorld({ seed: "percorsi", width: 64, height: 64 });
    runSimulation(state, 400);
    const alive = state.tribes.filter((t) => t.status !== "extinct");
    expect(alive.length).toBeGreaterThan(2);
    const sets = new Set(alive.map((t) => [...t.techs].sort().join(",")));
    // Not everybody knows the same things...
    expect(sets.size).toBeGreaterThan(1);
    // ...and not everybody learned them in the same order.
    const orders = new Set(alive.map((t) => t.techs.join(">")));
    expect(orders.size).toBeGreaterThan(1);
    const counts = alive.map((t) => t.techs.length);
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts));
  });

  it("ogni tecnologia posseduta ha una fonte registrata da un evento", () => {
    const state = createWorld({ seed: "fonti", width: 48, height: 48 });
    const result = runSimulation(state, 300);
    const discoveries = result.events.filter((e) => e.type === "tech_discovered");
    expect(discoveries.length).toBeGreaterThan(0);
    for (const e of discoveries) {
      if (e.subtype === "adopted" || e.subtype === "lost") continue;
      expect(typeof e.metadata.techId).toBe("string");
      expect(["invention", "diffusion", "conquest", "migration", "rediscovery"]).toContain(e.subtype);
      // Knowledge that came from outside always names where it came from.
      if (e.subtype === "diffusion") expect(e.metadata.sourceTribeId).not.toBeNull();
    }
  });
});

describe("diffusione", () => {
  it("il contatto accelera la ricerca ma non aggira i prerequisiti", () => {
    const state = world("diffusione");
    const ctx = createContext(state);
    const [from, to] = state.tribes;
    grantTech(ctx, from!, "fire", "invention");
    grantTech(ctx, from!, "stone_tools", "invention");
    from!.techAdoption.fire = 1;
    from!.techAdoption.stone_tools = 1;
    grantTech(ctx, from!, "food_preservation", "invention");
    from!.techAdoption.food_preservation = 1;
    // The receiver lacks `fire`, the prerequisite of food preservation.
    shareKnowledge(ctx, from!, to!, 0.5);
    expect(to!.techs).not.toContain("food_preservation");
    expect(to!.techProgress.food_preservation ?? 0).toBe(0);
    // With the prerequisites in hand, contact makes the work faster.
    grantTech(ctx, to!, "fire", "invention");
    grantTech(ctx, to!, "stone_tools", "invention");
    shareKnowledge(ctx, from!, to!, 0.5);
    expect(to!.techProgress.food_preservation ?? 0).toBeGreaterThan(0);
  });

  it("una tecnologia che la fonte non usa davvero non si trasmette", () => {
    const state = world("diffusione-adozione");
    const ctx = createContext(state);
    const [from, to] = state.tribes;
    grantTech(ctx, from!, "fire", "invention");
    grantTech(ctx, to!, "fire", "invention");
    grantTech(ctx, from!, "food_preservation", "invention");
    from!.techAdoption.food_preservation = 0.1;
    shareKnowledge(ctx, from!, to!, 0.5);
    expect(to!.techProgress.food_preservation ?? 0).toBe(0);
  });

  it("un popolo chiuso assorbe meno di uno aperto", () => {
    const state = world("apertura");
    const ctx = createContext(state);
    const [from, open, closed] = state.tribes;
    for (const t of [from!, open!, closed!]) grantTech(ctx, t, "fire", "invention");
    grantTech(ctx, from!, "food_preservation", "invention");
    from!.techAdoption.food_preservation = 1;
    open!.culture = { ...open!.culture, tradeOpenness: 90, traditionalism: 10 };
    closed!.culture = { ...closed!.culture, tradeOpenness: 10, traditionalism: 90 };
    shareKnowledge(ctx, from!, open!, 0.3);
    shareKnowledge(ctx, from!, closed!, 0.3);
    expect(open!.techProgress.food_preservation!).toBeGreaterThan(closed!.techProgress.food_preservation!);
  });
});

describe("adozione", () => {
  it("gli effetti scalano con il livello di adozione", () => {
    const state = world("adozione");
    const tribe = state.tribes[0]!;
    tribe.techs = ["fire"];
    tribe.techAdoption = { fire: 1 };
    const full = tribeEffects(tribe).mortalityMultiplier;
    tribe.techAdoption = { fire: 0.2 };
    const partial = tribeEffects(tribe).mortalityMultiplier;
    // fire lowers mortality: full adoption must help more than partial.
    expect(full).toBeLessThan(partial);
    expect(partial).toBeLessThan(1);
  });

  it("la conoscenza ricevuta parte da un'adozione bassa, l'invenzione da una più alta", () => {
    const state = world("fonte-adozione");
    const ctx = createContext(state);
    const [a, b, c] = state.tribes;
    grantTech(ctx, a!, "fire", "invention");
    grantTech(ctx, b!, "fire", "diffusion", a!);
    grantTech(ctx, c!, "fire", "conquest", a!);
    expect(a!.techAdoption.fire!).toBeGreaterThan(b!.techAdoption.fire!);
    expect(b!.techAdoption.fire!).toBeGreaterThan(c!.techAdoption.fire!);
  });
});

describe("perdita e riscoperta", () => {
  it("un popolo sano non perde nulla", () => {
    const state = world("nessuna-perdita");
    const input = conditionInput(state, { population: 400, settled: true, order: 0.85 });
    for (const tech of TECHNOLOGIES) expect(knowledgeStrain(tech, input)).toBe(0);
  });

  it("un popolo che crolla non riesce più a tramandare ciò che sapeva", () => {
    const state = world("perdita");
    const pottery = TECH_BY_ID.get("pottery")!;
    const collapsed = conditionInput(state, { population: 4, settled: false, settlements: 0, order: 0.2 });
    expect(knowledgeStrain(pottery, collapsed)).toBeGreaterThan(0);
    expect(canBeLost(pottery)).toBe(true);
    // Techniques every generation rediscovers by living are never wholly lost.
    expect(canBeLost(TECH_BY_ID.get("fire")!)).toBe(false);
  });

  it("l'adozione scende gradualmente e solo alla fine la tecnica è perduta", () => {
    const state = world("decadimento");
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    grantTech(ctx, tribe, "fire", "invention");
    grantTech(ctx, tribe, "food_preservation", "invention");
    tribe.techAdoption.food_preservation = 1;
    const input = conditionInput(state, { tribe, population: 2, settled: false, settlements: 0, order: 0.1 });
    const seen: number[] = [];
    let years = 0;
    while (tribe.techs.includes("food_preservation") && years < 500) {
      decayTechnologies(ctx, tribe, input);
      seen.push(tribe.techAdoption.food_preservation ?? 0);
      years++;
    }
    expect(years).toBeGreaterThan(3);
    expect(tribe.techs).not.toContain("food_preservation");
    expect(tribe.techLost.food_preservation).toBe(state.year);
    expect(techStatus(tribe, "food_preservation")).toBe("lost");
    // Monotone decline, never a jump straight to zero.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
    const lost = ctx.events.find((e) => e.subtype === "lost");
    expect(lost?.metadata.techId).toBe("food_preservation");
  });

  it("riscoprire una tecnica perduta è più rapido che scoprirla la prima volta", () => {
    const state = world("riscoperta");
    const input = conditionInput(state);
    const tech = TECH_BY_ID.get("agriculture")!;
    const fresh = allocateResearch(
      [tech],
      input,
      10,
      () => 1,
      () => 0,
      () => false,
    )[0]!;
    const relearned = allocateResearch(
      [tech],
      input,
      10,
      () => 1,
      () => 0,
      () => true,
    )[0]!;
    expect(relearned.gain).toBeGreaterThan(fresh.gain);
    expect(relearned.rediscovery).toBe(true);
  });

  it("una tecnica ritrovata torna in uso con un evento dedicato", () => {
    const state = world("ritrovata");
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    tribe.techLost.fire = state.year - 40;
    expect(grantTech(ctx, tribe, "fire", "invention")).toBe(true);
    expect(tribe.techLost.fire).toBeUndefined();
    const event = ctx.events.find((e) => e.subtype === "rediscovery");
    expect(event?.metadata.rediscovery).toBe(true);
    expect(event?.metadata.lostYear).toBe(state.year - 40);
    expect(event?.description).toContain("ritrovato");
  });
});

describe("compatibilità e determinismo", () => {
  it("un mondo salvato prima del registro delle perdite si carica e prosegue", () => {
    const original = world("legacy-tech");
    const payload = JSON.parse(serializeWorld(original)) as {
      version: number;
      state: { tribes: Record<string, unknown>[] };
    };
    // Strip the field exactly as a world saved before this milestone would not have it.
    for (const tribe of payload.state.tribes) delete tribe.techLost;
    const restored = deserializeState(payload as never);
    for (const tribe of restored.tribes) expect(tribe.techLost).toEqual({});
    expect(() => runSimulation(restored, 20)).not.toThrow();
    // ...and the technologies it already had are untouched: nothing is unlocked retroactively.
    expect(restored.tribes[0]!.techs).toEqual(original.tribes[0]!.techs);
  });

  it("stesso seme, stessa storia tecnologica", () => {
    const run = () => {
      const s = createWorld({ seed: "tech-determinismo", width: 48, height: 48 });
      const r = runSimulation(s, 200);
      return r.events
        .filter((e) => e.type === "tech_discovered")
        .map((e) => `${e.year}|${e.subtype}|${e.metadata.techId}|${e.actors[0]?.id}`);
    };
    expect(run()).toEqual(run());
  });
});
