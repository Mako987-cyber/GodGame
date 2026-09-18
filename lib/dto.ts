import type { EventActor, JsonValue, Stockpile, WorldSettings } from "@genesis/simulation-core";
import type { WorldSummary } from "@/lib/db/schema";

/** Shapes returned by the API and consumed by the UI (kept free of server-only imports). */
export interface WorldListItem {
  id: string;
  name: string;
  seed: string;
  width: number;
  height: number;
  currentTick: number;
  currentYear: number;
  status: "paused" | "running";
  summary: WorldSummary;
  createdAt: string;
  updatedAt: string;
}

/** Column-oriented map layers: one entry per cell, row-major (index = y * width + x). */
export interface MapLayers {
  biome: number[];
  altitude: number[];
  moisture: number[];
  temperature: number[];
  fertility: number[];
  water: number[];
  wood: number[];
  stone: number[];
  fauna: number[];
  maxFauna: number[];
  copper: number[];
  iron: number[];
  habitability: number[];
  river: number[];
  coastal: number[];
  road: number[];
  fields: number[];
  /** Index into `tribes`, -1 when unclaimed. */
  owner: number[];
  /** Index into `settlements`, -1 when none. */
  settlement: number[];
  population: number[];
  riverNames: Record<number, string>;
}

export interface TribeDTO {
  id: string;
  name: string;
  color: string;
  status: "nomadic" | "settled" | "extinct";
  x: number;
  y: number;
  population: number;
  adults: number;
  children: number;
  stock: Stockpile;
  techs: string[];
  techProgress: Record<string, number>;
  civilizationId: string | null;
  leader: { id: string; name: string; age: number } | null;
  foundedYear: number;
  extinctYear: number | null;
  morale: number;
  lastFoodRatio: number;
  lastFoodProduced: number;
  scarcityYears: number;
  parentTribeId: string | null;
}

export interface SettlementDTO {
  id: string;
  name: string;
  tribeId: string;
  civilizationId: string | null;
  x: number;
  y: number;
  level: number;
  status: "active" | "abandoned";
  population: number;
  stock: Stockpile;
  buildings: Record<string, number>;
  construction: { type: string; progress: number; required: number } | null;
  defense: number;
  territoryRadius: number;
  foundedYear: number;
  abandonedYear: number | null;
  lastProduction: Stockpile;
  lastFoodRatio: number;
  famineYears: number;
}

export interface CivilizationDTO {
  id: string;
  name: string;
  color: string;
  founderTribeId: string;
  capitalSettlementId: string | null;
  foundedYear: number;
  status: "active" | "collapsed";
  tribeIds: string[];
  settlementIds: string[];
  population: number;
}

export interface RelationshipDTO {
  aId: string;
  bId: string;
  trust: number;
  hostility: number;
  tradeVolume: number;
  conflictMemory: number;
  atWar: boolean;
  allied: boolean;
  distance: number;
  warStartYear: number | null;
  battles: number;
}

export interface TechnologyDTO {
  id: string;
  name: string;
  description: string;
  prerequisites: string[];
  cost: number;
  effectSummary: string;
}

export interface WorldDetail {
  world: WorldListItem & { settings: WorldSettings; climate: { modifier: number; droughts: number } };
  map: MapLayers;
  tribes: TribeDTO[];
  settlements: SettlementDTO[];
  civilizations: CivilizationDTO[];
  relationships: RelationshipDTO[];
  technologies: TechnologyDTO[];
  discoveries: { tribeId: string; techId: string; year: number; method: string }[];
  lastSnapshot: { tick: number; year: number } | null;
}

export interface EventDTO {
  id: string;
  tick: number;
  year: number;
  type: string;
  importance: number;
  actors: EventActor[];
  x: number | null;
  y: number | null;
  title: string;
  description: string;
  metadata: Record<string, JsonValue>;
}

export interface EventsPage {
  items: EventDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StatsPoint {
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

export interface SimulateResponse {
  worldId: string;
  fromTick: number;
  toTick: number;
  year: number;
  requestedTicks: number;
  ticksRun: number;
  partial: boolean;
  durationMs: number;
  summary: WorldSummary;
  events: EventDTO[];
  eventsTotal: number;
  metrics: {
    births: number;
    deaths: number;
    starvationDeaths: number;
    conflictDeaths: number;
    battles: number;
    foodProduced: number;
    population: number;
    populationDelta: number;
  };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
