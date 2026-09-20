import { describe, expect, it } from "vitest";
import {
  CRISIS_RESPONSE_LABELS,
  chooseCrisisResponse,
  computeResilience,
  createWorld,
  overallResilience,
  rankCrisisResponses,
  resilienceInputOf,
  runSimulation,
  type CrisisSituation,
  type ResilienceProfile,
} from "../src/index";
import { buildCommunities, createContext } from "../src/simulation-engine";
import { contextWithCommunities, world } from "./helpers";

const situation = (overrides: Partial<CrisisSituation> = {}): CrisisSituation => ({
  severity: 0.5,
  friendlyNeighbours: 1,
  weakerNeighbour: false,
  ...overrides,
});

describe("profilo di resilienza", () => {
  it("ogni indicatore resta fra 0 e 1", () => {
    const state = world("resilienza", 64);
    const ctx = contextWithCommunities(state);
    for (const tribe of state.tribes) {
      const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
      const profile = computeResilience(tribe, resilienceInputOf(ctx, tribe, comms), 0);
      for (const [key, value] of Object.entries(profile)) {
        if (key === "updatedAtTick") continue;
        expect(value, key).toBeGreaterThanOrEqual(0);
        expect(value, key).toBeLessThanOrEqual(1);
      }
      const overall = overallResilience(profile);
      expect(overall).toBeGreaterThanOrEqual(0);
      expect(overall).toBeLessThanOrEqual(1);
    }
  });

  it("è ricalcolato, non ricordato: stesso stato, stesso profilo", () => {
    const state = world("ricalcolo", 64);
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    const input = resilienceInputOf(ctx, tribe, comms);
    const a = computeResilience(tribe, input, 5);
    const b = computeResilience(tribe, input, 5);
    expect(a).toEqual(b);
  });

  it("le tecnologie contano solo per quanto sono davvero adottate", () => {
    const state = world("adozione-resilienza", 64);
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    const input = resilienceInputOf(ctx, tribe, comms);

    tribe.techs = [];
    tribe.techAdoption = {};
    const without = computeResilience(tribe, input, 0).foodResilience;

    tribe.techs = ["food_preservation"];
    tribe.techAdoption = { food_preservation: 0.1 };
    const barely = computeResilience(tribe, input, 0).foodResilience;

    tribe.techAdoption = { food_preservation: 1 };
    const fully = computeResilience(tribe, input, 0).foodResilience;

    expect(barely).toBeGreaterThan(without);
    expect(fully).toBeGreaterThan(barely);
  });

  it("un popolo ordinato e coeso si rialza più in fretta di uno allo sbando", () => {
    const state = world("recupero", 64);
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    const input = resilienceInputOf(ctx, tribe, comms);

    tribe.stability = { ...tribe.stability, order: 0.9, cohesion: 0.9, corruption: 0 };
    tribe.culture = { ...tribe.culture, administrativeCapacity: 80, culturalCohesion: 80 };
    const solid = computeResilience(tribe, input, 0);

    tribe.stability = { ...tribe.stability, order: 0.1, cohesion: 0.1, corruption: 0.8 };
    tribe.culture = { ...tribe.culture, administrativeCapacity: 10, culturalCohesion: 10 };
    const broken = computeResilience(tribe, input, 0);

    expect(solid.recoverySpeed).toBeGreaterThan(broken.recoverySpeed);
    expect(solid.administrativeCapacity).toBeGreaterThan(broken.administrativeCapacity);
    expect(solid.socialCohesion).toBeGreaterThan(broken.socialCohesion);
    expect(overallResilience(solid)).toBeGreaterThan(overallResilience(broken));
  });
});

describe("risposta a una crisi", () => {
  const profile = (overrides: Partial<ResilienceProfile> = {}): ResilienceProfile => ({
    foodResilience: 0.5,
    economicDiversity: 0.5,
    administrativeCapacity: 0.5,
    socialCohesion: 0.5,
    reserveCapacity: 0.5,
    migrationCapacity: 0.3,
    infrastructureQuality: 0.4,
    recoverySpeed: 0.5,
    healthCapacity: 0.5,
    updatedAtTick: 0,
    ...overrides,
  });

  it("ogni risposta possibile ha un'etichetta e un motivo", () => {
    const state = world("risposte");
    const ranked = rankCrisisResponses(state.tribes[0]!, profile(), situation());
    expect(ranked.length).toBeGreaterThan(0);
    for (const option of ranked) {
      expect(CRISIS_RESPONSE_LABELS[option.response]).toBeTruthy();
      expect(option.reason).toBeTruthy();
      expect(option.score).toBeGreaterThanOrEqual(0);
      expect(option.score).toBeLessThanOrEqual(1);
    }
    // Ranked from most to least likely.
    const scores = ranked.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("la scelta dipende da quello che il popolo può davvero fare", () => {
    const state = world("scelte");
    const tribe = state.tribes[0]!;

    // Full granaries and officials to count them: it rations.
    tribe.culture = { ...tribe.culture, cooperation: 20, exploration: 10, expansionism: 10, militarism: 10 };
    const stocked = chooseCrisisResponse(
      tribe,
      profile({ reserveCapacity: 1, administrativeCapacity: 1, socialCohesion: 0.1, migrationCapacity: 0 }),
      situation({ friendlyNeighbours: 0 }),
    );
    expect(stocked.response).toBe("rationing");

    // Nothing stored, but somewhere to go: it leaves.
    tribe.culture = { ...tribe.culture, exploration: 90, cooperation: 10, expansionism: 10 };
    const mobile = chooseCrisisResponse(
      tribe,
      profile({ reserveCapacity: 0, administrativeCapacity: 0.1, socialCohesion: 0.1, migrationCapacity: 1 }),
      situation({ friendlyNeighbours: 0 }),
    );
    expect(mobile.response).toBe("migration");

    // Neighbours to trade with, and a people that values it.
    tribe.culture = {
      ...tribe.culture,
      tradeOpenness: 95,
      cooperation: 10,
      exploration: 10,
      expansionism: 10,
    };
    const trader = chooseCrisisResponse(
      tribe,
      profile({
        reserveCapacity: 0.1,
        administrativeCapacity: 0.1,
        socialCohesion: 0.1,
        migrationCapacity: 0.1,
      }),
      situation({ friendlyNeighbours: 3 }),
    );
    expect(trader.response).toBe("trade");
  });

  it("senza un vicino più debole la guerra non è mai una risposta alla fame", () => {
    const state = world("guerra-fame");
    const tribe = state.tribes[0]!;
    tribe.culture = { ...tribe.culture, militarism: 99 };
    const ranked = rankCrisisResponses(tribe, profile(), situation({ weakerNeighbour: false }));
    expect(ranked.find((o) => o.response === "war")!.score).toBe(0);
    const withTarget = rankCrisisResponses(
      tribe,
      profile({ foodResilience: 0 }),
      situation({ weakerNeighbour: true, severity: 1 }),
    );
    expect(withTarget.find((o) => o.response === "war")!.score).toBeGreaterThan(0);
  });

  it("la scelta è deterministica", () => {
    const state = world("determinismo-crisi");
    const tribe = state.tribes[0]!;
    const a = chooseCrisisResponse(tribe, profile(), situation());
    const b = chooseCrisisResponse(tribe, profile(), situation());
    expect(a).toEqual(b);
  });
});

describe("resilienza in simulazione", () => {
  it("ogni popolo vivo ha un profilo aggiornato e valido", () => {
    const state = createWorld({ seed: "resilienza-mondo", width: 64, height: 64 });
    runSimulation(state, 300);
    const ctx = createContext(state);
    buildCommunities(ctx);
    let withProfile = 0;
    for (const tribe of state.tribes) {
      if (tribe.status === "extinct") continue;
      if (!tribe.resilience) continue;
      withProfile++;
      expect(tribe.resilience.updatedAtTick).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(tribe.resilience)) {
        if (key === "updatedAtTick") continue;
        expect(Number.isFinite(value), key).toBe(true);
        expect(value, key).toBeGreaterThanOrEqual(0);
        expect(value, key).toBeLessThanOrEqual(1);
      }
    }
    expect(withProfile).toBeGreaterThan(0);
  });

  it("ogni carestia dichiara che cosa il popolo ha deciso di fare e perché", () => {
    const state = createWorld({ seed: "carestie", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    const famines = result.events.filter((e) => e.type === "famine" && e.metadata.response);
    expect(famines.length).toBeGreaterThan(0);
    for (const event of famines) {
      expect(CRISIS_RESPONSE_LABELS[event.metadata.response as never]).toBeTruthy();
      expect(typeof event.metadata.responseReason).toBe("string");
      expect(event.metadata.resilience).toBeGreaterThanOrEqual(0);
    }
    // Different peoples in different shape do not all answer the same way.
    const chosen = new Set(famines.map((e) => e.metadata.response));
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("un mondo salvato prima della resilienza si carica senza profilo e lo ricostruisce", async () => {
    const { deserializeState, serializeWorld } = await import("../src/index");
    const original = createWorld({ seed: "legacy-resilienza", width: 48, height: 48 });
    runSimulation(original, 100);
    const payload = JSON.parse(serializeWorld(original)) as {
      version: number;
      state: { tribes: Record<string, unknown>[] };
    };
    for (const tribe of payload.state.tribes) delete tribe.resilience;
    const restored = deserializeState(payload as never);
    for (const tribe of restored.tribes) expect(tribe.resilience).toBeNull();
    // One tick is enough to have it back: it is derived, not remembered.
    runSimulation(restored, 1);
    expect(restored.tribes.some((t) => t.status !== "extinct" && t.resilience !== null)).toBe(true);
  });
});
