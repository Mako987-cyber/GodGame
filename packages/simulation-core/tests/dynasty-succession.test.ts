import { describe, expect, it } from "vitest";
import {
  canFoundDynasty,
  createWorld,
  deserializeState,
  DYNASTY_MIN_POPULATION,
  endDynasty,
  ensureDynasty,
  MAJORITY_AGE,
  restoreDynasty,
  runSimulation,
  successionCrisisRisk,
  successionLawOf,
  type Person,
  type SuccessionRiskInput,
  type Tribe,
  type WorldState,
} from "../src/index";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

const risk = (overrides: Partial<SuccessionRiskInput> = {}): SuccessionRiskInput => ({
  heirs: 1,
  rivals: 0,
  minorHeir: false,
  suddenDeath: false,
  dynastyLegitimacy: 0.8,
  legitimacy: 0.7,
  centralization: 0.6,
  vassalPressure: 0,
  ...overrides,
});

/** Gives `tribe` a leader with children, old enough and respected enough to found a house. */
function royalFamily(state: WorldState, tribe: Tribe): { leader: Person; heir: Person } {
  const members = state.people.filter((p) => p.tribeId === tribe.id && p.alive);
  const leader = members[0]!;
  const heir = members[1]!;
  leader.age = 50;
  leader.prestige = 0.8;
  leader.health = 0.9;
  heir.age = 28;
  heir.health = 0.9;
  heir.prestige = 0.6;
  heir.fatherId = leader.id;
  tribe.leaderId = leader.id;
  tribe.culture = { ...tribe.culture, hierarchy: 70, centralization: 60 };
  tribe.stability.legitimacy = 0.7;
  return { leader, heir };
}

describe("rischio di crisi di successione", () => {
  it("una casa solida con un erede chiaro non rischia nulla", () => {
    expect(successionCrisisRisk(risk())).toBe(0);
  });

  it("senza eredi la crisi è certa", () => {
    expect(successionCrisisRisk(risk({ heirs: 0 }))).toBe(1);
  });

  it("ogni causa alza il rischio e nessuna lo abbassa", () => {
    const base = successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5 }));
    expect(
      successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5, rivals: 2 })),
    ).toBeGreaterThan(base);
    expect(successionCrisisRisk(risk({ dynastyLegitimacy: 0.2, legitimacy: 0.5 }))).toBeGreaterThan(base);
    expect(successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.2 }))).toBeGreaterThan(base);
    expect(
      successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5, minorHeir: true })),
    ).toBeGreaterThan(base);
    expect(
      successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5, suddenDeath: true })),
    ).toBeGreaterThan(base);
    expect(
      successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5, vassalPressure: 1 })),
    ).toBeGreaterThan(base);
    expect(
      successionCrisisRisk(risk({ dynastyLegitimacy: 0.6, legitimacy: 0.5, centralization: 0.1 })),
    ).toBeGreaterThan(base);
  });

  it("resta sempre una probabilità valida", () => {
    const worst = successionCrisisRisk(
      risk({
        heirs: 3,
        rivals: 5,
        minorHeir: true,
        suddenDeath: true,
        dynastyLegitimacy: 0,
        legitimacy: 0,
        centralization: 0,
        vassalPressure: 1,
      }),
    );
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe("fondazione di una casa regnante", () => {
  it("serve prestigio, gerarchia, un gruppo abbastanza grande e dei figli", () => {
    const state = world("fondazione-casa", 64);
    const tribe = state.tribes[0]!;
    const ctx = createContext(state);
    const { leader } = royalFamily(state, tribe);
    const population = state.people.filter((p) => p.alive && p.tribeId === tribe.id).length;
    expect(population).toBeGreaterThanOrEqual(1);

    // Too small a group: nothing worth passing on.
    if (population < DYNASTY_MIN_POPULATION) expect(canFoundDynasty(ctx, tribe, leader)).toBe(false);
    for (let i = 0; i < DYNASTY_MIN_POPULATION; i++) {
      state.people.push({ ...structuredClone(leader), id: `extra${i}`, seq: 9000 + i, prestige: 0.1 });
    }
    expect(canFoundDynasty(ctx, tribe, leader)).toBe(true);
    // A chief nobody respects cannot make his command heritable.
    expect(canFoundDynasty(ctx, tribe, { ...leader, prestige: 0.1 })).toBe(false);
    // Neither can one with no children.
    const childless = { ...leader, id: "childless" };
    expect(canFoundDynasty(ctx, tribe, childless)).toBe(false);
  });

  it("la legge di successione segue la forma di governo", () => {
    const state = world("leggi");
    const tribe = state.tribes[0]!;
    tribe.government = "tribal_monarchy";
    expect(successionLawOf(tribe)).toBe("hereditary");
    tribe.government = "city_state";
    expect(successionLawOf(tribe)).toBe("elective");
    tribe.government = "elder_council";
    expect(successionLawOf(tribe)).toBe("council");
    tribe.government = "chiefdom";
    expect(successionLawOf(tribe)).toBe("military");
    tribe.government = "clan";
    tribe.culture = { ...tribe.culture, spirituality: 80 };
    expect(successionLawOf(tribe)).toBe("religious");
    tribe.culture = { ...tribe.culture, spirituality: 20 };
    expect(successionLawOf(tribe)).toBe("meritocratic");
  });
});

describe("fine e restaurazione di una casa", () => {
  it("una casa chiusa conserva tutto il suo record", () => {
    const state = world("fine-casa", 64);
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    const { leader } = royalFamily(state, tribe);
    tribe.government = "tribal_monarchy";
    const dynasty = ensureDynasty(ctx, tribe, leader)!;
    expect(dynasty.status).toBe("active");
    expect(dynasty.currentLeaderId).toBe(leader.id);
    expect(dynasty.successionLaw).toBe("hereditary");

    const founded = dynasty.foundedYear;
    expect(endDynasty(ctx, tribe, dynasty, "usurpation")).toBe(true);
    expect(dynasty.status).toBe("overthrown");
    expect(dynasty.endReason).toBe("usurpation");
    expect(dynasty.endedYear).toBe(state.year);
    // Nothing of what it was is erased.
    expect(dynasty.foundedYear).toBe(founded);
    expect(dynasty.founderId).toBe(leader.id);
    expect(tribe.dynastyId).toBeNull();
    // Closing it twice changes nothing.
    expect(endDynasty(ctx, tribe, dynasty, "no_heir")).toBe(false);
    expect(dynasty.endReason).toBe("usurpation");
    const event = ctx.events.find((e) => e.subtype === "dynasty_ended");
    expect(event?.metadata.reason).toBe("usurpation");
  });

  it("una casa torna al potere solo dopo che il ricordo si è sedimentato", () => {
    const state = world("restaurazione", 64);
    const ctx = createContext(state);
    const tribe = state.tribes[0]!;
    const { leader, heir } = royalFamily(state, tribe);
    tribe.government = "tribal_monarchy";
    const dynasty = ensureDynasty(ctx, tribe, leader)!;
    endDynasty(ctx, tribe, dynasty, "usurpation");

    // Straight away: the people has not forgotten why it threw them out.
    expect(restoreDynasty(ctx, tribe, dynasty, heir)).toBe(false);
    state.year += 30;
    expect(restoreDynasty(ctx, tribe, dynasty, heir)).toBe(true);
    expect(dynasty.status).toBe("active");
    expect(dynasty.endedYear).toBeNull();
    expect(dynasty.currentLeaderId).toBe(heir.id);
    expect(tribe.dynastyId).toBe(dynasty.id);
    const event = ctx.events.find((e) => e.subtype === "dynasty_restored");
    expect(event?.metadata.yearsAway).toBe(30);

    // A form of government that does not pass power down cannot restore a house.
    endDynasty(ctx, tribe, dynasty, "no_heir");
    state.year += 40;
    tribe.government = "merchant_republic";
    expect(restoreDynasty(ctx, tribe, dynasty, heir)).toBe(false);
  });
});

describe("dinastie in simulazione", () => {
  it("le case nascono, governano e finiscono con una causa registrata", () => {
    // A seed whose peoples survive long enough to form houses (most do: 11 of 12 measured).
    const state = createWorld({ seed: "b2", width: 64, height: 64 });
    const result = runSimulation(state, 500);
    expect(state.dynasties.length).toBeGreaterThan(0);
    const founded = result.events.filter((e) => e.subtype === "dynasty_founded");
    expect(founded.length).toBe(state.dynasties.length);

    for (const dynasty of state.dynasties) {
      expect(dynasty.rulers).toBeGreaterThanOrEqual(1);
      expect(dynasty.legitimacy).toBeGreaterThanOrEqual(0);
      expect(dynasty.legitimacy).toBeLessThanOrEqual(1);
      expect(dynasty.crises).toBeGreaterThanOrEqual(0);
      // An open house has a status to match, a closed one a reason and a year.
      if (dynasty.endedYear === null) {
        expect(dynasty.status).toBe("active");
        expect(dynasty.endReason).toBeNull();
      } else {
        expect(dynasty.status).not.toBe("active");
        expect(dynasty.endReason).not.toBeNull();
        expect(dynasty.endedYear).toBeGreaterThanOrEqual(dynasty.foundedYear);
      }
      // The founder and the current head are real people of this world.
      const everyone = [...state.people, ...state.archive.people];
      expect(everyone.some((p) => p.id === dynasty.founderId)).toBe(true);
      if (dynasty.currentLeaderId) {
        expect(everyone.some((p) => p.id === dynasty.currentLeaderId)).toBe(true);
      }
    }
    // Every closing is told by an event.
    const ended = state.dynasties.filter((d) => d.endedYear !== null);
    const endEvents = result.events.filter((e) => e.subtype === "dynasty_ended");
    expect(endEvents.length).toBe(ended.length);
  });

  it("ogni successione dichiara come è andata", () => {
    const state = createWorld({ seed: "successioni", width: 64, height: 64 });
    const result = runSimulation(state, 400);
    const successions = result.events.filter((e) => e.type === "leadership" && e.subtype === "succession");
    expect(successions.length).toBeGreaterThan(0);
    for (const e of successions) {
      expect(["peaceful", "regency", "disputed", "usurpation", "interregnum"]).toContain(e.metadata.outcome);
    }
    // Every troubled handover is also recorded as a crisis with its cause.
    for (const e of result.events.filter((x) => x.subtype === "succession_crisis")) {
      expect(typeof e.metadata.cause).toBe("string");
      expect(e.metadata.risk).toBeGreaterThan(0);
    }
  });

  it("un erede minorenne non regna mai in prima persona", () => {
    const state = createWorld({ seed: "minorenni", width: 48, height: 48 });
    runSimulation(state, 300);
    for (const tribe of state.tribes) {
      if (!tribe.leaderId) continue;
      const leader = state.people.find((p) => p.id === tribe.leaderId);
      if (leader) expect(leader.age).toBeGreaterThanOrEqual(MAJORITY_AGE);
    }
  });

  it("un mondo salvato prima delle leggi di successione si carica senza inventare nulla", () => {
    const state = createWorld({ seed: "legacy-dinastie", width: 48, height: 48 });
    runSimulation(state, 250);
    const before = state.dynasties.map((d) => ({ ...d }));
    if (before.length === 0) return;
    const payload = JSON.parse(
      JSON.stringify({
        version: 5,
        state: {
          ...state,
          dynasties: state.dynasties.map((d) => {
            const legacy: Record<string, unknown> = { ...d };
            for (const key of [
              "currentLeaderId",
              "legitimacy",
              "successionLaw",
              "status",
              "endReason",
              "crises",
            ]) {
              delete legacy[key];
            }
            return legacy;
          }),
        },
      }),
    ) as { version: number; state: unknown };
    // Round-trips through the same path a database load uses.
    const restored = JSON.parse(JSON.stringify(payload.state)) as WorldState;
    const loaded = deserializeState({ version: payload.version, state: restored } as never);
    for (const [i, dynasty] of loaded.dynasties.entries()) {
      expect(dynasty.name).toBe(before[i]!.name);
      expect(dynasty.rulers).toBe(before[i]!.rulers);
      expect(dynasty.foundedYear).toBe(before[i]!.foundedYear);
      expect(dynasty.crises).toBe(0);
      expect(dynasty.status).toBe(dynasty.endedYear === null ? "active" : "extinct");
    }
  });
});
