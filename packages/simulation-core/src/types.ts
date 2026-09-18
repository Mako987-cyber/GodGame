import type { RngState } from "./prng";

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
  habitability: number;
  river: boolean;
  riverName: string | null;
  coastal: boolean;
  ownerTribeId: string | null;
  settlementId: string | null;
  road: boolean;
  /** Number of farm fields worked on this cell. */
  fields: number;
}

export type Sex = "M" | "F";

export type Role = "child" | "gatherer" | "hunter" | "builder" | "elder" | "leader" | "farmer" | "warrior";

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
  | "defend";

export interface Skills {
  gathering: number;
  hunting: number;
  building: number;
  combat: number;
  crafting: number;
}

export interface Personality {
  aggression: number;
  cooperation: number;
  curiosity: number;
  riskTolerance: number;
  sociability: number;
}

export type DeathCause = "natural" | "starvation" | "conflict" | "illness";

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
}

export interface Stockpile {
  food: number;
  wood: number;
  stone: number;
  copper: number;
}

export type TribeStatus = "nomadic" | "settled" | "extinct";

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
}

export type BuildingType = "camp" | "hut" | "storehouse" | "farm" | "road" | "palisade";

export interface ConstructionProject {
  type: BuildingType;
  progress: number;
  required: number;
  /** For roads: target settlement id. */
  targetId: string | null;
}

export type SettlementStatus = "active" | "abandoned";

export interface Settlement {
  id: string;
  seq: number;
  name: string;
  tribeId: string;
  civilizationId: string | null;
  x: number;
  y: number;
  level: number;
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
  | "conquest";

export type ActorKind = "tribe" | "settlement" | "civilization" | "person";

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
  importance: 1 | 2 | 3 | 4 | 5;
  actors: EventActor[];
  x: number | null;
  y: number | null;
  title: string;
  description: string;
  metadata: Record<string, JsonValue>;
}

export interface Drought {
  x: number;
  y: number;
  radius: number;
  severity: number;
  untilYear: number;
}

export interface Climate {
  modifier: number;
  droughts: Drought[];
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
  archive: Archive;
}

export interface SimulationResult {
  ticksRun: number;
  partial: boolean;
  events: HistoricalEvent[];
  stats: TickStats[];
}
