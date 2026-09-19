import { createPerson } from "./agents";
import { computeSeasons } from "./climate";
import { parseSimulationConfig, type SimulationConfig } from "./config";
import { DEFAULT_SETTINGS, TRIBE_COLORS } from "./constants";
import { nextId } from "./context";
import { initialStability, randomCulture } from "./culture";
import { cellsInRadius, clamp, distance } from "./grid";
import {
  applyIdentityModifiers,
  IDENTITY_CATALOG_VERSION,
  identityPlaceName,
  maxRosterSize,
  parseRosterConfig,
  resolveRosterIdentities,
  STARTING_CIVILIZATION_STATE,
  type CivilizationRosterConfigInput,
  type HistoricalIdentityDefinition,
  type NamingProfile,
  type RosterEntry,
} from "./identity";
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
  /**
   * Civilization roster. Omitted (or `mode: "procedural"`): classic invented tribes, exactly as
   * before identities existed. Otherwise historical identities with a uniform start.
   */
  roster?: CivilizationRosterConfigInput;
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

/** Fresh water within one cell: a river, the coast or a well-watered cell. */
export function hasWaterAccess(state: WorldState, cell: Cell): boolean {
  return cellsInRadius(state, cell.x, cell.y, 1).some(
    (c) => c.biome !== "ocean" && (c.river || c.coastal || c.water >= 0.5),
  );
}

export function startingAreaQuality(state: WorldState, cell: Cell): number {
  return areaScore(state, cell);
}

/**
 * Competitive placement: every starting point has water within reach and a land quality
 * inside a narrow band, the best band the map can host with the required spacing. Identities
 * play no part here (no one is placed in "their" historical region), and nothing is compensated
 * later: whatever differences remain are part of the world.
 */
export function pickBalancedStartingCells(state: WorldState, count: number, rng: Rng): Cell[] {
  const base = state.cells
    .filter((c) => c.biome !== "ocean" && c.biome !== "mountain" && c.habitability >= 0.45)
    .map((c) => ({ cell: c, score: areaScore(state, c), water: hasWaterAccess(state, c) }))
    .filter((c) => c.score >= 0.4);
  for (const requireWater of [true, false]) {
    const candidates = base.filter((c) => !requireWater || c.water).sort((a, b) => b.score - a.score);
    if (candidates.length < count) continue;
    let minDistance = Math.max(7, Math.floor(Math.min(state.width, state.height) / 4));
    while (minDistance >= 3) {
      for (const tolerance of [0.05, 0.08, 0.12, 0.18]) {
        for (let q = 0; q < 10; q++) {
          const anchor = candidates[Math.floor((candidates.length * q) / 10)];
          if (!anchor) break;
          const pool = candidates.filter(
            (c) => c.score <= anchor.score && c.score >= anchor.score - tolerance,
          );
          if (pool.length < count) continue;
          const chosen: Cell[] = [];
          for (const pick of rng.shuffle([...pool])) {
            if (chosen.every((c) => distance(c.x, c.y, pick.cell.x, pick.cell.y) >= minDistance))
              chosen.push(pick.cell);
            if (chosen.length === count) return chosen;
          }
        }
      }
      minDistance -= 1;
    }
  }
  return pickStartingCells(state, count, rng);
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
    roster: null,
  };
  state.climate.seasons = computeSeasons(state, false);

  const rosterConfig = options.roster ? parseRosterConfig(options.roster) : null;
  if (rosterConfig && rosterConfig.mode !== "procedural") {
    const identities = resolveRosterIdentities(seed, rosterConfig);
    populateHistoricalWorld(state, identities, rosterConfig, rng);
    return state;
  }

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
      identityId: null,
      identityType: "procedural",
      absorbedIdentityIds: [],
      absorbedByTribeId: null,
    };
    state.tribes.push(tribe);
    const members = populateTribe(state, tribe, rng.int(settings.minTribeSize, settings.maxTribeSize), rng);
    tribe.stock.food = Math.round(members.length * 0.5);
    installFirstLeader(state, tribe, members);
  }
  return state;
}

/** The founding leader: the most cooperative and sociable adult, as for every band. */
function installFirstLeader(state: WorldState, tribe: Tribe, members: Person[]): Person | null {
  const leader = members
    .filter((p) => p.age >= 20 && p.age < 60)
    .sort(
      (a, b) =>
        b.personality.cooperation +
          b.personality.sociability -
          (a.personality.cooperation + a.personality.sociability) || a.seq - b.seq,
    )[0];
  if (!leader) return null;
  tribe.leaderId = leader.id;
  leader.role = "leader";
  leader.notable = true;
  leader.title = "chief";
  leader.titleSinceYear = state.year;
  leader.prestige = clamp(leader.prestige + 0.4);
  leader.skills.leadership = clamp(leader.skills.leadership + 0.2);
  return leader;
}

/**
 * Historical world: one political instance per roster slot, all from the same starting state.
 * Identity decides name, palette, emblem and naming; the RNG stream only sees the slots, so
 * which identity fills a slot cannot change the world around it.
 */
function populateHistoricalWorld(
  state: WorldState,
  identities: HistoricalIdentityDefinition[],
  config: ReturnType<typeof parseRosterConfig>,
  rng: Rng,
) {
  const { settings } = state;
  if (identities.length > maxRosterSize(state.width, state.height))
    throw new Error(
      `Posizioni di partenza insufficienti: ${identities.length} civiltà su una mappa ${state.width}×${state.height}`,
    );
  const starts = config.balancedPlacement
    ? pickBalancedStartingCells(state, identities.length, rng)
    : pickStartingCells(state, identities.length, rng);
  const sharedSize = config.equalStartingLevel ? rng.int(settings.minTribeSize, settings.maxTribeSize) : null;
  const usedNames = new Set<string>();
  const usedPlaces = new Set<string>();
  const usedColors = new Set<string>();
  const entries: RosterEntry[] = [];
  const start = STARTING_CIVILIZATION_STATE;
  identities.forEach((identity, slot) => {
    const cell = starts[slot];
    if (!cell) throw new Error("Posizioni di partenza insufficienti per il roster");
    const { id, seq } = nextId(state, "tribe", "t");
    const homeName = identityPlaceName(identity.namingProfile, `${state.seed}:${id}:home`, usedPlaces);
    usedPlaces.add(homeName);
    // A duplicated identity (only when explicitly allowed) is named after its home, never "Egizi" twice.
    const name = usedNames.has(identity.displayName)
      ? `${identity.displayName} di ${homeName}`
      : identity.displayName;
    usedNames.add(name);
    const color =
      [identity.visualProfile.primaryColor, identity.visualProfile.secondaryColor].find(
        (c) => !usedColors.has(c),
      ) ??
      TRIBE_COLORS[(seq - 1) % TRIBE_COLORS.length] ??
      "#ffffff";
    usedColors.add(color);
    const tribe: Tribe = {
      id,
      seq,
      name,
      color,
      status: "nomadic",
      x: cell.x,
      y: cell.y,
      stock: emptyStock(),
      techs: [...start.technologies],
      techProgress: {},
      techAdoption: Object.fromEntries(start.technologies.map((t) => [t, 1])),
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
      culture: applyIdentityModifiers(randomCulture(rng), identity, config.enableIdentityModifiers),
      government: start.government,
      stability: initialStability(),
      distribution: state.config.economy.defaultDistribution,
      dynastyId: null,
      lastLeaderChangeYear: null,
      identityId: identity.key,
      identityType: "historical",
      absorbedIdentityIds: [],
      absorbedByTribeId: null,
    };
    state.tribes.push(tribe);
    const size = sharedSize ?? rng.int(settings.minTribeSize, settings.maxTribeSize);
    const members = populateTribe(state, tribe, size, rng, identity.namingProfile, [...start.technologies]);
    tribe.stock.food = Math.round(members.length * start.foodPerCapita);
    const leader = installFirstLeader(state, tribe, members);
    entries.push({
      slot,
      identityId: identity.key,
      tribeId: id,
      displayName: name,
      color,
      emblemKey: identity.visualProfile.emblemKey,
      startX: cell.x,
      startY: cell.y,
      startQuality: Math.round(areaScore(state, cell) * 1000) / 1000,
      startWater: hasWaterAccess(state, cell),
      population: members.length,
      initialLeaderId: leader?.id ?? null,
      initialLeaderName: leader?.name ?? null,
      homeName,
    });
  });
  state.roster = { config, catalogVersion: IDENTITY_CATALOG_VERSION, entries };
}

function populateTribe(
  state: WorldState,
  tribe: Tribe,
  size: number,
  rng: Rng,
  naming: NamingProfile | null = null,
  knowledge: string[] = [],
): Person[] {
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
      knowledge,
      naming,
      nameSeed: `${state.seed}:${id}`,
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
