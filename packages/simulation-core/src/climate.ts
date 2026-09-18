import { SEASONS, type Season, type SimulationConfig } from "./config";
import type { SimContext } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { cellsInRadius, clamp, distance, round } from "./grid";
import type { Cell, CellClimate, Hazard, HazardKind, SeasonState, WorldState } from "./types";

/**
 * Climate model.
 *
 * One tick is still one year, but every year is resolved as four deterministic seasons.
 * The global signal (`Climate.modifier`, `trend`, `seasons`) is combined with a per-cell
 * profile derived from the terrain, so the same seed always produces the same weather
 * and a tundra winter is always harsher than a winter in the plains.
 */

const SEASON_TEMPERATURE: Record<Season, number> = {
  spring: 0,
  summer: 1,
  autumn: 0,
  winter: -1,
};

const SEASON_RAIN: Record<Season, number> = {
  spring: 0.25,
  summer: -0.2,
  autumn: 0.2,
  winter: -0.05,
};

/** Terrain-derived climate profile of a cell. Pure function: never persisted. */
export function cellClimate(cell: Cell): CellClimate {
  const baseTemperature = clamp(cell.temperature);
  // Continental interiors and cold latitudes swing more between seasons.
  const seasonalRange = clamp(0.18 + (1 - baseTemperature) * 0.3 + (cell.coastal ? -0.06 : 0.04));
  const precipitation = clamp(cell.moisture * 0.8 + (cell.river ? 0.2 : 0) + (cell.coastal ? 0.1 : 0));
  const winterSeverity = clamp(
    (1 - baseTemperature) * 1.05 + seasonalRange * 0.35 - (cell.coastal ? 0.1 : 0),
  );
  const aridity = clamp(1 - precipitation * 1.1 + Math.max(0, baseTemperature - 0.6) * 0.5);
  const fireRisk = clamp(aridity * 0.6 + Math.min(1, cell.wood / Math.max(1, cell.maxWood)) * 0.5 - 0.25);
  const floodRisk = clamp((cell.river ? 0.5 : 0) + (cell.coastal ? 0.25 : 0) + precipitation * 0.35 - 0.2);
  return {
    baseTemperature: round(baseTemperature),
    seasonalRange: round(seasonalRange),
    precipitation: round(precipitation),
    winterSeverity: round(winterSeverity),
    aridity: round(aridity),
    fireRisk: round(fireRisk),
    floodRisk: round(floodRisk),
  };
}

/**
 * Deterministic four-season breakdown of the current year. `trend` carries the slow drift,
 * the modifier carries the yearly anomaly; the RNG only adds a bounded amount of noise.
 */
export function computeSeasons(state: WorldState, harshWinter: boolean): SeasonState[] {
  const base = state.climate.modifier;
  const trend = state.climate.trend;
  return SEASONS.map((season) => {
    const temperature = clamp(0.5 + SEASON_TEMPERATURE[season] * 0.32 + trend * 0.12 + (base - 1) * 0.3);
    const precipitation = clamp(0.5 + SEASON_RAIN[season] + (base - 1) * 0.6);
    // Growing seasons carry the harvest; winter contributes almost nothing.
    const seasonal =
      season === "winter" ? 0.25 : season === "summer" ? 1.15 : season === "spring" ? 1.05 : 1.1;
    const harsh = season === "winter" && harshWinter ? 0.6 : 1;
    return {
      season,
      temperature: round(temperature),
      precipitation: round(precipitation),
      yield: round(clamp(seasonal * base * harsh, 0, 2)),
    };
  });
}

/** Local production multiplier of one season on one cell. */
export function seasonYieldAt(cell: Cell, seasonState: SeasonState, profile = cellClimate(cell)): number {
  const { season } = seasonState;
  if (season === "winter") {
    // Cold places freeze: almost nothing grows and even foraging is hard.
    return clamp(seasonState.yield * (1 - profile.winterSeverity * 0.85), 0, 2);
  }
  const water = clamp(profile.precipitation * 0.7 + cell.water * 0.5);
  const dry = season === "summer" ? profile.aridity * 0.55 : profile.aridity * 0.3;
  return clamp(seasonState.yield * (0.55 + water * 0.55) * (1 - dry), 0, 2);
}

/**
 * Reference cell used to normalize the seasonal model: a temperate, moderately watered
 * place in an average year. Dividing by its yield makes `annualYieldAt` return ~1 for good
 * land in a normal year, so seasons redistribute production instead of shrinking it.
 */
const REFERENCE_PROFILE: CellClimate = {
  baseTemperature: 0.6,
  seasonalRange: 0.25,
  precipitation: 0.5,
  winterSeverity: 0.45,
  aridity: 0.35,
  fireRisk: 0.2,
  floodRisk: 0.2,
};

const REFERENCE_CELL = { water: 0.55 } as Cell;

function referenceYield(weights: Record<Season, number>, seasons: SeasonState[]): number {
  let total = 0;
  for (const seasonState of seasons) {
    // Neutral climate: the reference must not move with the weather of the year.
    const neutral: SeasonState = {
      ...seasonState,
      yield:
        seasonState.season === "winter"
          ? 0.25
          : seasonState.season === "summer"
            ? 1.15
            : seasonState.season === "spring"
              ? 1.05
              : 1.1,
    };
    total += seasonYieldAt(REFERENCE_CELL, neutral, REFERENCE_PROFILE) * weights[seasonState.season];
  }
  return total;
}

/**
 * Annual production multiplier of a cell: seasons weighted by the labour share of each,
 * normalized against the reference cell. A tundra winter, a drought or a bad year pull it
 * below 1; fertile, well-watered land in a good year pushes it slightly above.
 */
export function annualYieldAt(state: WorldState, cell: Cell, weights: Record<Season, number>): number {
  const profile = cellClimate(cell);
  const seasons = state.climate.seasons.length > 0 ? state.climate.seasons : computeSeasons(state, false);
  let total = 0;
  for (const seasonState of seasons) {
    total += seasonYieldAt(cell, seasonState, profile) * weights[seasonState.season];
  }
  const reference = referenceYield(weights, seasons);
  return round(reference > 0 ? total / reference : total, 4);
}

/** Extra food a group burns because of the cold, 1 = no surcharge. */
export function winterConsumptionFactor(state: WorldState, cell: Cell, config: SimulationConfig): number {
  const profile = cellClimate(cell);
  const winter = state.climate.seasons.find((s) => s.season === "winter");
  // Not capped at 1: an arctic winter has to stay distinguishable from a mild one.
  const severity = clamp(profile.winterSeverity * (winter ? 2 - winter.yield : 1), 0, 1.6);
  const harsh = state.climate.harshWinter ? config.climate.harshWinterSeverity : 1;
  const weight = config.economy.seasonWeights.winter + 0.12;
  return round(1 + (config.climate.winterConsumption - 1) * severity * harsh * (weight / 0.25), 3);
}

/** Extra mortality multiplier caused by winter in this place. */
export function winterMortalityFactor(state: WorldState, cell: Cell): number {
  const profile = cellClimate(cell);
  const harsh = state.climate.harshWinter ? 1.35 : 1;
  return round(1 + profile.winterSeverity * 0.35 * harsh, 3);
}

function hazardId(state: WorldState, kind: HazardKind): string {
  state.counters.crisis += 1;
  return `hz${state.counters.crisis}:${kind}`;
}

/**
 * Step 1 of the tick: global climate, seasons and hazards.
 * Hazards are never spawned "just because": a site is picked by weighted risk, so droughts
 * hit arid regions, floods hit rivers and coasts, fires hit dry woodland.
 */
export function updateClimate(ctx: SimContext) {
  const { state, rng } = ctx;
  const config = state.config;
  const t = state.tick;
  const cycle =
    Math.sin((2 * Math.PI * t) / 37) * config.climate.slowCycleAmplitude +
    Math.sin((2 * Math.PI * t) / 11) * config.climate.fastCycleAmplitude;
  // Very slow drift, bounded: centuries-long warm and cold periods without runaway values.
  const trend = clamp(state.climate.trend + rng.range(-0.02, 0.02) - state.climate.trend * 0.02, -1, 1);
  state.climate.trend = round(trend);
  state.climate.modifier = round(
    clamp(
      1 + cycle + trend * 0.05 + rng.range(-config.climate.yearlyNoise, config.climate.yearlyNoise),
      0.5,
      1.5,
    ),
  );

  state.climate.hazards = state.climate.hazards.filter((h) => h.untilYear >= state.year);
  state.climate.droughts = state.climate.hazards
    .filter((h) => h.kind === "drought")
    .map((h) => ({ x: h.x, y: h.y, radius: h.radius, severity: h.severity, untilYear: h.untilYear }));

  const harshWinter = rng.chance(config.climate.harshWinterChance * (1 - trend * 0.4));
  state.climate.harshWinter = harshWinter;
  state.climate.seasons = computeSeasons(state, harshWinter);
  const winter = state.climate.seasons.find((s) => s.season === "winter");
  state.climate.winterSeverity = round(clamp(winter ? 1 - winter.yield / 0.3 : 0.5, 0, 1));

  if (harshWinter) {
    emitEvent(ctx, {
      type: "climate",
      subtype: "harsh_winter",
      importance: 3,
      actors: [],
      x: null,
      y: null,
      title: "Un inverno eccezionalmente rigido",
      description: `Il gelo è arrivato presto e non ha mollato la presa: le scorte si consumano più in fretta e i più deboli non superano la stagione.`,
      metadata: {
        severity: config.climate.harshWinterSeverity,
        trend: state.climate.trend,
        modifier: state.climate.modifier,
      },
    });
  }

  spawnHazard(ctx, "drought", config.climate.droughtChance * (state.climate.modifier < 0.98 ? 1.6 : 0.7));
  spawnHazard(ctx, "flood", config.climate.floodChance * (state.climate.modifier > 1.02 ? 1.5 : 0.7));
  spawnHazard(ctx, "wildfire", config.climate.wildfireChance * (state.climate.modifier < 1 ? 1.4 : 0.8));
}

function hazardWeight(kind: HazardKind, cell: Cell): number {
  const profile = cellClimate(cell);
  if (cell.biome === "ocean") return 0;
  if (kind === "drought") return profile.aridity ** 2;
  if (kind === "flood") return profile.floodRisk ** 2;
  return profile.fireRisk ** 2 * (cell.wood > 6 ? 1 : 0.1);
}

function spawnHazard(ctx: SimContext, kind: HazardKind, chance: number) {
  const { state, rng } = ctx;
  if (!rng.chance(clamp(chance, 0, 0.5))) return;
  // Candidate sites: inhabited regions first, so a hazard is a story and not noise in the void.
  const anchors = [
    ...state.settlements.filter((s) => s.status === "active").map((s) => ({ x: s.x, y: s.y })),
    ...state.tribes.filter((t) => t.status !== "extinct").map((t) => ({ x: t.x, y: t.y })),
  ];
  if (anchors.length === 0) return;
  const candidates: Cell[] = [];
  const weights: number[] = [];
  for (const anchor of anchors) {
    for (const cell of cellsInRadius(state, anchor.x, anchor.y, 6)) {
      const weight = hazardWeight(kind, cell);
      if (weight <= 0.02) continue;
      candidates.push(cell);
      weights.push(weight);
    }
  }
  if (candidates.length === 0) return;
  const cell = candidates[rng.weightedIndex(weights)];
  if (!cell) return;

  const severity = round(rng.range(0.2, kind === "drought" ? 0.55 : 0.45), 2);
  const years = kind === "drought" ? rng.int(2, 5) : kind === "flood" ? 1 : rng.int(1, 2);
  const hazard: Hazard = {
    id: hazardId(state, kind),
    kind,
    x: cell.x,
    y: cell.y,
    radius: kind === "drought" ? rng.int(5, 12) : rng.int(2, 5),
    severity,
    startYear: state.year,
    untilYear: state.year + years,
    eventId: null,
  };
  state.climate.hazards.push(hazard);
  if (kind === "drought") {
    state.climate.droughts.push({
      x: hazard.x,
      y: hazard.y,
      radius: hazard.radius,
      severity: hazard.severity,
      untilYear: hazard.untilYear,
    });
  }
  applyImmediateDamage(ctx, hazard);

  const affected = state.settlements.filter(
    (s) => s.status === "active" && distance(s.x, s.y, hazard.x, hazard.y) <= hazard.radius,
  );
  const place = describePlace(state, hazard.x, hazard.y);
  const event = emitEvent(ctx, {
    type: "climate",
    subtype: kind,
    importance: affected.length > 0 ? (severity > 0.4 ? 4 : 3) : 2,
    actors: affected.slice(0, 3).map((s) => actor.settlement(s)),
    x: hazard.x,
    y: hazard.y,
    title:
      kind === "drought"
        ? `Siccità su ${place}`
        : kind === "flood"
          ? `Alluvione presso ${place}`
          : `Incendio su ${place}`,
    description:
      kind === "drought"
        ? `Le piogge non sono arrivate: ${place} vive una siccità che durerà circa ${years} anni, riducendo raccolti e selvaggina.`
        : kind === "flood"
          ? `Le acque hanno rotto gli argini presso ${place}: campi sommersi e scorte perdute, ma il limo lascerà terra più fertile.`
          : `Il fuoco ha percorso ${place}, divorando i boschi e la selvaggina nel raggio di ${hazard.radius} celle.`,
    metadata: {
      hazardId: hazard.id,
      kind,
      severity,
      radius: hazard.radius,
      years,
      settlements: affected.length,
      climateModifier: state.climate.modifier,
      cause:
        kind === "drought"
          ? "aridità e anomalia climatica"
          : kind === "flood"
            ? "piogge eccezionali"
            : "siccità e boschi secchi",
    },
  });
  hazard.eventId = event.id;
  state.crises.push({
    id: hazard.id,
    kind,
    scope: "world",
    targetId: null,
    startYear: hazard.startYear,
    untilYear: hazard.untilYear,
    severity,
    eventId: event.id,
  });
}

/** Floods and fires hit the terrain at once; droughts act through `climateAt` while they last. */
function applyImmediateDamage(ctx: SimContext, hazard: Hazard) {
  const { state } = ctx;
  if (hazard.kind === "drought") return;
  for (const cell of cellsInRadius(state, hazard.x, hazard.y, hazard.radius)) {
    if (cell.biome === "ocean") continue;
    if (hazard.kind === "wildfire") {
      cell.wood = round(cell.wood * (1 - hazard.severity), 2);
      cell.fauna = round(cell.fauna * (1 - hazard.severity * 0.7), 2);
      // Ash fertilizes: the land comes back richer a few years later.
      cell.baseFertility = clamp(cell.baseFertility + hazard.severity * 0.05);
    } else {
      cell.fertility = clamp(cell.fertility * (1 - hazard.severity * 0.3));
      cell.baseFertility = clamp(cell.baseFertility + hazard.severity * 0.04);
      cell.fields = Math.max(0, cell.fields - (hazard.severity > 0.35 ? 1 : 0));
    }
  }
  for (const s of state.settlements) {
    if (s.status !== "active" || distance(s.x, s.y, hazard.x, hazard.y) > hazard.radius) continue;
    const loss = hazard.severity * (hazard.kind === "flood" ? 0.35 : 0.2);
    s.stock.food = round(s.stock.food * (1 - loss), 2);
    if (hazard.kind === "wildfire") s.stock.wood = round(s.stock.wood * (1 - hazard.severity), 2);
  }
}

/** Local climate multiplier: global anomaly times any hazard currently covering the cell. */
export function climateAt(state: WorldState, x: number, y: number): number {
  let modifier = state.climate.modifier;
  for (const h of state.climate.hazards) {
    if (h.kind === "flood") continue;
    if (distance(h.x, h.y, x, y) <= h.radius) modifier *= 1 - h.severity * (h.kind === "drought" ? 1 : 0.4);
  }
  return modifier;
}

/** Hazards currently affecting a point, used to explain events. */
export function hazardsAt(state: WorldState, x: number, y: number): Hazard[] {
  return state.climate.hazards.filter((h) => distance(h.x, h.y, x, y) <= h.radius);
}

/** 0..1 index of how much the climate is hurting the world right now. */
export function climateStress(state: WorldState): number {
  const anomaly = Math.abs(1 - state.climate.modifier);
  const hazards = state.climate.hazards.reduce((acc, h) => acc + h.severity, 0) / 3;
  return round(clamp(anomaly * 2 + hazards * 0.5 + (state.climate.harshWinter ? 0.15 : 0)), 3);
}

export function averageTemperature(state: WorldState): number {
  if (state.climate.seasons.length === 0) return 0.5;
  return round(
    state.climate.seasons.reduce((acc, s) => acc + s.temperature, 0) / state.climate.seasons.length,
    3,
  );
}
