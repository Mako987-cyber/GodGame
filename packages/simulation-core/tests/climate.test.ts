import { describe, expect, it } from "vitest";
import {
  annualYieldAt,
  cellAt,
  cellClimate,
  climateAt,
  cloneWorld,
  computeSeasons,
  createWorld,
  hashWorld,
  runSimulation,
  seasonWeights,
  seasonYieldAt,
  winterConsumptionFactor,
  winterMortalityFactor,
  type Cell,
} from "../src/index";
import { world } from "./helpers";

function cellOfBiome(state: ReturnType<typeof world>, biome: Cell["biome"]): Cell {
  const cell = state.cells.find((c) => c.biome === biome);
  if (!cell) throw new Error(`Nessuna cella di bioma ${biome}`);
  return cell;
}

describe("clima e stagioni", () => {
  it("ogni anno è scomposto in quattro stagioni deterministiche", () => {
    const state = createWorld({ seed: "stagioni" });
    runSimulation(state, 5);
    expect(state.climate.seasons).toHaveLength(4);
    expect(state.climate.seasons.map((s) => s.season)).toEqual(["spring", "summer", "autumn", "winter"]);
    for (const season of state.climate.seasons) {
      expect(season.temperature).toBeGreaterThanOrEqual(0);
      expect(season.temperature).toBeLessThanOrEqual(1);
      expect(season.precipitation).toBeGreaterThanOrEqual(0);
      expect(season.precipitation).toBeLessThanOrEqual(1);
      expect(season.yield).toBeGreaterThanOrEqual(0);
      expect(season.yield).toBeLessThanOrEqual(2);
    }
    // Winter always yields less than summer.
    const summer = state.climate.seasons.find((s) => s.season === "summer")!;
    const winter = state.climate.seasons.find((s) => s.season === "winter")!;
    expect(winter.yield).toBeLessThan(summer.yield);
  });

  it("l'inverno è più duro in tundra che in pianura", () => {
    const state = world("inverni", 64);
    const tundra = cellOfBiome(state, "tundra");
    // The warmest plains cell: comparing against a near-polar plain would prove nothing.
    const plains = state.cells
      .filter((c) => c.biome === "plains")
      .reduce((best, c) => (c.temperature > best.temperature ? c : best));
    expect(cellClimate(tundra).winterSeverity).toBeGreaterThan(cellClimate(plains).winterSeverity);

    const seasons = computeSeasons(state, false);
    const winter = seasons.find((s) => s.season === "winter")!;
    expect(seasonYieldAt(tundra, winter)).toBeLessThan(seasonYieldAt(plains, winter));

    // More food is burned and more people die in the cold.
    expect(winterConsumptionFactor(state, tundra, state.config)).toBeGreaterThan(
      winterConsumptionFactor(state, plains, state.config),
    );
    expect(winterMortalityFactor(state, tundra)).toBeGreaterThan(winterMortalityFactor(state, plains));
  });

  it("il deserto produce meno della pianura e fiumi/coste aiutano", () => {
    const state = world("biomi", 64);
    const weights = seasonWeights(state.config);
    state.climate.seasons = computeSeasons(state, false);
    const desert = cellOfBiome(state, "desert");
    const plains = cellOfBiome(state, "plains");
    expect(annualYieldAt(state, desert, weights)).toBeLessThan(annualYieldAt(state, plains, weights));
    expect(cellClimate(desert).aridity).toBeGreaterThan(cellClimate(plains).aridity);

    const river = state.cells.find((c) => c.river && c.biome !== "ocean");
    if (river) {
      expect(cellClimate(river).precipitation).toBeGreaterThan(0);
      expect(river.water).toBeGreaterThan(0.5);
      expect(cellClimate(river).floodRisk).toBeGreaterThan(cellClimate(desert).floodRisk);
    }
  });

  it("la siccità riduce la produzione nella sua area", () => {
    const state = createWorld({ seed: "siccita" });
    const tribe = state.tribes[0]!;
    const before = climateAt(state, tribe.x, tribe.y);
    state.climate.hazards.push({
      id: "hz-test",
      kind: "drought",
      x: tribe.x,
      y: tribe.y,
      radius: 6,
      severity: 0.5,
      startYear: state.year,
      untilYear: state.year + 3,
      eventId: null,
    });
    const during = climateAt(state, tribe.x, tribe.y);
    expect(during).toBeLessThan(before);
    expect(during).toBeCloseTo(before * 0.5, 5);
    // Outside the radius nothing changes.
    const far = state.cells.find((c) => Math.max(Math.abs(c.x - tribe.x), Math.abs(c.y - tribe.y)) > 8)!;
    expect(climateAt(state, far.x, far.y)).toBeCloseTo(before, 5);
  });

  it("stesso seed, stessi pattern climatici", () => {
    const a = createWorld({ seed: "clima-determinismo" });
    const b = cloneWorld(a);
    runSimulation(a, 80);
    runSimulation(b, 80);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.climate).toEqual(b.climate);
  });

  it("i valori climatici restano nei limiti previsti per 200 anni", () => {
    const state = createWorld({ seed: "limiti-clima" });
    const result = runSimulation(state, 200);
    for (const s of result.stats) {
      expect(s.averageTemperature).toBeGreaterThanOrEqual(0);
      expect(s.averageTemperature).toBeLessThanOrEqual(1);
      expect(s.climateStress).toBeGreaterThanOrEqual(0);
      expect(s.climateStress).toBeLessThanOrEqual(1);
    }
    expect(state.climate.modifier).toBeGreaterThanOrEqual(0.5);
    expect(state.climate.modifier).toBeLessThanOrEqual(1.5);
    expect(Math.abs(state.climate.trend)).toBeLessThanOrEqual(1);
    for (const hazard of state.climate.hazards) {
      expect(hazard.severity).toBeGreaterThan(0);
      expect(hazard.severity).toBeLessThanOrEqual(1);
      expect(hazard.untilYear).toBeGreaterThanOrEqual(state.year);
      expect(cellAt(state, hazard.x, hazard.y)).toBeDefined();
    }
  });

  it("le calamità sono rare e hanno una spiegazione nei metadata", () => {
    const state = createWorld({ seed: "calamita" });
    const result = runSimulation(state, 300);
    const hazards = result.events.filter((e) => e.type === "climate");
    expect(hazards.length).toBeGreaterThan(0);
    // Rare by construction: far fewer than one per year.
    expect(hazards.length).toBeLessThan(120);
    for (const e of hazards) {
      expect(e.subtype).toBeTruthy();
      if (e.subtype === "harsh_winter") continue;
      expect(e.metadata.severity).toBeTypeOf("number");
      expect(e.metadata.cause).toBeTypeOf("string");
      expect(e.metadata.radius).toBeTypeOf("number");
    }
  });
});
