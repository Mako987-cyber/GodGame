import type {
  BeliefStatus,
  BeliefType,
  ConflictPhase,
  ConstructionProject,
  DiplomaticAgreementStatus,
  DiplomaticAgreementType,
  DiplomaticReputation,
  CultureChangeRecord,
  CultureTraits,
  DiplomaticStatus,
  DistributionPolicy,
  DynastyEndReason,
  DynastyStatus,
  EventActor,
  GovernmentType,
  IdentityType,
  JsonValue,
  PlacementReport,
  RosterEntry,
  ResilienceProfile,
  RosterMode,
  Season,
  SeasonState,
  SettlementHistory,
  SettlementTier,
  Stability,
  SuccessionLaw,
  Stockpile,
  WorldSettings,
} from "@genesis/simulation-core";
import type { WorldSummary } from "@/lib/db/schema";
import type { IdentitySummaryDTO } from "@/lib/validation/identity";

export type {
  IdentityDetailDTO,
  IdentityPageDTO,
  IdentitySummaryDTO,
  WorldCivilizationDetailDTO,
  WorldCivilizationDTO,
  WorldCivilizationListDTO,
} from "@/lib/validation/identity";

/** Shapes returned by the API and consumed by the UI (kept free of server-only imports). */
export interface WorldListItem {
  id: string;
  name: string;
  seed: string;
  width: number;
  height: number;
  currentTick: number;
  currentYear: number;
  /** `deleting`: confirmed deletion in progress (list page only; every other read answers 404). */
  status: "paused" | "running" | "deleting";
  summary: WorldSummary;
  createdAt: string;
  updatedAt: string;
  /** Present while the world is being deleted. */
  deletion?: { jobId: string; status: string; progress: number } | null;
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
  pastures: number[];
  clay: number[];
  tin: number[];
  coal: number[];
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
  /** Title follows the government the simulation produced, never the identity's fame. */
  leader: { id: string; name: string; age: number; title: string } | null;
  foundedYear: number;
  extinctYear: number | null;
  morale: number;
  lastFoodRatio: number;
  lastFoodProduced: number;
  scarcityYears: number;
  parentTribeId: string | null;
  techAdoption: Record<string, number>;
  /** techId -> year it was lost; a rediscovery removes the entry. */
  techLost: Record<string, number>;
  culture: CultureTraits;
  /** The last notable cultural shifts, oldest first. */
  cultureHistory: CultureChangeRecord[];
  /** How well this people would take a blow; recomputed every tick. */
  resilience: ResilienceProfile | null;
  /** How firmly it holds its system of belief, 0..1. */
  beliefAdherence: number;
  government: GovernmentType;
  stability: Stability;
  distribution: DistributionPolicy;
  dynasty: { id: string; name: string; rulers: number; prestige: number } | null;
  identityId: string | null;
  identityType: IdentityType;
  emblemKey: string | null;
  absorbedIdentityIds: string[];
  absorbedByTribeId: string | null;
}

export interface SettlementDTO {
  id: string;
  name: string;
  tribeId: string;
  civilizationId: string | null;
  x: number;
  y: number;
  level: number;
  tier: SettlementTier;
  status: "active" | "abandoned";
  population: number;
  stock: Stockpile;
  buildings: Record<string, number>;
  construction: {
    type: string;
    progress: number;
    required: number;
    status: ConstructionProject["status"];
    missing: Record<string, number>;
    startedAtTick: number;
  } | null;
  defense: number;
  territoryRadius: number;
  foundedYear: number;
  abandonedYear: number | null;
  lastProduction: Stockpile;
  lastFoodRatio: number;
  famineYears: number;
  hygiene: number;
  unrest: number;
  influence: number;
  founderId: string | null;
  epidemic: boolean;
  /** Compact self-memory of the place; the full chronicle is paginated elsewhere. */
  history: SettlementHistory | null;
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
  identityId: string | null;
  identityType: IdentityType;
  /** Earlier political names of the same state, oldest first. */
  formerNames: string[];
}

/** Founding roster of a historical world, as stored at creation. */
export interface RosterDTO {
  mode: RosterMode;
  catalogVersion: string;
  enableIdentityModifiers: boolean;
  balancedPlacement: boolean;
  equalStartingLevel: boolean;
  entries: RosterEntry[];
  /** Band and tier used to place the founding peoples; null for worlds created before the audit. */
  placement: PlacementReport | null;
}

export interface CivilizationHistoryDTO {
  civilizationId: string;
  discoveries: { techId: string; year: number; method: string }[];
  leadership: { id: string; year: number; title: string; subtype: string | null }[];
  events: EventsPage;
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
  respect: number;
  tradeDependency: number;
  culturalDistance: number;
  status: DiplomaticStatus;
  phase: ConflictPhase;
  lastConflictYear: number | null;
}

export interface TechnologyDTO {
  id: string;
  name: string;
  category: string;
  description: string;
  prerequisites: string[];
  cost: number;
  effectSummary: string;
  resourceRequirement: string;
  geographyRequirement: string | null;
  tradeOff: string | null;
}

export interface DynastyDTO {
  id: string;
  name: string;
  tribeId: string;
  founderId: string;
  foundedYear: number;
  endedYear: number | null;
  prestige: number;
  rulers: number;
  currentLeaderId: string | null;
  legitimacy: number;
  successionLaw: SuccessionLaw;
  status: DynastyStatus;
  endReason: DynastyEndReason | null;
  /** Troubled successions the house has been through. */
  crises: number;
}

export interface BeliefDTO {
  id: string;
  name: string;
  type: BeliefType;
  typeLabel: string;
  foundedByTribeId: string;
  principles: string[];
  authority: number;
  tolerance: number;
  missionaryPressure: number;
  createdYear: number;
  parentBeliefIds: string[];
  status: BeliefStatus;
  endedYear: number | null;
  /** Peoples that follow it right now. */
  followerTribeIds: string[];
}

export interface AgreementDTO {
  id: string;
  firstCivilizationId: string;
  secondCivilizationId: string;
  type: DiplomaticAgreementType;
  typeLabel: string;
  startedYear: number;
  expiresAtYear: number | null;
  endedYear: number | null;
  status: DiplomaticAgreementStatus;
  violationCount: number;
  lastViolatorId: string | null;
}

export interface CrisisDTO {
  id: string;
  kind: string;
  scope: string;
  targetId: string | null;
  startYear: number;
  untilYear: number;
  severity: number;
}

/** Detail of a person, loaded on demand (never for the whole population). */
export interface PersonDTO {
  id: string;
  name: string;
  tribeId: string;
  tribeName: string | null;
  settlementId: string | null;
  settlementName: string | null;
  sex: "M" | "F";
  age: number;
  birthYear: number;
  alive: boolean;
  deathYear: number | null;
  deathCause: string | null;
  role: string;
  action: string;
  health: number;
  hunger: number;
  prestige: number;
  education: number;
  wealth: number;
  title: string | null;
  titleSinceYear: number | null;
  notable: boolean;
  dynasty: { id: string; name: string } | null;
  skills: Record<string, number>;
  personality: Record<string, number>;
  knowledge: string[];
  family: {
    mother: { id: string; name: string } | null;
    father: { id: string; name: string } | null;
    partner: { id: string; name: string } | null;
    children: { id: string; name: string; alive: boolean }[];
  };
  events: EventDTO[];
}

export interface WorldDetail {
  world: WorldListItem & {
    settings: WorldSettings;
    climate: {
      modifier: number;
      droughts: number;
      trend: number;
      harshWinter: boolean;
      winterSeverity: number;
      seasons: SeasonState[];
      /** The season that shaped the last simulated year (biggest deviation from its norm). */
      definingSeason: Season;
      hazards: { id: string; kind: string; x: number; y: number; radius: number; severity: number }[];
    };
    simulationVersion: number;
  };
  map: MapLayers;
  tribes: TribeDTO[];
  settlements: SettlementDTO[];
  civilizations: CivilizationDTO[];
  relationships: RelationshipDTO[];
  technologies: TechnologyDTO[];
  discoveries: { tribeId: string; techId: string; year: number; method: string }[];
  dynasties: DynastyDTO[];
  /** Systems of belief that appeared in this world, active and ended. */
  beliefs: BeliefDTO[];
  /** Explicit pacts, active and ended. */
  agreements: AgreementDTO[];
  /** What each people is known for. */
  reputations: DiplomaticReputation[];
  crises: CrisisDTO[];
  notablePeople: {
    id: string;
    name: string;
    tribeId: string;
    age: number;
    role: string;
    title: string | null;
    prestige: number;
  }[];
  lastSnapshot: { tick: number; year: number } | null;
  roster: RosterDTO | null;
  /** Summaries of the identities used in this world only. */
  identities: IdentitySummaryDTO[];
  /** Explicit vassal relationships, active and ended (ids of political instances, "t12"). */
  vassalages: VassalageDTO[];
  /** Occupations of settlements, active and ended. */
  occupations: OccupationDTO[];
  /** Identities born from fusions in this world: generated, never historical. */
  composites: CompositeIdentityDTO[];
}

export interface VassalageDTO {
  id: string;
  overlordCivilizationId: string;
  vassalCivilizationId: string;
  startedYear: number;
  endedYear: number | null;
  tributePolicy: "light" | "standard" | "heavy";
  autonomy: number;
  militaryObligation: number;
  diplomaticStatus: "active" | "rebellion" | "ended";
  endReason: string | null;
  totalTribute: number;
  lastTribute: number;
}

export interface OccupationDTO {
  id: string;
  occupyingCivilizationId: string;
  occupiedCivilizationId: string | null;
  occupiedSettlementId: string | null;
  startedYear: number;
  endedYear: number | null;
  occupationPolicy: "military" | "administrative" | "extractive" | "integrative";
  resistance: number;
  control: number;
  status: string;
  upkeepPaid: number;
  extracted: number;
}

export interface CompositeIdentityDTO {
  id: string;
  displayName: string;
  collectiveName: string;
  adjective: string;
  sourceIdentityIds: string[];
  /** Display names of the sources (catalog identities or earlier composites). */
  sourceNames: string[];
  sourceCivilizationIds: string[];
  civilizationId: string;
  primaryColor: string;
  secondaryColor: string;
  emblemKey: string;
  createdYear: number;
  status: string;
  tags: string[];
}

export interface EventDTO {
  id: string;
  tick: number;
  year: number;
  type: string;
  subtype: string | null;
  causeEventIds: string[];
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
  season: Season | string;
}

export interface CivilizationStatsPoint {
  civilizationId: string;
  tick: number;
  year: number;
  population: number;
  settlements: number;
  technologies: number;
  foodStored: number;
  wealth: number;
  territory: number;
  stability: number;
  atWar: boolean;
}

export interface StatsResponse {
  world: StatsPoint[];
  civilizations: CivilizationStatsPoint[];
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
    epidemicDeaths: number;
    migrations: number;
    tradeVolume: number;
  };
}

export interface ApiErrorBody {
  /** `requestId` correlates the answer with the server logs (never a stack trace). */
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
