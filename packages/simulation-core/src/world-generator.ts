import { createPerson } from "./agents";
import { computeSeasons } from "./climate";
import { parseSimulationConfig, type SimulationConfig } from "./config";
import { DEFAULT_SETTINGS, TRIBE_COLORS } from "./constants";
import { nextId } from "./context";
import { initialStability, randomCulture } from "./culture";
import { cellsInRadius, clamp, distance } from "./grid";
import { tribeName } from "./names";
import { SIMULATION_VERSION } from "./normalize";
import { deriveRng, Rng } from "./prng";
import { emptyStock } from "./stock";
import { generateTerrain } from "./terrain";
import type { Cell, Household, Person, Tribe, WorldSettings, WorldState } from "./types";

export interface CreateWorldOptions {
  seed: string;
  width?: number;
  height?: number;
  settings?: Partial<WorldSettings>;
  /** Partial simulation configuration; missing values fall back to the defaults. */
  config?: unknown;
}

function areaScore(state: WorldState, cell: Cell): number {
  const area = cellsInRadius(state, cell.x, cell.y, 2);
  const land = area.filter((c) => c.biome !== "ocean");
  const avg = land.reduce((acc, c) => acc + c.habitability, 0) / Math.max(1, area.length);
  return cell.habitability * 0.5 + avg * 0.5;
}

/** Picks well-separated habitable starting cells; relaxes the spacing only if the map is too cramped. */
export function pickStartingCells(state: WorldState, count: number, rng: Rng): Cell[] {
  const candidates = state.cells
    .filter((c) => c.biome !== "ocean" && c.biome !== "mountain" && c.habitability >= 0.45)
    .map((c) => ({ cell: c, score: areaScore(state, c) }))
    .filter((c) => c.score >= 0.4);
  let minDistance = Math.max(7, Math.floor(Math.min(state.width, state.height) / 4));
  while (minDistance >= 3) {
    const chosen: Cell[] = [];
    const pool = [...candidates];
    while (chosen.length < count && pool.length > 0) {
      const idx = rng.weightedIndex(pool.map((c) => c.score ** 3));
      const [pick] = pool.splice(idx, 1);
      if (!pick) break;
      if (chosen.every((c) => distance(c.x, c.y, pick.cell.x, pick.cell.y) >= minDistance))
        chosen.push(pick.cell);
    }
    if (chosen.length === count) return chosen;
    minDistance -= 1;
  }
  throw new Error("La mappa generata non ha abbastanza celle abitabili per le tribù iniziali");
}

export function createWorld(options: CreateWorldOptions): WorldState {
  const settings: WorldSettings = {
    ...DEFAULT_SETTINGS,
    ...options.settings,
    width: options.width ?? options.settings?.width ?? DEFAULT_SETTINGS.width,
    height: options.height ?? options.settings?.height ?? DEFAULT_SETTINGS.height,
  };
  const seed = options.seed;
  const cells = generateTerrain(seed, settings.width, settings.height);
  const rng = deriveRng(seed, "simulation");
  const state: WorldState = {
    seed,
    width: settings.width,
    height: settings.height,
    tick: 0,
    year: settings.startYear,
    rng: rng.getState(),
    simulationVersion: SIMULATION_VERSION,
    config: parseSimulationConfig(options.config) satisfies SimulationConfig,
    settings,
    counters: {
      person: 0,
      tribe: 0,
      settlement: 0,
      civilization: 0,
      household: 0,
      event: 0,
      dynasty: 0,
      construction: 0,
      crisis: 0,
    },
    climate: {
      modifier: 1,
      droughts: [],
      hazards: [],
      trend: 0,
      seasons: [],
      harshWinter: false,
      winterSeverity: 0.5,
    },
    cells,
    people: [],
    tribes: [],
    settlements: [],
    civilizations: [],
    households: [],
    relationships: [],
    dynasties: [],
    crises: [],
    archive: { people: [], households: [] },
  };
  state.climate.seasons = computeSeasons(state, false);

  const tribeCount = rng.int(settings.minTribes, settings.maxTribes);
  const starts = pickStartingCells(state, tribeCount, rng);
  const usedNames = new Set<string>();
  for (const cell of starts) {
    let name = tribeName(rng);
    while (usedNames.has(name)) name = tribeName(rng);
    usedNames.add(name);
    const { id, seq } = nextId(state, "tribe", "t");
    const tribe: Tribe = {
      id,
      seq,
      name,
      color: TRIBE_COLORS[(seq - 1) % TRIBE_COLORS.length] ?? "#ffffff",
      status: "nomadic",
      x: cell.x,
      y: cell.y,
      stock: emptyStock(),
      techs: [],
      techProgress: {},
      techAdoption: {},
      yearsAtLocation: 0,
      scarcityYears: 0,
      foundedYear: state.year,
      extinctYear: null,
      civilizationId: null,
      leaderId: null,
      parentTribeId: null,
      morale: 0.7,
      populationMilestone: 0,
      lastFoodProduced: 0,
      lastFoodConsumed: 0,
      lastFoodRatio: 1,
      culture: randomCulture(rng),
      government: "clan",
      stability: initialStability(),
      distribution: parseSimulationConfig(options.config).economy.defaultDistribution,
      dynastyId: null,
      lastLeaderChangeYear: null,
    };
    state.tribes.push(tribe);
    const members = populateTribe(state, tribe, rng.int(settings.minTribeSize, settings.maxTribeSize), rng);
    tribe.stock.food = Math.round(members.length * 0.5);
    const leader = members
      .filter((p) => p.age >= 20 && p.age < 60)
      .sort(
        (a, b) =>
          b.personality.cooperation +
            b.personality.sociability -
            (a.personality.cooperation + a.personality.sociability) || a.seq - b.seq,
      )[0];
    if (leader) {
      tribe.leaderId = leader.id;
      leader.role = "leader";
      leader.notable = true;
      leader.title = "chief";
      leader.titleSinceYear = state.year;
      leader.prestige = clamp(leader.prestige + 0.4);
      leader.skills.leadership = clamp(leader.skills.leadership + 0.2);
    }
  }
  return state;
}

function populateTribe(state: WorldState, tribe: Tribe, size: number, rng: Rng): Person[] {
  const members: Person[] = [];
  const adults: Person[] = [];
  for (let i = 0; i < size; i++) {
    const r = rng.next();
    const age = r < 0.3 ? rng.int(0, 15) : r < 0.9 ? rng.int(16, 45) : rng.int(46, 65);
    const { id, seq } = nextId(state, "person", "p");
    const person = createPerson(rng, {
      id,
      seq,
      tribeId: tribe.id,
      settlementId: null,
      x: tribe.x,
      y: tribe.y,
      age,
      sex: rng.chance(0.5) ? "M" : "F",
      birthYear: state.year - age,
      knowledge: [],
    });
    person.health = clamp(person.health);
    members.push(person);
    if (age >= 16) adults.push(person);
  }
  // Initial couples: pair adults of opposite sex, children join a random household.
  const men = adults.filter((p) => p.sex === "M" && p.age <= 55);
  const women = adults.filter((p) => p.sex === "F" && p.age <= 50);
  const households: Household[] = [];
  const pairs = Math.min(men.length, women.length);
  for (let i = 0; i < pairs; i++) {
    const a = men[i];
    const b = women[i];
    if (!a || !b || !rng.chance(0.8)) continue;
    const { id, seq } = nextId(state, "household", "h");
    const household: Household = {
      id,
      seq,
      tribeId: tribe.id,
      partnerIds: [a.id, b.id],
      formedYear: state.year,
      dissolvedYear: null,
    };
    a.householdId = id;
    b.householdId = id;
    households.push(household);
  }
  for (const child of members.filter((p) => p.age < 16)) {
    if (households.length === 0) break;
    const household = rng.pick(households);
    child.householdId = household.id;
    child.motherId = household.partnerIds[1];
    child.fatherId = household.partnerIds[0];
  }
  state.households.push(...households);
  state.people.push(...members);
  return members;
}
