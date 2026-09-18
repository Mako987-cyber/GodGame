import { DEFAULT_SIMULATION_CONFIG, parseSimulationConfig, type DistributionPolicy } from "./config";
import { BUILDING_TYPES, DEFAULT_SETTINGS } from "./constants";
import { clamp, round } from "./grid";
import { hashFloat } from "./prng";
import { emptyStock, normalizeStock } from "./stock";
import type {
  ActiveCrisis,
  Cell,
  Climate,
  ConstructionProject,
  Counters,
  CultureTraits,
  Dynasty,
  GovernmentType,
  HistoricalEvent,
  Person,
  Relationship,
  Settlement,
  SettlementTier,
  Skills,
  Stability,
  Tribe,
  WorldState,
} from "./types";

/**
 * Backwards compatibility layer.
 *
 * Worlds created by earlier versions of the engine are still in the database: this module
 * fills every field introduced later with a deterministic default, so a legacy world keeps
 * running (and keeps producing the same results) without any destructive migration.
 */
export const SIMULATION_VERSION = 2;

/** Deposits added with the extended economy, derived from the terrain so legacy maps stay stable. */
export function deriveDeposits(seed: string, cell: Cell): { clay: number; tin: number; coal: number } {
  if (cell.biome === "ocean") return { clay: 0, tin: 0, coal: 0 };
  const key = `${seed}:${cell.x}:${cell.y}`;
  const rClay = hashFloat(`${key}:clay`);
  const rTin = hashFloat(`${key}:tin`);
  const rCoal = hashFloat(`${key}:coal`);
  // Clay forms where water meets soil: riverbanks, coasts and damp plains.
  const clayPotential = (cell.river ? 1 : cell.coastal ? 0.7 : 0) * 0.6 + cell.moisture * 0.5;
  const clay = clayPotential > 0.45 && rClay < clayPotential ? Math.round(30 + rClay * 70) : 0;
  // Tin is rare and bound to hills and mountains.
  const tin =
    (cell.biome === "hills" || cell.biome === "mountain") && rTin < 0.07 ? Math.round(20 + rTin * 400) : 0;
  // Fuel-grade coal/peat: mountains, hills and damp forests.
  const coalPotential =
    cell.biome === "mountain" ? 0.12 : cell.biome === "hills" ? 0.09 : cell.biome === "forest" ? 0.05 : 0;
  const coal = rCoal < coalPotential ? Math.round(25 + rCoal * 500) : 0;
  return { clay, tin, coal };
}

export function normalizeCell(seed: string, cell: Cell): Cell {
  // A legacy row has no value at all for these columns: Postgres returns `null`, an old
  // snapshot returns `undefined`. Both mean "never computed", so both are derived here.
  if (cell.clay == null || cell.tin == null || cell.coal == null) {
    const derived = deriveDeposits(seed, cell);
    cell.clay ??= derived.clay;
    cell.tin ??= derived.tin;
    cell.coal ??= derived.coal;
  }
  cell.pastures ??= 0;
  return cell;
}

export function normalizeSkills(skills: Partial<Skills> | undefined): Skills {
  const gathering = num(skills?.gathering, 0.3);
  const hunting = num(skills?.hunting, 0.3);
  const building = num(skills?.building, 0.3);
  const combat = num(skills?.combat, 0.3);
  const crafting = num(skills?.crafting, 0.3);
  return {
    gathering,
    hunting,
    building,
    combat,
    crafting,
    leadership: num(skills?.leadership, round((gathering + building + crafting) / 3, 3)),
  };
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePerson(person: Person): Person {
  person.skills = normalizeSkills(person.skills);
  person.prestige ??= round(clamp(person.notable ? 0.45 : 0.1 + person.personality.sociability * 0.1), 3);
  person.education ??= round(clamp(person.knowledge.length * 0.05), 3);
  person.wealth ??= 0;
  // `undefined` means "field never existed" (legacy row); an explicit null must be preserved,
  // otherwise reloading a world would invent a birthplace and break replay determinism.
  if (person.birthSettlementId === undefined) person.birthSettlementId = person.settlementId;
  if (person.dynastyId === undefined) person.dynastyId = null;
  if (person.title === undefined) person.title = null;
  if (person.titleSinceYear === undefined) person.titleSinceYear = null;
  return person;
}

/** Culture of a legacy tribe: stable pseudo-random traits derived from the world seed and the tribe id. */
export function deriveCulture(seed: string, tribeId: string): CultureTraits {
  const trait = (name: string, mean = 50, spread = 22) =>
    Math.round(clamp(mean + (hashFloat(`${seed}:${tribeId}:${name}`) - 0.5) * 2 * spread, 5, 95));
  return {
    cooperation: trait("cooperation", 55),
    militarism: trait("militarism", 45),
    tradeOpenness: trait("trade", 50),
    traditionalism: trait("tradition", 60),
    centralization: trait("centralization", 35),
    hierarchy: trait("hierarchy", 35),
    spirituality: trait("spirituality", 50),
    innovation: trait("innovation", 45),
    expansionism: trait("expansionism", 45),
  };
}

export function defaultStability(): Stability {
  return {
    happiness: 0.6,
    cohesion: 0.65,
    legitimacy: 0.6,
    tension: 0.15,
    order: 0.65,
    corruption: 0.08,
    revoltRisk: 0.05,
    unrestYears: 0,
  };
}

export function normalizeTribe(seed: string, tribe: Tribe): Tribe {
  tribe.stock = normalizeStock(tribe.stock);
  tribe.techAdoption ??= Object.fromEntries(tribe.techs.map((id) => [id, 1]));
  for (const id of tribe.techs) tribe.techAdoption[id] ??= 1;
  tribe.culture ??= deriveCulture(seed, tribe.id);
  tribe.government ??= inferGovernment(tribe);
  tribe.stability ??= defaultStability();
  tribe.distribution ??= "egalitarian" satisfies DistributionPolicy;
  if (tribe.dynastyId === undefined) tribe.dynastyId = null;
  if (tribe.lastLeaderChangeYear === undefined) tribe.lastLeaderChangeYear = null;
  return tribe;
}

function inferGovernment(tribe: Tribe): GovernmentType {
  if (tribe.status === "settled" && tribe.techs.includes("writing")) return "city_state";
  if (tribe.status === "settled") return "chiefdom";
  return "clan";
}

const LEGACY_TIERS: SettlementTier[] = ["camp", "village", "town", "city_state", "capital"];

export function tierFromLevel(level: number): SettlementTier {
  return LEGACY_TIERS[Math.min(LEGACY_TIERS.length - 1, Math.max(0, level - 1))] ?? "camp";
}

export function normalizeSettlement(settlement: Settlement): Settlement {
  settlement.stock = normalizeStock(settlement.stock);
  settlement.lastProduction = normalizeStock(settlement.lastProduction);
  const buildings = settlement.buildings as Partial<Record<string, number>>;
  for (const type of BUILDING_TYPES) buildings[type] ??= 0;
  settlement.tier ??= tierFromLevel(settlement.level);
  settlement.hygiene ??= 0.7;
  settlement.unrest ??= 0.05;
  settlement.influence ??= settlement.level;
  if (settlement.founderId === undefined) settlement.founderId = null;
  if (settlement.lastEpidemicYear === undefined) settlement.lastEpidemicYear = null;
  settlement.construction = normalizeConstruction(settlement);
  return settlement;
}

/** Converts the pre-2.0 `{ type, progress, required, targetId }` shape into a full project. */
export function normalizeConstruction(settlement: Settlement): ConstructionProject | null {
  const project = settlement.construction as (ConstructionProject & { type?: string }) | null;
  if (!project) return null;
  if (project.buildingType && project.id) {
    project.requiredResources ??= {};
    project.deliveredResources ??= {};
    project.status ??= "building";
    return project;
  }
  const buildingType = (project.buildingType ?? project.type ?? "hut") as ConstructionProject["buildingType"];
  return {
    id: `cp:${settlement.id}:${buildingType}`,
    settlementId: settlement.id,
    buildingType,
    cellId: `${settlement.x},${settlement.y}`,
    requiredResources: {},
    deliveredResources: {},
    laborRequired: num(project.required, 10),
    laborCompleted: num(project.progress, 0),
    startedAtTick: 0,
    status: "building",
    targetId: project.targetId ?? null,
  };
}

export function normalizeRelationship(rel: Relationship): Relationship {
  rel.respect ??= round(clamp(rel.trust * 0.5 + rel.conflictMemory * 0.3), 3);
  rel.tradeDependency ??= round(clamp(rel.tradeVolume / 400), 3);
  rel.culturalDistance ??= 0.3;
  rel.phase ??= rel.atWar ? "war" : rel.truceUntilYear ? "truce" : "peace";
  rel.phaseYears ??= 0;
  if (rel.lastConflictYear === undefined) rel.lastConflictYear = rel.battles > 0 ? rel.warStartYear : null;
  rel.status ??= rel.atWar
    ? "war"
    : rel.allied
      ? "allied"
      : rel.tradeVolume > 20
        ? "trade_partner"
        : rel.hostility > 0.5
          ? "rival"
          : "contact";
  return rel;
}

export function normalizeClimate(climate: Climate | undefined): Climate {
  const base: Climate = climate ?? {
    modifier: 1,
    droughts: [],
    hazards: [],
    trend: 0,
    seasons: [],
    harshWinter: false,
    winterSeverity: 0.5,
  };
  base.droughts ??= [];
  base.trend ??= 0;
  base.seasons ??= [];
  base.harshWinter ??= false;
  base.winterSeverity ??= 0.5;
  if (!base.hazards) {
    // Legacy droughts become hazards so the new pipeline keeps honouring them.
    base.hazards = base.droughts.map((d, i) => ({
      id: `hz-legacy-${i}`,
      kind: "drought" as const,
      x: d.x,
      y: d.y,
      radius: d.radius,
      severity: d.severity,
      startYear: d.untilYear - 3,
      untilYear: d.untilYear,
      eventId: null,
    }));
  }
  return base;
}

export function normalizeCounters(counters: Partial<Counters> | undefined): Counters {
  return {
    person: num(counters?.person, 0),
    tribe: num(counters?.tribe, 0),
    settlement: num(counters?.settlement, 0),
    civilization: num(counters?.civilization, 0),
    household: num(counters?.household, 0),
    event: num(counters?.event, 0),
    dynasty: num(counters?.dynasty, 0),
    construction: num(counters?.construction, 0),
    crisis: num(counters?.crisis, 0),
  };
}

export function normalizeEvent(event: HistoricalEvent): HistoricalEvent {
  event.subtype ??= null;
  event.causeEventIds ??= [];
  return event;
}

/**
 * Brings a world state loaded from any previous version up to the current one.
 * Idempotent: running it on an already current state changes nothing.
 */
export function migrateState(state: WorldState): WorldState {
  state.simulationVersion ??= 1;
  state.config = parseSimulationConfig(state.config ?? DEFAULT_SIMULATION_CONFIG);
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  state.counters = normalizeCounters(state.counters);
  state.climate = normalizeClimate(state.climate);
  state.dynasties ??= [] as Dynasty[];
  state.crises ??= [] as ActiveCrisis[];
  state.archive ??= { people: [], households: [] };
  for (const cell of state.cells) normalizeCell(state.seed, cell);
  for (const person of state.people) normalizePerson(person);
  for (const person of state.archive.people) normalizePerson(person);
  for (const tribe of state.tribes) normalizeTribe(state.seed, tribe);
  for (const settlement of state.settlements) normalizeSettlement(settlement);
  for (const rel of state.relationships) normalizeRelationship(rel);
  // Dynasties of legacy worlds start from the tribes that already have a leader.
  if (state.simulationVersion < SIMULATION_VERSION) state.simulationVersion = SIMULATION_VERSION;
  return state;
}

export function emptyStockpile() {
  return emptyStock();
}
