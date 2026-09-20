import { describe, expect, it } from "vitest";
import {
  AGREEMENT_LABELS,
  NEGOTIABLE,
  activeAgreements,
  canSign,
  cancelOrphanAgreements,
  createWorld,
  emptyReputation,
  expireAgreements,
  hasAgreement,
  pairKey,
  reputationOf,
  runSimulation,
  signAgreement,
  signingChance,
  updateReputation,
  violateAgreement,
  type Relationship,
  type Tribe,
} from "../src/index";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

function relation(a: Tribe, b: Tribe, overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: `${a.id}|${b.id}`,
    aId: a.id,
    bId: b.id,
    trust: 0.6,
    hostility: 0.05,
    tradeVolume: 40,
    conflictMemory: 0,
    atWar: false,
    warStartYear: null,
    allied: false,
    distance: 4,
    lastInteractionYear: 0,
    battles: 0,
    truceUntilYear: null,
    respect: 0.3,
    tradeDependency: 0.2,
    culturalDistance: 0.2,
    status: "trade_partner",
    phase: "peace",
    lastConflictYear: null,
    phaseYears: 20,
    fusionYears: 0,
    ...overrides,
  };
}

describe("firma di un accordo", () => {
  it("ogni tipo negoziabile ha un'etichetta", () => {
    for (const type of NEGOTIABLE) expect(AGREEMENT_LABELS[type]).toBeTruthy();
  });

  it("la coppia ha una chiave canonica, qualunque sia l'ordine", () => {
    const state = world("coppie");
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    expect(pairKey(a, b)).toEqual(pairKey(b, a));
  });

  it("serve fiducia e poca ostilità, e in guerra non si firma nulla", () => {
    const state = world("firme");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    expect(canSign(ctx, relation(a, b), a, b, "trade")).toBe(true);
    expect(canSign(ctx, relation(a, b, { trust: 0 }), a, b, "military_alliance")).toBe(false);
    expect(canSign(ctx, relation(a, b, { hostility: 0.9 }), a, b, "trade")).toBe(false);
    expect(canSign(ctx, relation(a, b, { atWar: true }), a, b, "trade")).toBe(false);
    // Trade needs actual traffic, not just goodwill.
    expect(canSign(ctx, relation(a, b, { tradeVolume: 0 }), a, b, "trade")).toBe(false);
    // Nobody signs with themselves.
    expect(canSign(ctx, relation(a, a), a, a, "trade")).toBe(false);
  });

  it("uno scambio di conoscenze ha senso solo se c'è qualcosa da scambiare", () => {
    const state = world("scambio");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    a.techs = ["fire"];
    b.techs = ["fire"];
    expect(canSign(ctx, relation(a, b), a, b, "technology_exchange")).toBe(false);
    a.techs = ["fire", "stone_tools"];
    expect(canSign(ctx, relation(a, b), a, b, "technology_exchange")).toBe(true);
  });

  it("lo stesso patto non si firma due volte", () => {
    const state = world("doppioni");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    const rel = relation(a, b);
    expect(signAgreement(ctx, rel, a, b, "non_aggression")).not.toBeNull();
    expect(hasAgreement(ctx, a.id, b.id, "non_aggression")).toBe(true);
    expect(canSign(ctx, rel, a, b, "non_aggression")).toBe(false);
    expect(signAgreement(ctx, rel, a, b, "non_aggression")).toBeNull();
    expect(state.agreements).toHaveLength(1);
    // The pair is found whichever way round it is asked.
    expect(activeAgreements(ctx, b.id, a.id)).toHaveLength(1);
  });

  it("la volontà di firmare cresce con la fiducia e cala con l'ostilità", () => {
    const state = world("volonta");
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    const repA = emptyReputation(a.id, 0);
    const repB = emptyReputation(b.id, 0);
    const base = signingChance(relation(a, b), repA, repB);
    expect(signingChance(relation(a, b, { trust: 0.9 }), repA, repB)).toBeGreaterThan(base);
    expect(signingChance(relation(a, b, { hostility: 0.5 }), repA, repB)).toBeLessThan(base);
    expect(signingChance(relation(a, b), { ...repA, treatyRespect: 0.1 }, repB)).toBeLessThan(base);
    for (const value of [base, signingChance(relation(a, b, { trust: 1 }), repA, repB)]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("chi ha fama di stracciare i patti non trova più firmatari", () => {
    const state = world("screditati");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    expect(canSign(ctx, relation(a, b), a, b, "trade")).toBe(true);
    reputationOf(ctx, b.id).treatyRespect = 0.1;
    expect(canSign(ctx, relation(a, b), a, b, "trade")).toBe(false);
  });
});

describe("violazione e reputazione", () => {
  it("rompere un patto lo registra e costa reputazione", () => {
    const state = world("violazioni");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    const agreement = signAgreement(ctx, relation(a, b), a, b, "trade")!;
    const before = { ...reputationOf(ctx, a.id) };
    expect(violateAgreement(ctx, agreement, a.id, "ha attaccato")).toBe(true);
    const after = reputationOf(ctx, a.id);
    expect(agreement.status).toBe("violated");
    expect(agreement.lastViolatorId).toBe(a.id);
    expect(agreement.violationCount).toBe(1);
    expect(agreement.endedYear).toBe(state.year);
    expect(after.treatyRespect).toBeLessThan(before.treatyRespect);
    expect(after.reliability).toBeLessThan(before.reliability);
    expect(after.tradeReliability).toBeLessThan(before.tradeReliability);
    expect(after.agreementsBroken).toBe(1);
    // The other side pays nothing for being betrayed.
    expect(reputationOf(ctx, b.id).treatyRespect).toBe(before.treatyRespect);
    // Breaking it twice changes nothing.
    expect(violateAgreement(ctx, agreement, a.id, "di nuovo")).toBe(false);
    const event = ctx.events.find((e) => e.subtype === "violated");
    expect(event?.metadata.violatorId).toBe(a.id);
  });

  it("la reputazione si muove solo per quello che è successo", () => {
    const state = world("reputazione");
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    const quiet = { warsStarted: 0, atWar: false, power: 10, maxPower: 100, tradeVolume: 100 };
    for (let i = 0; i < 40; i++) updateReputation(ctx, tribe, quiet);
    const peaceful = { ...reputationOf(ctx, tribe.id) };

    const other = state.tribes[1]!;
    const warlike = { warsStarted: 3, atWar: true, power: 100, maxPower: 100, tradeVolume: 0 };
    for (let i = 0; i < 40; i++) updateReputation(ctx, other, warlike);
    const aggressive = reputationOf(ctx, other.id);

    expect(aggressive.aggression).toBeGreaterThan(peaceful.aggression);
    expect(aggressive.threatLevel).toBeGreaterThan(peaceful.threatLevel);
    expect(aggressive.tradeReliability).toBeLessThan(peaceful.tradeReliability);
    for (const value of Object.values(aggressive)) {
      if (typeof value !== "number") continue;
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("ciclo di vita dei patti", () => {
  it("un patto scaduto si chiude ma resta nel registro", () => {
    const state = world("scadenze");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    const agreement = signAgreement(ctx, relation(a, b), a, b, "trade")!;
    expect(agreement.expiresAtYear).not.toBeNull();
    expireAgreements(ctx);
    expect(agreement.status).toBe("active");
    state.year = agreement.expiresAtYear! + 1;
    expireAgreements(ctx);
    expect(agreement.status).toBe("expired");
    expect(agreement.endedYear).toBe(state.year);
    expect(state.agreements).toContain(agreement);
  });

  it("un patto perde valore quando uno dei due firmatari non esiste più", () => {
    const state = world("orfani");
    const ctx = createContext(state);
    const [a, b] = [state.tribes[0]!, state.tribes[1]!];
    const agreement = signAgreement(ctx, relation(a, b), a, b, "non_aggression")!;
    b.status = "extinct";
    cancelOrphanAgreements(ctx);
    expect(agreement.status).toBe("cancelled");
    expect(agreement.endedYear).toBe(state.year);
    expect(state.agreements).toContain(agreement);
  });
});

describe("accordi in simulazione", () => {
  it("nascono, scadono, si rompono e restano coerenti", () => {
    const state = createWorld({ seed: "accordi-mondo", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    expect(state.agreements.length).toBeGreaterThan(0);
    const signed = result.events.filter((e) => e.type === "agreement" && e.subtype !== "violated");
    expect(signed.length).toBeGreaterThan(0);

    const tribeIds = new Set(state.tribes.map((t) => t.id));
    for (const agreement of state.agreements) {
      expect(tribeIds.has(agreement.firstCivilizationId)).toBe(true);
      expect(tribeIds.has(agreement.secondCivilizationId)).toBe(true);
      expect(agreement.firstCivilizationId).not.toBe(agreement.secondCivilizationId);
      expect(agreement.startedYear).toBeLessThanOrEqual(state.year);
      if (agreement.status === "active") expect(agreement.endedYear).toBeNull();
      else expect(agreement.endedYear).not.toBeNull();
      if (agreement.status === "violated") expect(agreement.lastViolatorId).not.toBeNull();
      if (agreement.lastViolatorId) {
        expect([agreement.firstCivilizationId, agreement.secondCivilizationId]).toContain(
          agreement.lastViolatorId,
        );
      }
    }
    // No pair holds the same kind of pact twice at once.
    const active = state.agreements.filter((a) => a.status === "active");
    const keys = active.map((a) => `${a.firstCivilizationId}|${a.secondCivilizationId}|${a.type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dichiarare guerra a chi aveva firmato rompe i patti e lo mette agli atti", () => {
    const state = createWorld({ seed: "tradimenti", width: 64, height: 64 });
    const result = runSimulation(state, 600);
    const violations = result.events.filter((e) => e.subtype === "violated");
    for (const event of violations) {
      const agreement = state.agreements.find((a) => a.id === event.metadata.agreementId)!;
      expect(agreement.status).toBe("violated");
      // Whoever broke it carries it on their record.
      const reputation = state.reputations.find((r) => r.civilizationId === event.metadata.violatorId);
      expect(reputation?.agreementsBroken).toBeGreaterThan(0);
    }
  });

  it("ogni popolo che ha avuto rapporti ha una reputazione valida", () => {
    const state = createWorld({ seed: "reputazioni-mondo", width: 64, height: 64 });
    runSimulation(state, 400);
    expect(state.reputations.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const r of state.reputations) {
      expect(ids.has(r.civilizationId)).toBe(false);
      ids.add(r.civilizationId);
      for (const key of [
        "reliability",
        "aggression",
        "tradeReliability",
        "treatyRespect",
        "threatLevel",
      ] as const) {
        expect(r[key], key).toBeGreaterThanOrEqual(0);
        expect(r[key], key).toBeLessThanOrEqual(1);
      }
      expect(r.agreementsBroken).toBeLessThanOrEqual(r.agreementsSigned + state.agreements.length);
    }
  });

  it("stesso seme, stessi accordi", () => {
    const run = () => {
      const s = createWorld({ seed: "accordi-determinismo", width: 48, height: 48 });
      runSimulation(s, 250);
      return s.agreements.map((a) => `${a.id}|${a.type}|${a.startedYear}|${a.status}`);
    };
    expect(run()).toEqual(run());
  });
});
