import { describe, expect, it } from "vitest";
import { birthProbability, runSimulation } from "../src/index";
import type { BirthConditions } from "../src/population";
import type { Person } from "../src/types";
import { world } from "./helpers";

const good: BirthConditions = {
  foodRatio: 1,
  storedPerCapita: 1,
  housingOk: true,
  atWar: false,
  populationPressure: 1,
};

function couple(): [Person, Person] {
  const state = world("nascite");
  const mother = { ...state.people[0]!, sex: "F" as const, age: 25, health: 1, hunger: 0, alive: true };
  const father = { ...state.people[1]!, sex: "M" as const, age: 27, health: 1, hunger: 0, alive: true };
  return [mother, father];
}

describe("nascite", () => {
  it("avvengono solo in condizioni valide", () => {
    const [mother, father] = couple();
    expect(birthProbability(mother, father, good)).toBeGreaterThan(0);
    expect(birthProbability(mother, null, good)).toBe(0);
    expect(birthProbability({ ...mother, age: 50 }, father, good)).toBe(0);
    expect(birthProbability({ ...mother, age: 12 }, father, good)).toBe(0);
    expect(birthProbability({ ...mother, hunger: 0.9 }, father, good)).toBe(0);
    expect(birthProbability({ ...mother, health: 0.2 }, father, good)).toBe(0);
    expect(birthProbability(mother, { ...father, alive: false }, good)).toBe(0);
    expect(birthProbability(mother, father, { ...good, foodRatio: 0.5 })).toBe(0);
    expect(birthProbability({ ...mother, sex: "M" }, father, good)).toBe(0);
  });

  it("il surplus alimentare aumenta la probabilità di nascita", () => {
    const [mother, father] = couple();
    const low = birthProbability(mother, father, { ...good, foodRatio: 0.85, storedPerCapita: 0 });
    const high = birthProbability(mother, father, { ...good, foodRatio: 1, storedPerCapita: 1.5 });
    expect(high).toBeGreaterThan(low);
  });

  it("senza coppie non nasce nessuno", () => {
    const state = world("senza-coppie");
    for (const p of state.people) p.householdId = null;
    state.households = [];
    // Everyone is the same sex: no couple can ever form.
    for (const p of state.people) p.sex = "M";
    const result = runSimulation(state, 20);
    expect(result.stats.reduce((a, s) => a + s.births, 0)).toBe(0);
  });

  it("ogni neonato ha due genitori e una madre in età fertile", () => {
    const state = world("genitori");
    runSimulation(state, 40);
    const all = [...state.people, ...state.archive.people];
    const byId = new Map(all.map((p) => [p.id, p]));
    const newborns = all.filter((p) => p.birthYear > state.settings.startYear);
    expect(newborns.length).toBeGreaterThan(0);
    for (const child of newborns) {
      const mother = byId.get(child.motherId ?? "");
      const father = byId.get(child.fatherId ?? "");
      expect(mother?.sex).toBe("F");
      expect(father?.sex).toBe("M");
      const motherAge = child.birthYear - (mother?.birthYear ?? 0);
      expect(motherAge).toBeGreaterThanOrEqual(16);
      expect(motherAge).toBeLessThanOrEqual(46);
    }
  });
});
