import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_FORGET,
  MAX_ESTIMATE_ERROR,
  ageKnowledge,
  createWorld,
  emptyKnowledge,
  estimate,
  refreshKnowledge,
  runSimulation,
  spyEffort,
  spySuccessChance,
  viewOf,
  wantsToSpy,
  type ContactChannels,
  type KnowledgeTruth,
  type Relationship,
} from "../src/index";
import { world } from "./helpers";

const truth = (overrides: Partial<KnowledgeTruth> = {}): KnowledgeTruth => ({
  population: 200,
  military: 50,
  stability: 0.7,
  x: 10,
  y: 12,
  visibleTechnologies: ["fire", "stone_tools"],
  hostile: false,
  ...overrides,
});

const channels = (overrides: Partial<ContactChannels> = {}): ContactChannels => ({
  contact: true,
  distance: 5,
  trade: false,
  diplomats: false,
  battle: false,
  ...overrides,
});

describe("stime", () => {
  it("a piena fiducia sono esatte, e l'errore cresce al calare della fiducia", () => {
    expect(estimate("s", "a", "b", "population", 0, 100, 1)).toBe(100);
    const errorAt = (confidence: number) => {
      let worst = 0;
      for (let year = 0; year < 200; year++) {
        const value = estimate("s", "a", "b", "population", year, 100, confidence);
        worst = Math.max(worst, Math.abs(value - 100) / 100);
      }
      return worst;
    };
    expect(errorAt(0.9)).toBeLessThan(errorAt(0.2));
    expect(errorAt(0)).toBeLessThanOrEqual(MAX_ESTIMATE_ERROR + 1e-9);
  });

  it("sono deterministiche e non consumano il generatore della simulazione", () => {
    const a = estimate("seme", "t1", "t2", "military", 42, 80, 0.4);
    const b = estimate("seme", "t1", "t2", "military", 42, 80, 0.4);
    expect(a).toBe(b);
    // Different pairs are wrong in different ways.
    expect(estimate("seme", "t2", "t1", "military", 42, 80, 0.4)).not.toBe(a);
  });

  it("non sono mai negative", () => {
    for (let year = 0; year < 100; year++) {
      expect(estimate("s", "a", "b", "x", year, 10, 0, -1)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("da dove arriva la conoscenza", () => {
  it("il solo contatto dice dove vivono e più o meno quanti sono", () => {
    const state = world("contatto");
    const k = emptyKnowledge("t1", "t2", 0);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels(), 0);
    expect(k.location).toEqual({ x: 10, y: 12, year: 0 });
    expect(k.population).not.toBeNull();
    expect(k.population!.source).toBe("exploration");
    expect(k.population!.confidence).toBeLessThan(0.6);
    // Nothing that contact alone cannot reveal.
    expect(k.military).toBeNull();
    expect(k.technologies).toBeNull();
    expect(k.intent).toBeNull();
  });

  it("i mercanti vedono le tecnologie in uso, gli ambasciatori le intenzioni, la battaglia l'esercito", () => {
    const state = world("canali");
    const k = emptyKnowledge("t1", "t2", 0);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ trade: true }), 0);
    expect(k.technologies?.ids).toEqual(["fire", "stone_tools"]);
    expect(k.technologies?.source).toBe("trade");

    refreshKnowledge(
      state.seed,
      k,
      state.tribes[0]!,
      truth({ hostile: true }),
      channels({ diplomats: true }),
      1,
    );
    expect(k.intent).toMatchObject({ hostile: true, source: "diplomat" });

    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ battle: true }), 2);
    expect(k.military?.source).toBe("battle");
    expect(k.military!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("una stima più affidabile non viene sostituita da una più vaga", () => {
    const state = world("sostituzione");
    const k = emptyKnowledge("t1", "t2", 0);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ trade: true }), 0);
    const merchant = k.population!;
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ distance: 13 }), 0);
    expect(k.population).toEqual(merchant);
  });
});

describe("oblio", () => {
  it("una stima non rinfrescata perde fiducia e alla fine sparisce", () => {
    const state = world("oblio");
    const k = emptyKnowledge("t1", "t2", 0);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ trade: true, battle: true }), 0);
    const start = k.military!.confidence;
    ageKnowledge(k, 1);
    expect(k.military!.confidence).toBeLessThan(start);
    for (let year = 2; year < 200; year++) ageKnowledge(k, year);
    expect(k.military).toBeNull();
    expect(k.population).toBeNull();
    expect(k.technologies).toBeNull();
    // Where they were last seen is kept: a last known position is not forgotten.
    expect(k.location).not.toBeNull();
  });

  it("ciò che è ricordato a metà diventa voce", () => {
    const state = world("voci");
    const k = emptyKnowledge("t1", "t2", 0);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ trade: true }), 0);
    let year = 1;
    while (k.population && k.population.confidence >= 0.2) ageKnowledge(k, year++);
    if (k.population) {
      expect(k.population.source).toBe("rumor");
      expect(k.population.confidence).toBeGreaterThanOrEqual(KNOWLEDGE_FORGET);
    }
  });

  it("un'informazione di quest'anno non invecchia nello stesso anno", () => {
    const state = world("stesso-anno");
    const k = emptyKnowledge("t1", "t2", 5);
    refreshKnowledge(state.seed, k, state.tribes[0]!, truth(), channels({ trade: true }), 5);
    const before = k.population!.confidence;
    ageKnowledge(k, 5);
    expect(k.population!.confidence).toBe(before);
  });
});

describe("spionaggio", () => {
  const rel = (overrides: Partial<Relationship> = {}) =>
    ({ atWar: false, hostility: 0.1, phase: "peace", ...overrides }) as Relationship;

  it("si spia chi si teme, non chi è amico", () => {
    const state = world("spie");
    const tribe = state.tribes[0]!;
    expect(wantsToSpy(tribe, rel())).toBe(false);
    expect(wantsToSpy(tribe, rel({ hostility: 0.6 }))).toBe(true);
    expect(wantsToSpy(tribe, rel({ atWar: true }))).toBe(true);
    expect(wantsToSpy(tribe, rel({ phase: "threat" }))).toBe(true);
  });

  it("un apparato gerarchico spia meglio, un bersaglio ordinato si difende meglio", () => {
    const state = world("apparati");
    const [a, b] = [structuredClone(state.tribes[0]!), structuredClone(state.tribes[1]!)];
    a.culture = { ...a.culture, hierarchy: 90, administrativeCapacity: 90 };
    b.stability = { ...b.stability, order: 0.1 };
    const easy = spySuccessChance(a, b);
    a.culture = { ...a.culture, hierarchy: 10, administrativeCapacity: 10 };
    b.stability = { ...b.stability, order: 0.95 };
    const hard = spySuccessChance(a, b);
    expect(easy).toBeGreaterThan(hard);
    for (const chance of [easy, hard]) {
      expect(chance).toBeGreaterThanOrEqual(0.05);
      expect(chance).toBeLessThanOrEqual(0.9);
    }
    expect(spyEffort(a)).toBeLessThan(0.05);
  });
});

describe("conoscenza in simulazione", () => {
  it("ogni record è coerente, datato e mai più preciso di quanto dichiara", () => {
    const state = createWorld({ seed: "conoscenza-mondo", width: 64, height: 64 });
    runSimulation(state, 400);
    expect(state.knowledge.length).toBeGreaterThan(0);
    const ids = new Set(state.tribes.map((t) => t.id));
    const keys = new Set<string>();
    for (const k of state.knowledge) {
      expect(ids.has(k.observerId)).toBe(true);
      expect(ids.has(k.targetId)).toBe(true);
      expect(k.observerId).not.toBe(k.targetId);
      const key = `${k.observerId}>${k.targetId}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      expect(k.spiesCaught).toBeLessThanOrEqual(k.spyAttempts);
      for (const e of [k.population, k.military, k.stability]) {
        if (!e) continue;
        expect(e.confidence).toBeGreaterThanOrEqual(KNOWLEDGE_FORGET);
        expect(e.confidence).toBeLessThanOrEqual(1);
        expect(e.value).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(e.value)).toBe(true);
        expect(e.year).toBeLessThanOrEqual(state.year);
      }
    }
  });

  it("la vista di un osservatore contiene solo ciò che il suo record dice", () => {
    const state = createWorld({ seed: "vista", width: 64, height: 64 });
    runSimulation(state, 300);
    const k = state.knowledge.find((x) => x.population !== null);
    expect(k).toBeDefined();
    const view = viewOf(k!, state.year);
    expect(view.population).toEqual(k!.population);
    expect(view.targetId).toBe(k!.targetId);
    // The view is a copy: editing it cannot touch the record.
    view.population!.value = -1;
    expect(k!.population!.value).not.toBe(-1);
    // And it has no field that could carry the target's real state.
    expect(Object.keys(view).sort()).toEqual(
      [
        "intent",
        "lastSeen",
        "military",
        "population",
        "stability",
        "staleness",
        "targetId",
        "technologies",
      ].sort(),
    );
  });

  it("stesso seme, stessa conoscenza", () => {
    const run = () => {
      const s = createWorld({ seed: "conoscenza-determinismo", width: 48, height: 48 });
      runSimulation(s, 200);
      return JSON.stringify(s.knowledge);
    };
    expect(run()).toBe(run());
  });
});

describe("decisioni prese su ciò che si crede", () => {
  it("la forza percepita segue la stima militare, poi quella della popolazione, poi la parità", async () => {
    const { perceivedPower } = await import("../src/index");
    const { createContext } = await import("../src/simulation-engine");
    const state = world("percezione");
    const ctx = createContext(state);
    const [a, b] = state.tribes;
    const observer = { tribe: a!, power: 40, population: 20 };
    const target = { tribe: b! };
    // Knowing nothing, a prudent people assumes an equal.
    expect(perceivedPower(ctx, observer, target)).toBe(40);

    state.tick += 1;
    const k = emptyKnowledge(a!.id, b!.id, state.year);
    k.population = { value: 30, confidence: 0.4, year: state.year, source: "exploration" };
    state.knowledge.push(k);
    // Only a head count: assumed as strong per head as the observer itself.
    expect(perceivedPower(ctx, observer, target)).toBe(60);

    state.tick += 1;
    k.military = { value: 25, confidence: 0.8, year: state.year, source: "spy" };
    expect(perceivedPower(ctx, observer, target)).toBe(25);
  });

  it("ogni dichiarazione di guerra dichiara se il nemico è stato sopravvalutato o sottovalutato", () => {
    const state = createWorld({ seed: "stime-in-guerra", width: 56, height: 56 });
    const result = runSimulation(state, 300);
    const wars = result.events.filter((e) => e.subtype === "war_declared");
    expect(wars.length).toBeGreaterThan(0);
    for (const war of wars) {
      const perceived = Number(war.metadata.advantage);
      const real = Number(war.metadata.realAdvantage);
      expect(Number.isFinite(perceived)).toBe(true);
      expect(Number.isFinite(real)).toBe(true);
      expect(war.metadata.misjudged).toBe(perceived > real * 1.3);
      if (war.metadata.misjudged) expect(war.description).toContain("stima del nemico");
    }
  });
});
