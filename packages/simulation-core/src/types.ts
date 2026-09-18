import type { DistributionPolicy, Season, SimulationConfig } from "./config";
import type { RngState } from "./prng";
import type { GoodsBag, ResourceBundle, Stockpile } from "./stock";

export type { Stockpile, ResourceBundle, GoodsBag };

export type Biome = "ocean" | "coast" | "plains" | "forest" | "hills" | "mountain" | "desert" | "tundra";

export interface Cell {
  x: number;
  y: number;
  altitude: number;
  moisture: number;
  temperature: number;
  biome: Biome;
  /** Current soil fertility (0..1); intensive farming lowers it, fallow land recovers toward baseFertility. */
  fertility: number;
  baseFertility: number;
  /** Fresh water availability (0..1). */
  water: number;
  wood: number;
  maxWood: number;
  stone: number;
  /** Natural food (game + wild plants); regenerates logistically, collapses under overuse. */
  fauna: number;
  maxFauna: number;
  copper: number;
  iron: number;
  /** Deposits introduced with the extended economy; derived on load for pre-existing worlds. */
  clay: number;
  tin: number;
  coal: number;
  habitability: number;
  river: boolean;
  riverName: string | null;
  coastal: boolean;
  ownerTribeId: string | null;
  settlementId: string | null;
  road: boolean;
  /** Number of farm fields worked on this cell. */
  fields: number;
  /** Number of pastures worked on this cell. */
  pastures: number;
}

/** Climate profile of a cell, derived deterministically from terrain: never persisted. */
export interface CellClimate {
  /** Mean annual temperature, 0 (polar) .. 1 (tropical). */
  baseTemperature: number;
  /** Half-amplitude of the seasonal temperature swing. */
  seasonalRange: number;
  /** Mean annual precipitation, 0..1. */
  precipitation: number;
  /** How hard winter hits here, 0..1. */
  winterSeverity: number;
  /** How dry the place is, 0..1. */
  aridity: number;
  /** Probability weight of a wildfire, 0..1. */
  fireRisk: number;
  /** Probability weight of a flood, 0..1. */
  floodRisk: number;
}

export type Sex = "M" | "F";

export type Role =
  | "child"
  | "gatherer"
  | "hunter"
  | "builder"
  | "elder"
  | "leader"
  | "farmer"
  | "warrior"
  | "herder"
  | "fisher"
  | "miner"
  | "crafter";

export type Action =
  | "rest"
  | "gather"
  | "hunt"
  | "farm"
  | "move"
  | "build"
  | "socialize"
  | "join_group"
  | "reproduce"
  | "defend"
  | "herd"
  | "fish"
  | "mine"
  | "craft";

export interface Skills {
  gathering: number;
  hunting: number;
  building: number;
  combat: number;
  crafting: number;
  /** Added with the leadership model; defaults to the average of the others when missing. */
  leadership: number;
}

export interface Personality {
  aggression: number;
  cooperation: number;
  curiosity: number;
  riskTolerance: number;
  sociability: number;
}

export type DeathCause = "natural" | "starvation" | "conflict" | "illness" | "epidemic" | "disaster";

/** Public role a person holds inside their group. */
export type PersonTitle = "chief" | "elder" | "commander" | "founder" | "ruler" | "inventor";

export interface Person {
  id: string;
  seq: number;
  name: string;
  tribeId: string;
  settlementId: string | null;
  householdId: string | null;
  motherId: string | null;
  fatherId: string | null;
  birthYear: number;
  age: number;
  sex: Sex;
  health: number;
  hunger: number;
  energy: number;
  x: number;
  y: number;
  role: Role;
  action: Action;
  skills: Skills;
  personality: Personality;
  alive: boolean;
  deathYear: number | null;
  deathCause: DeathCause | null;
  /** Technology ids this person carries: they spread knowledge when joining other groups. */
  knowledge: string[];
  lastChildYear: number | null;
  notable: boolean;
  /** Social standing, 0..1: grows with deeds, inherited in part from the parents. */
  prestige: number;
  /** Accumulated knowledge, 0..1: raises innovation and leadership quality. */
  education: number;
  /** Personal movable wealth; inherited by children and partner on death. */
  wealth: number;
  birthSettlementId: string | null;
  dynastyId: string | null;
  title: PersonTitle | null;
  titleSinceYear: number | null;
}

export type TribeStatus = "nomadic" | "settled" | "extinct";

/** Culture traits, each normalized 0..100. Procedurally generated: never modelled on real peoples. */
export interface CultureTraits {
  cooperation: number;
  militarism: number;
  tradeOpenness: number;
  traditionalism: number;
  centralization: number;
  hierarchy: number;
  spirituality: number;
  innovation: number;
  expansionism: number;
}

export type GovernmentType =
  "clan" | "elder_council" | "chiefdom" | "tribal_monarchy" | "city_state" | "merchant_republic";

/** Internal stability indicators, each 0..1 (except unrestYears). */
export interface Stability {
  happiness: number;
  cohesion: number;
  legitimacy: number;
  tension: number;
  order: number;
  corruption: number;
  revoltRisk: number;
  /** Consecutive years spent above the revolt threshold. */
  unrestYears: number;
}

export interface Tribe {
  id: string;
  seq: number;
  name: string;
  color: string;
  status: TribeStatus;
  x: number;
  y: number;
  stock: Stockpile;
  techs: string[];
  techProgress: Record<string, number>;
  /** Adoption progress (0..1) of technologies already known but not yet fully in use. */
  techAdoption: Record<string, number>;
  yearsAtLocation: number;
  scarcityYears: number;
  foundedYear: number;
  extinctYear: number | null;
  civilizationId: string | null;
  leaderId: string | null;
  parentTribeId: string | null;
  morale: number;
  populationMilestone: number;
  lastFoodProduced: number;
  lastFoodConsumed: number;
  /** Food ratio (eaten / needed) of the band in the previous year. */
  lastFoodRatio: number;
  culture: CultureTraits;
  government: GovernmentType;
  stability: Stability;
  distribution: DistributionPolicy;
  dynastyId: string | null;
  lastLeaderChangeYear: number | null;
}

export interface Dynasty {
  id: string;
  seq: number;
  name: string;
  tribeId: string;
  founderId: string;
  foundedYear: number;
  endedYear: number | null;
  prestige: number;
  rulers: number;
}

export type BuildingType =
  | "camp"
  | "hut"
  | "storehouse"
  | "farm"
  | "road"
  | "palisade"
  | "pasture"
  | "well"
  | "quarry"
  | "mine"
  | "kiln"
  | "foundry"
  | "market"
  | "temple"
  | "barracks"
  | "walls"
  | "port";

export type ConstructionStatus = "planned" | "building" | "paused" | "completed" | "abandoned";

export interface ConstructionProject {
  id: string;
  settlementId: string;
  buildingType: BuildingType;
  cellId: string;
  requiredResources: ResourceBundle;
  deliveredResources: ResourceBundle;
  laborRequired: number;
  laborCompleted: number;
  startedAtTick: number;
  status: ConstructionStatus;
  /** For roads and ports: the settlement the work connects to. */
  targetId: string | null;
  /** Legacy alias of buildingType, kept so older snapshots keep deserializing. */
  type?: BuildingType;
  progress?: number;
  required?: number;
}

export type SettlementStatus = "active" | "abandoned";

export type SettlementTier = "camp" | "village" | "town" | "city_state" | "capital";

export interface Settlement {
  id: string;
  seq: number;
  name: string;
  tribeId: string;
  civilizationId: string | null;
  x: number;
  y: number;
  level: number;
  tier: SettlementTier;
  status: SettlementStatus;
  foundedYear: number;
  abandonedYear: number | null;
  stock: Stockpile;
  buildings: Record<BuildingType, number>;
  construction: ConstructionProject | null;
  defense: number;
  territoryRadius: number;
  famineYears: number;
  roadLinks: string[];
  lastProduction: Stockpile;
  lastFoodRatio: number;
  population: number;
  /** Sanitary conditions, 0..1: falls with density, rises with wells and knowledge. */
  hygiene: number;
  /** Local discontent, 0..1. */
  unrest: number;
  /** Political weight used to claim territory. */
  influence: number;
  founderId: string | null;
  /** Years since the last epidemic, used to avoid repeated outbreaks. */
  lastEpidemicYear: number | null;
}

export interface Civilization {
  id: string;
  seq: number;
  name: string;
  color: string;
  founderTribeId: string;
  capitalSettlementId: string | null;
  foundedYear: number;
  status: "active" | "collapsed";
}

export interface Household {
  id: string;
  seq: number;
  tribeId: string;
  partnerIds: [string, string];
  formedYear: number;
  dissolvedYear: number | null;
}

export type DiplomaticStatus =
  "unknown" | "contact" | "neutral" | "trade_partner" | "allied" | "rival" | "war" | "truce";

/** Escalation ladder walked before an actual war breaks out. */
export type ConflictPhase = "peace" | "tension" | "demand" | "threat" | "raid" | "war" | "truce";

export interface Relationship {
  /** `${aId}|${bId}` with aId < bId (by tribe seq). */
  id: string;
  aId: string;
  bId: string;
  trust: number;
  hostility: number;
  tradeVolume: number;
  conflictMemory: number;
  atWar: boolean;
  warStartYear: number | null;
  allied: boolean;
  distance: number;
  lastInteractionYear: number;
  battles: number;
  /** No new war can be declared before this year (set when peace is made). */
  truceUntilYear: number | null;
  respect: number;
  /** How much each side depends on the exchange, 0..1. */
  tradeDependency: number;
  /** Distance between the two cultures, 0..1. */
  culturalDistance: number;
  status: DiplomaticStatus;
  phase: ConflictPhase;
  lastConflictYear: number | null;
  /** Years the pair has spent in the current phase. */
  phaseYears: number;
}

export type EventType =
  | "birth"
  | "notable_death"
  | "famine"
  | "migration"
  | "settlement_founded"
  | "construction"
  | "tech_discovered"
  | "trade"
  | "conflict"
  | "battle"
  | "peace"
  | "settlement_collapse"
  | "population_growth"
  | "civilization_founded"
  | "alliance"
  | "tribe_extinct"
  | "conquest"
  | "climate"
  | "epidemic"
  | "leadership"
  | "unrest"
  | "culture"
  | "settlement_growth";

export type ActorKind = "tribe" | "settlement" | "civilization" | "person" | "dynasty";

export interface EventActor {
  kind: ActorKind;
  id: string;
  name: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface HistoricalEvent {
  id: string;
  seq: number;
  tick: number;
  year: number;
  type: EventType;
  /** Free-form discriminator inside a type (e.g. "drought", "succession"). */
  subtype: string | null;
  importance: 1 | 2 | 3 | 4 | 5;
  actors: EventActor[];
  x: number | null;
  y: number | null;
  title: string;
  description: string;
  metadata: Record<string, JsonValue>;
  /** Ids of the events that directly caused this one. */
  causeEventIds: string[];
}

export type HazardKind = "drought" | "flood" | "wildfire";

export interface Hazard {
  id: string;
  kind: HazardKind;
  x: number;
  y: number;
  radius: number;
  severity: number;
  startYear: number;
  untilYear: number;
  /** Event that announced the hazard, used to chain consequences to their cause. */
  eventId: string | null;
}

/** Deterministic per-season summary of a simulated year. */
export interface SeasonState {
  season: Season;
  /** Global temperature index of the season, 0..1. */
  temperature: number;
  /** Global precipitation index of the season, 0..1. */
  precipitation: number;
  /** Multiplier applied to food production during the season. */
  yield: number;
}

export interface Climate {
  modifier: number;
  /** Legacy field kept for compatibility: droughts are now hazards. */
  droughts: { x: number; y: number; radius: number; severity: number; untilYear: number }[];
  hazards: Hazard[];
  /** Slow multi-century drift of the global temperature, -1..1. */
  trend: number;
  seasons: SeasonState[];
  harshWinter: boolean;
  /** Index of the current winter severity, 0..1. */
  winterSeverity: number;
}

export type CrisisKind =
  "epidemic" | "famine" | "drought" | "flood" | "wildfire" | "harsh_winter" | "revolt" | "succession";

export interface ActiveCrisis {
  id: string;
  kind: CrisisKind;
  scope: "world" | "tribe" | "settlement";
  targetId: string | null;
  startYear: number;
  untilYear: number;
  severity: number;
  eventId: string | null;
}

export interface WorldSettings {
  width: number;
  height: number;
  startYear: number;
  minTribes: number;
  maxTribes: number;
  minTribeSize: number;
  maxTribeSize: number;
  settlementMinPopulation: number;
  raidGraceYears: number;
  warGraceYears: number;
  populationSoftCap: number;
}

export interface Counters {
  person: number;
  tribe: number;
  settlement: number;
  civilization: number;
  household: number;
  event: number;
  dynasty: number;
  construction: number;
  crisis: number;
}

export interface TickStats {
  tick: number;
  year: number;
  population: number;
  tribes: number;
  settlements: number;
  civilizations: number;
  foodProduced: number;
  foodConsumed: number;
  foodStored: number;
  technologies: number;
  wars: number;
  battles: number;
  births: number;
  deaths: number;
  starvationDeaths: number;
  conflictDeaths: number;
  /** Extended metrics. */
  epidemicDeaths: number;
  foodSurplus: number;
  storageCapacity: number;
  goodsProduced: number;
  tradeVolume: number;
  wealth: number;
  buildings: number;
  territory: number;
  averageTemperature: number;
  climateStress: number;
  averageStability: number;
  migrations: number;
  season: Season;
}

/** Per-civilization time series, sampled every `observability.civStatsInterval` ticks. */
export interface CivilizationStats {
  tick: number;
  year: number;
  civilizationId: string;
  population: number;
  settlements: number;
  technologies: number;
  foodStored: number;
  wealth: number;
  territory: number;
  stability: number;
  atWar: boolean;
}

/**
 * Entities that left the active simulation during a batch. They are kept out of
 * the hot loop but handed to the persistence layer so history stays queryable.
 */
export interface Archive {
  people: Person[];
  households: Household[];
}

export interface WorldState {
  seed: string;
  width: number;
  height: number;
  tick: number;
  year: number;
  rng: RngState;
  /** Engine version that produced this state; older values are migrated on load. */
  simulationVersion: number;
  config: SimulationConfig;
  settings: WorldSettings;
  counters: Counters;
  climate: Climate;
  cells: Cell[];
  people: Person[];
  tribes: Tribe[];
  settlements: Settlement[];
  civilizations: Civilization[];
  households: Household[];
  relationships: Relationship[];
  dynasties: Dynasty[];
  crises: ActiveCrisis[];
  archive: Archive;
}

export interface SimulationResult {
  ticksRun: number;
  partial: boolean;
  events: HistoricalEvent[];
  stats: TickStats[];
  civStats: CivilizationStats[];
}
