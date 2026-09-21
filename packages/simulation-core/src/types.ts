import type { DistributionPolicy, Season, SimulationConfig } from "./config";
import type { IdentityType } from "./identity/definition";
import type { WorldRoster } from "./identity/roster";
import type { RngState } from "./prng";
import type { ResilienceProfile } from "./resilience";
import type { GoodsBag, ResourceBundle, Stockpile } from "./stock";

export type { Stockpile, ResourceBundle, GoodsBag };
export type { ResilienceProfile };

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

/** Culture traits, each normalized 0..100. Procedurally generated; a historical identity may only nudge the starting values (see `applyIdentityModifiers`). */
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
  /** How well the people lives beside those who are unlike it. */
  tolerance: number;
  /** How readily it goes to look at what lies beyond what it knows. */
  exploration: number;
  /** How much of its own size it can actually govern: records, officials, distance. */
  administrativeCapacity: number;
  /** How much its own members feel part of one thing. */
  culturalCohesion: number;
}

/**
 * One recorded change of one trait. Kept per people as a bounded ring (see
 * `MAX_CULTURE_HISTORY`): it answers "why is this people like this?" without storing a row per
 * trait per year, which over a thousand ticks would dwarf the rest of the state.
 */
export interface CultureChangeRecord {
  tick: number;
  year: number;
  trait: keyof CultureTraits;
  previousValue: number;
  newValue: number;
  /** Which pressure moved it, in the engine's own vocabulary. */
  cause: CulturePressureKind;
  /** Plain-language reason, shown in the UI. */
  reason: string;
  causeEventId?: string;
}

export type CulturePressureKind =
  "war" | "trade" | "scarcity" | "discovery" | "expansion" | "complexity" | "belief" | "contact";

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
  /**
   * Technologies this people once had and lost, with the year they fell out of use. Kept
   * forever: it is what makes a rediscovery cheaper and what the chronicle reads back.
   */
  techLost: Record<string, number>;
  /** techId -> key of the local variant this people practises (see tech-variants.ts). */
  techVariants: Record<string, string>;
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
  /**
   * Historical identity (catalog key) this political instance carries. Shared by the
   * successors born from it (splits, secessions): one cultural identity, several polities.
   * `null` for procedural and legacy tribes.
   */
  identityId: string | null;
  identityType: IdentityType;
  /** Identities of peoples this group absorbed (by merger or conquest): kept, never erased. */
  absorbedIdentityIds: string[];
  /** Set when the tribe ended by merging into another one rather than by dying out. */
  absorbedByTribeId: string | null;
  /** The system of belief this people follows; null while it has none. */
  beliefSystemId: string | null;
  /** How deeply the belief is held, 0..1: it grows with time and falls when faith is shaken. */
  beliefAdherence: number;
  /** The last notable cultural shifts of this people, oldest first. Bounded. */
  cultureHistory: CultureChangeRecord[];
  /**
   * How well the people would take a blow. Recomputed from scratch every year by
   * `computeResilience`, and stored only so the API and the interface can show it; nothing in
   * the engine reads it back as memory. `null` before the first tick of a loaded world.
   */
  resilience: ResilienceProfile | null;
  /**
   * Last event of a few kinds that shaped this people (`war:<other>`, `famine`, `collapse`,
   * `leader_death`, `revolt`), so later events can name it as their cause. See causality.ts.
   */
  causalAnchors: Record<string, { eventId: string; year: number }>;
}

/**
 * How a people decides who rules next. Derived from the form of government when the dynasty is
 * founded, and re-read when the government changes: a house can outlive the rule that created it.
 */
export type SuccessionLaw = "hereditary" | "elective" | "council" | "military" | "religious" | "meritocratic";

export type DynastyStatus = "active" | "overthrown" | "extinct" | "merged";

export type DynastyEndReason =
  /** No eligible heir was left. */
  | "no_heir"
  /** A rival took the throne by force. */
  | "usurpation"
  /** The people it ruled ceased to exist. */
  | "extinct_people"
  /** The people merged into another one (fusion, absorption). */
  | "merged"
  /** The form of government no longer passes power down a family. */
  | "reform";

/** How a succession ended. Anything but `peaceful` leaves a mark on legitimacy. */
export type SuccessionOutcome =
  | "peaceful"
  /** Power held by others until an heir comes of age. */
  | "regency"
  /** Several claimants; the strongest prevailed without open war. */
  | "disputed"
  /** Someone outside the line took the throne. */
  | "usurpation"
  /** No successor at all: the seat stayed empty. */
  | "interregnum";

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
  /** Who sits at the head of the house right now; null between two rulers. */
  currentLeaderId: string | null;
  /** How much the house's claim is accepted, 0..1. Falls with every troubled succession. */
  legitimacy: number;
  successionLaw: SuccessionLaw;
  status: DynastyStatus;
  endReason: DynastyEndReason | null;
  /** Troubled successions the house has been through: its record, never reset. */
  crises: number;
}

/**
 * Shape a system of belief takes. Chosen by the engine from the land, the culture and what the
 * people has lived through — never from its historical identity: an Egyptian band on a plain
 * with no river does not get a river cult.
 */
export type BeliefType =
  | "ancestor_veneration"
  | "nature_spirituality"
  | "river_cult"
  | "solar_cult"
  | "mountain_cult"
  | "pantheon"
  | "imperial_cult"
  | "philosophical"
  | "syncretic";

export type BeliefStatus = "active" | "absorbed" | "extinct";

/**
 * A system of belief born inside the simulation. It is NOT a real religion: name, principles
 * and shape are generated, and two worlds with the same seed produce the same ones.
 *
 * Never deleted: a belief that dies out stays in the record with the year it did.
 */
export interface BeliefSystem {
  id: string;
  seq: number;
  name: string;
  type: BeliefType;
  /** The people among whom it appeared. Kept even after that people is gone. */
  foundedByTribeId: string;
  /** Short generated statements of what it holds; shown in the UI, never parsed. */
  principles: string[];
  /** How much authority it lends to whoever rules, 0..1. */
  authority: number;
  /** How well it lives beside other beliefs, 0..1. */
  tolerance: number;
  /** How hard it pushes outward, 0..1. */
  missionaryPressure: number;
  /** What it adds to the cohesion of its followers, -1..1. */
  cohesionEffect: number;
  /** What it adds to the legitimacy of their rulers, -1..1. */
  legitimacyEffect: number;
  /** How much friction it creates with those who believe otherwise, 0..1. */
  conflictRisk: number;
  createdAtTick: number;
  createdYear: number;
  /** For a syncretic belief, the two it came from (oldest first). */
  parentBeliefIds: string[];
  status: BeliefStatus;
  endedYear: number | null;
  causeEventId: string | null;
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

/** Why a settlement was put where it was. Decided once, at foundation, and never rewritten. */
export type SettlementFoundingReason =
  "migration" | "agriculture" | "trade" | "military" | "religious" | "resource" | "administrative" | "refuge";

/** What a place became known for. Derived from its land, its buildings and what it lived. */
export type SettlementSpecialization =
  | "agricultural"
  | "mining"
  | "military"
  | "commercial"
  | "harbour"
  | "religious"
  | "administrative"
  | "craft";

/** A stretch of years a settlement served as the capital of its state. */
export interface CapitalPeriod {
  fromYear: number;
  /** Null while it still is the capital. */
  toYear: number | null;
}

/**
 * What a place remembers about itself. Kept compact on purpose: it travels with the settlement
 * in every payload, so it stores counts, peaks and a capped list of the events that mattered,
 * never the full chronicle (which lives in `historical_events` and is queried on demand).
 */
export interface SettlementHistory {
  foundingReason: SettlementFoundingReason;
  /** Set once at foundation; kept even after the founder dies. */
  founderName: string | null;
  specializations: SettlementSpecialization[];
  /** The largest it ever was, and when. */
  peakPopulation: number;
  peakYear: number;
  /** Times it was emptied (famine, sack, epidemic) and times people came back. */
  destructions: number;
  reconstructions: number;
  /** Years spent under someone else's garrison, cumulative. */
  occupiedYears: number;
  capitalPeriods: CapitalPeriod[];
  /** Ids of the few events that shaped it, newest last. Capped. */
  notableEventIds: string[];
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
  /** What the place remembers about itself; `null` only in worlds that predate it. */
  history: SettlementHistory;
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
  /** Inherited from the founder tribe: a state is a political form of a people, not a new people. */
  identityId: string | null;
  identityType: IdentityType;
  /** Place the political name is built on ("Naru" in "Regno di Naru"); null for legacy names. */
  politicalStem: string | null;
  /** Previous political names, oldest first: the state changed form, it was not replaced. */
  formerNames: string[];
  /**
   * Pattern of the political name chosen at foundation ("{form} di {capital}",
   * "{form} {adjective}"), re-rendered when the government changes. Null: legacy name rule.
   */
  namePattern: string | null;
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
  | "unknown"
  | "contact"
  | "neutral"
  | "trade_partner"
  | "allied"
  | "rival"
  | "war"
  | "truce"
  /** An active vassal relationship binds the pair (see `VassalRelationship`). */
  | "vassalage"
  /** One side occupies settlements of the other, without being at war (see `Occupation`). */
  | "occupation";

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
  /** Accumulated years of conditions favouring a fusion of the two peoples (see fusion.ts). */
  fusionYears: number;
}

// --- Explicit diplomacy -----------------------------------------------------------------------
//
// `Relationship` records how two peoples feel about each other. What follows records what they
// have actually agreed to, and how each of them has behaved about it — which is a different
// thing: a people can be trusted and still break a treaty, and the record must show it.

export type DiplomaticAgreementType =
  | "trade"
  | "non_aggression"
  | "defensive_alliance"
  | "military_alliance"
  | "passage"
  | "tribute"
  | "technology_exchange"
  | "independence_guarantee"
  | "embargo"
  | "peace";

export type DiplomaticAgreementStatus = "active" | "violated" | "expired" | "cancelled";

export interface DiplomaticAgreement {
  id: string;
  seq: number;
  /** Political instances (tribe ids), ordered by seq so a pair has one canonical key. */
  firstCivilizationId: string;
  secondCivilizationId: string;
  type: DiplomaticAgreementType;
  startedAtTick: number;
  startedYear: number;
  /** Null for an open-ended pact. */
  expiresAtYear: number | null;
  endedYear: number | null;
  /** Trust between the two when they signed: what the pact was worth at the time. */
  trustAtStart: number;
  status: DiplomaticAgreementStatus;
  /** How many times it has been broken while still standing. */
  violationCount: number;
  /** Who broke it last, if anyone. */
  lastViolatorId: string | null;
  causeEventId: string | null;
}

/**
 * How a people is seen by everyone else. Unlike `Relationship`, this is not about one pair: it
 * is the record a people carries into every negotiation, built from what it has actually done.
 */
export interface DiplomaticReputation {
  civilizationId: string;
  /** Keeps its word, 0..1. */
  reliability: number;
  /** Starts wars, 0..1. */
  aggression: number;
  /** Honours trade, 0..1. */
  tradeReliability: number;
  /** Respects treaties it signed, 0..1. */
  treatyRespect: number;
  /** How dangerous others consider it, 0..1. */
  threatLevel: number;
  /** Pacts signed and pacts broken, cumulative. */
  agreementsSigned: number;
  agreementsBroken: number;
  updatedAtTick: number;
}

// --- Incomplete information ------------------------------------------------------------------
//
// What one people believes about another. Never the truth: an estimate with a confidence, a
// year and a source, which ages and can simply be wrong. One compact record per ordered pair
// (observer, target) that has ever been in contact — not one row per fact per year.

export type KnowledgeSource = "exploration" | "trade" | "diplomat" | "spy" | "battle" | "rumor";

export interface KnowledgeEstimate {
  /** What the observer believes the value is. May be far from the real one. */
  value: number;
  /** How much the observer trusts it, 0..1. Decays every year it is not refreshed. */
  confidence: number;
  /** Year it was last refreshed. */
  year: number;
  source: KnowledgeSource;
}

export interface CivilizationKnowledge {
  /** Who knows. */
  observerId: string;
  /** Who is known about. */
  targetId: string;
  /** Where the observer last saw them. */
  location: { x: number; y: number; year: number } | null;
  population: KnowledgeEstimate | null;
  /** Fighting strength, in the same units as `sidePower`. */
  military: KnowledgeEstimate | null;
  /** Internal order, 0..1. */
  stability: KnowledgeEstimate | null;
  /** Technologies the observer has seen them use. A subset of the truth, never a superset. */
  technologies: { ids: string[]; confidence: number; year: number; source: KnowledgeSource } | null;
  /** Whether the observer believes they mean harm. */
  intent: { hostile: boolean; confidence: number; year: number; source: KnowledgeSource } | null;
  /** Spying attempts against this target, and how many were caught. */
  spyAttempts: number;
  spiesCaught: number;
  updatedYear: number;
}

export type EventType =
  | "intelligence"
  | "agreement"
  | "belief"
  | "vassalage"
  | "occupation"
  | "fusion"
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
  | "settlement_growth"
  | "civilization_transformed";

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
  vassalage: number;
  occupation: number;
  composite: number;
  belief: number;
  agreement: number;
}

// --- Explicit political relations ------------------------------------------------------------
//
// "Civilization" in these records means the political instance of a people, i.e. a `Tribe`
// (ids "t12"): the same ids the API exposes under /worlds/:id/civilizations/:civilizationId.

export type TributePolicy = "light" | "standard" | "heavy";

/**
 * A people bound to another: it keeps its identity, capital, culture and leader, pays tribute,
 * sends a levy to its overlord's wars, and may rebel or become independent. Never deleted:
 * an ended relationship stays in the record with its end year and reason.
 */
export interface VassalRelationship {
  id: string;
  seq: number;
  overlordCivilizationId: string;
  vassalCivilizationId: string;
  startedAtTick: number;
  startedYear: number;
  endedAtTick: number | null;
  endedYear: number | null;
  tributePolicy: TributePolicy;
  /** Autonomy of the vassal, 0..1: lowers tribute; at the top it becomes independence. */
  autonomy: number;
  /** Share of the vassal's fighters sent to the overlord's battles, 0..1. */
  militaryObligation: number;
  diplomaticStatus: "active" | "rebellion" | "ended";
  endReason: "independence" | "rebellion_won" | "extinct" | "merged" | null;
  /** Food delivered to the overlord since the start. */
  totalTribute: number;
  lastTribute: number;
  causeEventId: string | null;
}

export type OccupationPolicy = "military" | "administrative" | "extractive" | "integrative";

export interface TerritoryReference {
  settlementId: string | null;
  x: number;
  y: number;
  radius: number;
}

/**
 * A settlement held by force. Occupation is not annexation: the settlement keeps its owner and
 * its people their identity; the occupier pays for the garrison, extracts according to its
 * policy and faces resistance. It ends in annexation, liberation, autonomy or abandonment.
 */
export interface Occupation {
  id: string;
  seq: number;
  occupyingCivilizationId: string;
  occupiedCivilizationId: string | null;
  occupiedSettlementId: string | null;
  occupiedTerritory: TerritoryReference;
  startedAtTick: number;
  startedYear: number;
  endedAtTick: number | null;
  endedYear: number | null;
  occupationPolicy: OccupationPolicy;
  /** 0..1 */
  resistance: number;
  /** 0..1 */
  control: number;
  status: "active" | "annexed" | "liberated" | "autonomous" | "returned" | "abandoned";
  /** Food paid by the occupier for the garrison since the start. */
  upkeepPaid: number;
  /** Food and goods taken from the occupied settlement since the start. */
  extracted: number;
  causeEventId: string | null;
}

/** Culture that emerged from a fusion: blended traits and the union of the sources' tags. */
export interface EmergentCultureProfile {
  traits: CultureTraits;
  tags: string[];
}

/**
 * A new identity produced by the engine when peoples of different identities fuse. It is NOT a
 * real historical civilization: its name is generated ("Romano-Celti", "Lega Romano-Celtica")
 * and it keeps references to every source identity and political instance, which are never
 * erased from the world.
 */
export interface CompositeIdentity {
  id: string;
  seq: number;
  /** Catalog keys (or ids of earlier composites) that fused, largest first. */
  sourceIdentityIds: string[];
  sourceCivilizationIds: string[];
  /** Canonical key of the source set: two fusions of the same set never coexist in a world. */
  memberKey: string;
  displayName: string;
  singularNoun: string;
  adjective: string;
  adjectiveFeminine: string;
  collectiveName: string;
  namingProfile: import("./identity/definition").NamingProfile;
  visualProfile: import("./identity/definition").VisualProfile;
  culturalProfile: EmergentCultureProfile;
  createdAtTick: number;
  createdYear: number;
  origin: "fusion";
  status: "active" | "fragmented" | "absorbed" | "dissolved";
  /** The political instance born from the fusion. */
  civilizationId: string;
  causeEventId: string | null;
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
  /** Founding roster of a historical world; `null` for procedural and legacy worlds. Never regenerated. */
  roster: WorldRoster | null;
  /** Systems of belief that appeared in this world (empty in worlds created before they existed). */
  beliefs: BeliefSystem[];
  /** Explicit pacts, active and ended: never deleted while the world exists. */
  agreements: DiplomaticAgreement[];
  /** One record per political instance that has ever had dealings with anyone. */
  reputations: DiplomaticReputation[];
  /** What each people believes about the others it has met (empty in older worlds). */
  knowledge: CivilizationKnowledge[];
  /** Explicit political relations and fusions (empty in worlds created before they existed). */
  vassalages: VassalRelationship[];
  occupations: Occupation[];
  composites: CompositeIdentity[];
}

export interface SimulationResult {
  ticksRun: number;
  partial: boolean;
  events: HistoricalEvent[];
  stats: TickStats[];
  civStats: CivilizationStats[];
}
