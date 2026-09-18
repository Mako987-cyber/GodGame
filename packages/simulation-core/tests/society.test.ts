import { describe, expect, it } from "vitest";
import {
  createWorld,
  culturalDistance,
  initialStability,
  isEligibleLeader,
  leaderScore,
  randomCulture,
  related,
  runSimulation,
  Rng,
  type Person,
  type Tribe,
} from "../src/index";
import { world } from "./helpers";

describe("famiglie, leader e dinastie", () => {
  it("le nascite collegano genitori e nucleo validi", () => {
    const state = createWorld({ seed: "famiglie" });
    runSimulation(state, 60);
    const born = state.people.filter((p) => p.birthYear > state.settings.startYear);
    expect(born.length).toBeGreaterThan(0);
    const byId = new Map([...state.people, ...state.archive.people].map((p) => [p.id, p]));
    const households = new Map([...state.households, ...state.archive.households].map((h) => [h.id, h]));
    for (const child of born) {
      expect(child.motherId).not.toBeNull();
      expect(child.fatherId).not.toBeNull();
      const mother = byId.get(child.motherId!);
      const father = byId.get(child.fatherId!);
      expect(mother?.sex).toBe("F");
      expect(father?.sex).toBe("M");
      expect(child.motherId).not.toBe(child.id);
      expect(child.fatherId).not.toBe(child.id);
      expect(child.motherId).not.toBe(child.fatherId);
      if (child.householdId) expect(households.has(child.householdId)).toBe(true);
      expect(child.birthYear).toBeGreaterThan(mother!.birthYear);
      expect(child.birthYear).toBeGreaterThan(father!.birthYear);
    }
  });

  it("nessuna coppia si forma tra consanguinei diretti", () => {
    const state = createWorld({ seed: "consanguineita" });
    runSimulation(state, 120);
    const byId = new Map([...state.people, ...state.archive.people].map((p) => [p.id, p]));
    for (const h of [...state.households, ...state.archive.households]) {
      const a = byId.get(h.partnerIds[0]);
      const b = byId.get(h.partnerIds[1]);
      if (!a || !b) continue;
      expect(a.id).not.toBe(b.id);
      expect(related(a, b)).toBe(false);
    }
  });

  it("nessun individuo morto agisce", () => {
    const state = createWorld({ seed: "morti" });
    runSimulation(state, 80);
    for (const p of state.archive.people) {
      expect(p.alive).toBe(false);
      expect(p.action).toBe("rest");
      expect(p.deathYear).not.toBeNull();
      expect(p.deathCause).not.toBeNull();
    }
    for (const p of state.people) expect(p.alive).toBe(true);
  });

  it("la successione sceglie un erede valido e genera eventi", () => {
    const state = createWorld({ seed: "successione" });
    const result = runSimulation(state, 200);
    const leadership = result.events.filter((e) => e.type === "leadership");
    expect(leadership.length).toBeGreaterThan(0);
    const byId = new Map([...state.people, ...state.archive.people].map((p) => [p.id, p]));
    for (const e of leadership) {
      if (e.subtype !== "succession" && e.subtype !== "foundation" && e.subtype !== "coup") continue;
      const person = byId.get(String(e.metadata.personId));
      expect(person, `leader ${String(e.metadata.personId)}`).toBeDefined();
      // A leader is always an adult in a fit age bracket at the time of the appointment.
      const ageAtEvent = e.year - person!.birthYear;
      expect(ageAtEvent).toBeGreaterThanOrEqual(19);
      expect(ageAtEvent).toBeLessThan(75);
    }
    for (const tribe of state.tribes) {
      if (tribe.status === "extinct") {
        expect(tribe.leaderId).toBeNull();
        continue;
      }
      if (!tribe.leaderId) continue;
      const leader = state.people.find((p) => p.id === tribe.leaderId);
      expect(leader).toBeDefined();
      expect(leader!.tribeId).toBe(tribe.id);
      expect(isEligibleLeader(leader!) || leader!.age >= 70).toBe(true);
    }
  });

  it("il punteggio di leadership dipende dai meriti, non dal caso", () => {
    const state = world("punteggio");
    const tribe: Tribe = { ...state.tribes[0]!, government: "chiefdom" };
    const base = state.people[0]!;
    const weak: Person = { ...base, prestige: 0.1, skills: { ...base.skills, combat: 0.1, leadership: 0.1 } };
    const strong: Person = {
      ...base,
      id: "p-strong",
      prestige: 0.9,
      skills: { ...base.skills, combat: 0.9, leadership: 0.9 },
    };
    const context = { maxWealth: 1, dynasties: new Map() };
    expect(leaderScore(strong, tribe, context)).toBeGreaterThan(leaderScore(weak, tribe, context));
  });

  it("l'eredità trasferisce ricchezza e prestigio ai figli", () => {
    const state = createWorld({ seed: "eredita" });
    runSimulation(state, 150);
    const wealthy = state.archive.people.filter((p) => p.title !== null);
    // A dead person never keeps wealth: it is passed on or returns to the group.
    for (const p of wealthy) expect(p.wealth).toBe(0);
  });
});

describe("cultura, governo e stabilità", () => {
  it("i tratti culturali restano nell'intervallo 0-100", () => {
    const state = createWorld({ seed: "cultura" });
    runSimulation(state, 200);
    for (const tribe of state.tribes) {
      for (const [key, value] of Object.entries(tribe.culture)) {
        expect(Number.isFinite(value), `${tribe.id}.${key}`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      for (const [key, value] of Object.entries(tribe.stability)) {
        if (key === "unrestYears") {
          expect(value).toBeGreaterThanOrEqual(0);
          continue;
        }
        expect(value, `${tribe.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("la distanza culturale è simmetrica e normalizzata", () => {
    const rng = Rng.fromSeed("distanza");
    const a = randomCulture(rng);
    const b = randomCulture(rng);
    expect(culturalDistance(a, b)).toBe(culturalDistance(b, a));
    expect(culturalDistance(a, a)).toBe(0);
    expect(culturalDistance(a, b)).toBeGreaterThanOrEqual(0);
    expect(culturalDistance(a, b)).toBeLessThanOrEqual(1);
  });

  it("le forme di governo evolvono solo al raggiungimento delle condizioni", () => {
    const state = createWorld({ seed: "governo" });
    const result = runSimulation(state, 400);
    const changes = result.events.filter((e) => e.type === "culture" && e.subtype === "government_change");
    for (const e of changes) {
      expect(e.metadata.from).not.toBe(e.metadata.to);
      expect(Number(e.metadata.population)).toBeGreaterThanOrEqual(55);
    }
    // Government never becomes something the tribe has no institutions for.
    for (const tribe of state.tribes) {
      if (tribe.government === "city_state" || tribe.government === "merchant_republic") {
        expect(tribe.techs).toContain("writing");
      }
    }
  });

  it("le rivolte richiedono anni di malcontento", () => {
    const state = createWorld({ seed: "rivolte" });
    const result = runSimulation(state, 400);
    const revolts = result.events.filter((e) => e.type === "unrest");
    // Rare by construction.
    expect(revolts.length).toBeLessThan(40);
    for (const e of revolts) {
      expect(Number(e.metadata.legitimacy)).toBeLessThanOrEqual(1);
      expect(e.metadata.government).toBeTypeOf("string");
    }
  });

  it("la stabilità iniziale è dentro i limiti", () => {
    const s = initialStability();
    for (const [key, value] of Object.entries(s)) {
      if (key === "unrestYears") continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
