import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ActiveCrisis,
  BuildingType,
  ConflictPhase,
  ConstructionProject,
  Counters,
  Climate,
  CultureTraits,
  DiplomaticStatus,
  DistributionPolicy,
  EventActor,
  GoodsBag,
  GovernmentType,
  IdentityType,
  JsonValue,
  Personality,
  SimulationConfig,
  Skills,
  Stability,
  WorldRoster,
  WorldSettings,
} from "@genesis/simulation-core";

/**
 * Entity ids inside a world (p12, t3, s5...) are deterministic and scoped by world:
 * every table uses (world_id, id) as primary key so the same seed yields identical ids.
 */
const worldRef = () =>
  uuid("world_id")
    .notNull()
    .references(() => worlds.id, { onDelete: "cascade" });

export interface WorldSummary {
  population: number;
  tribes: number;
  settlements: number;
  civilizations: number;
  technologies: number;
  lastEvent: { title: string; year: number; type: string } | null;
}

export const worlds = pgTable(
  "worlds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    seed: text("seed").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    currentTick: integer("current_tick").notNull().default(0),
    currentYear: integer("current_year").notNull(),
    status: text("status", { enum: ["paused", "running"] })
      .notNull()
      .default("paused"),
    rngState: jsonb("rng_state").$type<[number, number, number, number]>().notNull(),
    settings: jsonb("settings").$type<WorldSettings>().notNull(),
    counters: jsonb("counters").$type<Counters>().notNull(),
    climate: jsonb("climate").$type<Climate>().notNull(),
    summary: jsonb("summary").$type<WorldSummary>().notNull(),
    /** Engine version that produced the stored state; older worlds are migrated on load. */
    simulationVersion: integer("simulation_version").notNull().default(1),
    config: jsonb("config").$type<SimulationConfig | Record<string, never>>().notNull().default({}),
    crises: jsonb("crises").$type<ActiveCrisis[]>().notNull().default([]),
    /**
     * Founding roster of a historical world, written once by `insertWorld` and never updated:
     * reloading or refreshing a world can never re-roll its peoples. `null` for procedural and
     * legacy worlds.
     */
    roster: jsonb("roster").$type<WorldRoster | null>(),
    /** Reserved for future authentication. */
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("worlds_updated_idx").on(t.updatedAt), index("worlds_owner_idx").on(t.ownerId)],
);

export const worldCells = pgTable(
  "world_cells",
  {
    worldId: worldRef(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    altitude: doublePrecision("altitude").notNull(),
    moisture: doublePrecision("moisture").notNull(),
    temperature: doublePrecision("temperature").notNull(),
    biome: text("biome").notNull(),
    fertility: doublePrecision("fertility").notNull(),
    baseFertility: doublePrecision("base_fertility").notNull(),
    water: doublePrecision("water").notNull(),
    wood: doublePrecision("wood").notNull(),
    maxWood: doublePrecision("max_wood").notNull(),
    stone: doublePrecision("stone").notNull(),
    fauna: doublePrecision("fauna").notNull(),
    maxFauna: doublePrecision("max_fauna").notNull(),
    copper: doublePrecision("copper").notNull(),
    iron: doublePrecision("iron").notNull(),
    /** Nullable on purpose: legacy cells derive their deposits deterministically on load. */
    clay: doublePrecision("clay"),
    tin: doublePrecision("tin"),
    coal: doublePrecision("coal"),
    habitability: doublePrecision("habitability").notNull(),
    river: boolean("river").notNull(),
    riverName: text("river_name"),
    coastal: boolean("coastal").notNull(),
    ownerTribeId: text("owner_tribe_id"),
    settlementId: text("settlement_id"),
    road: boolean("road").notNull(),
    fields: integer("fields").notNull(),
    pastures: integer("pastures").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.y, t.x] })],
);

export const tribes = pgTable(
  "tribes",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    status: text("status", { enum: ["nomadic", "settled", "extinct"] }).notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    food: doublePrecision("food").notNull(),
    wood: doublePrecision("wood").notNull(),
    stone: doublePrecision("stone").notNull(),
    copper: doublePrecision("copper").notNull(),
    goods: jsonb("goods").$type<GoodsBag>().notNull().default({}),
    techs: jsonb("techs").$type<string[]>().notNull(),
    techProgress: jsonb("tech_progress").$type<Record<string, number>>().notNull(),
    techAdoption: jsonb("tech_adoption").$type<Record<string, number>>().notNull().default({}),
    yearsAtLocation: integer("years_at_location").notNull(),
    scarcityYears: integer("scarcity_years").notNull(),
    foundedYear: integer("founded_year").notNull(),
    extinctYear: integer("extinct_year"),
    civilizationId: text("civilization_id"),
    leaderId: text("leader_id"),
    parentTribeId: text("parent_tribe_id"),
    morale: doublePrecision("morale").notNull(),
    populationMilestone: integer("population_milestone").notNull(),
    lastFoodProduced: doublePrecision("last_food_produced").notNull(),
    lastFoodConsumed: doublePrecision("last_food_consumed").notNull(),
    lastFoodRatio: doublePrecision("last_food_ratio").notNull(),
    culture: jsonb("culture").$type<CultureTraits | null>(),
    government: text("government").$type<GovernmentType>(),
    stability: jsonb("stability").$type<Stability | null>(),
    distribution: text("distribution").$type<DistributionPolicy>(),
    dynastyId: text("dynasty_id"),
    lastLeaderChangeYear: integer("last_leader_change_year"),
    /**
     * Catalog key of the historical identity. Not unique per world on purpose: a people can
     * split into several polities sharing one identity (uniqueness is enforced on the founding
     * roster, continuity by `parent_tribe_id`).
     */
    identityId: text("identity_id"),
    /** Rows written before identities existed default to `legacy` and are never reassigned. */
    identityType: text("identity_type").$type<IdentityType>().notNull().default("legacy"),
    absorbedIdentityIds: jsonb("absorbed_identity_ids").$type<string[]>().notNull().default([]),
    absorbedByTribeId: text("absorbed_by_tribe_id"),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("tribes_world_seq_idx").on(t.worldId, t.seq),
    index("tribes_world_identity_idx").on(t.worldId, t.identityId),
    index("tribes_world_status_idx").on(t.worldId, t.status),
  ],
);

export const households = pgTable(
  "households",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    tribeId: text("tribe_id").notNull(),
    partnerAId: text("partner_a_id").notNull(),
    partnerBId: text("partner_b_id").notNull(),
    formedYear: integer("formed_year").notNull(),
    dissolvedYear: integer("dissolved_year"),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("households_active_idx")
      .on(t.worldId, t.seq)
      .where(sql`${t.dissolvedYear} is null`),
  ],
);

export const people = pgTable(
  "people",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    tribeId: text("tribe_id").notNull(),
    settlementId: text("settlement_id"),
    householdId: text("household_id"),
    motherId: text("mother_id"),
    fatherId: text("father_id"),
    birthYear: integer("birth_year").notNull(),
    age: integer("age").notNull(),
    sex: text("sex", { enum: ["M", "F"] }).notNull(),
    health: doublePrecision("health").notNull(),
    hunger: doublePrecision("hunger").notNull(),
    energy: doublePrecision("energy").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    role: text("role").notNull(),
    action: text("action").notNull(),
    skills: jsonb("skills").$type<Skills>().notNull(),
    personality: jsonb("personality").$type<Personality>().notNull(),
    alive: boolean("alive").notNull(),
    deathYear: integer("death_year"),
    deathCause: text("death_cause"),
    knowledge: jsonb("knowledge").$type<string[]>().notNull(),
    lastChildYear: integer("last_child_year"),
    notable: boolean("notable").notNull(),
    prestige: doublePrecision("prestige").notNull().default(0),
    education: doublePrecision("education").notNull().default(0),
    wealth: doublePrecision("wealth").notNull().default(0),
    birthSettlementId: text("birth_settlement_id"),
    dynastyId: text("dynasty_id"),
    title: text("title"),
    titleSinceYear: integer("title_since_year"),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    // Only living people are loaded by the simulation: keep that path on a partial index.
    index("people_alive_idx")
      .on(t.worldId, t.seq)
      .where(sql`${t.alive}`),
    index("people_tribe_idx").on(t.worldId, t.tribeId),
    // Notable people are the ones the UI shows in detail.
    index("people_notable_idx")
      .on(t.worldId, t.prestige)
      .where(sql`${t.notable}`),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    tribeId: text("tribe_id").notNull(),
    civilizationId: text("civilization_id"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    level: integer("level").notNull(),
    status: text("status", { enum: ["active", "abandoned"] }).notNull(),
    foundedYear: integer("founded_year").notNull(),
    abandonedYear: integer("abandoned_year"),
    food: doublePrecision("food").notNull(),
    wood: doublePrecision("wood").notNull(),
    stone: doublePrecision("stone").notNull(),
    copper: doublePrecision("copper").notNull(),
    goods: jsonb("goods").$type<GoodsBag>().notNull().default({}),
    buildings: jsonb("buildings").$type<Record<BuildingType, number>>().notNull(),
    construction: jsonb("construction").$type<ConstructionProject | null>(),
    defense: doublePrecision("defense").notNull(),
    territoryRadius: integer("territory_radius").notNull(),
    famineYears: integer("famine_years").notNull(),
    roadLinks: jsonb("road_links").$type<string[]>().notNull(),
    lastProduction: jsonb("last_production")
      .$type<{ food: number; wood: number; stone: number; copper: number; goods?: GoodsBag }>()
      .notNull(),
    lastFoodRatio: doublePrecision("last_food_ratio").notNull(),
    population: integer("population").notNull(),
    tier: text("tier"),
    hygiene: doublePrecision("hygiene").notNull().default(0.8),
    unrest: doublePrecision("unrest").notNull().default(0.05),
    influence: doublePrecision("influence").notNull().default(1),
    founderId: text("founder_id"),
    lastEpidemicYear: integer("last_epidemic_year"),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("settlements_world_coords_idx").on(t.worldId, t.x, t.y),
  ],
);

export const civilizations = pgTable(
  "civilizations",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    founderTribeId: text("founder_tribe_id").notNull(),
    capitalSettlementId: text("capital_settlement_id"),
    foundedYear: integer("founded_year").notNull(),
    status: text("status", { enum: ["active", "collapsed"] }).notNull(),
    identityId: text("identity_id"),
    identityType: text("identity_type").$type<IdentityType>().notNull().default("legacy"),
    politicalStem: text("political_stem"),
    formerNames: jsonb("former_names").$type<string[]>().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    index("civilizations_world_identity_idx").on(t.worldId, t.identityId),
    index("civilizations_world_status_idx").on(t.worldId, t.status),
  ],
);

/** Global catalog, seeded from the simulation core definitions. */
export const technologies = pgTable("technologies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  prerequisites: jsonb("prerequisites").$type<string[]>().notNull(),
  cost: integer("cost").notNull(),
  minPopulation: integer("min_population").notNull(),
  requiresSettlement: boolean("requires_settlement").notNull(),
  resourceRequirement: text("resource_requirement").notNull(),
  geographyRequirement: text("geography_requirement"),
  effects: jsonb("effects").$type<Record<string, number>>().notNull(),
  effectSummary: text("effect_summary").notNull(),
});

export const worldTechnologies = pgTable(
  "world_technologies",
  {
    worldId: worldRef(),
    tribeId: text("tribe_id").notNull(),
    techId: text("tech_id")
      .notNull()
      .references(() => technologies.id),
    discoveredYear: integer("discovered_year").notNull(),
    discoveredTick: integer("discovered_tick").notNull(),
    method: text("method").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.tribeId, t.techId] })],
);

export const relationships = pgTable(
  "relationships",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    aId: text("a_id").notNull(),
    bId: text("b_id").notNull(),
    trust: doublePrecision("trust").notNull(),
    hostility: doublePrecision("hostility").notNull(),
    tradeVolume: doublePrecision("trade_volume").notNull(),
    conflictMemory: doublePrecision("conflict_memory").notNull(),
    atWar: boolean("at_war").notNull(),
    warStartYear: integer("war_start_year"),
    allied: boolean("allied").notNull(),
    distance: integer("distance").notNull(),
    lastInteractionYear: integer("last_interaction_year").notNull(),
    battles: integer("battles").notNull(),
    truceUntilYear: integer("truce_until_year"),
    respect: doublePrecision("respect").notNull().default(0.1),
    tradeDependency: doublePrecision("trade_dependency").notNull().default(0),
    culturalDistance: doublePrecision("cultural_distance").notNull().default(0.3),
    status: text("status").$type<DiplomaticStatus>().notNull().default("contact"),
    phase: text("phase").$type<ConflictPhase>().notNull().default("peace"),
    lastConflictYear: integer("last_conflict_year"),
    phaseYears: integer("phase_years").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.id] })],
);

export const historicalEvents = pgTable(
  "historical_events",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    type: text("type").notNull(),
    subtype: text("subtype"),
    importance: integer("importance").notNull(),
    actors: jsonb("actors").$type<EventActor[]>().notNull(),
    causeEventIds: jsonb("cause_event_ids").$type<string[]>().notNull().default([]),
    x: integer("x"),
    y: integer("y"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    metadata: jsonb("metadata").$type<Record<string, JsonValue>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    // Timeline: newest first, optionally filtered by type or minimum importance.
    index("events_world_seq_idx").on(t.worldId, t.seq),
    index("events_world_tick_idx").on(t.worldId, t.tick),
    index("events_world_year_idx").on(t.worldId, t.year),
    index("events_world_importance_idx").on(t.worldId, t.importance, t.seq),
    index("events_world_type_idx").on(t.worldId, t.type, t.seq),
  ],
);

export const worldStats = pgTable(
  "world_stats",
  {
    worldId: worldRef(),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    population: integer("population").notNull(),
    tribes: integer("tribes").notNull(),
    settlements: integer("settlements").notNull(),
    civilizations: integer("civilizations").notNull(),
    foodProduced: doublePrecision("food_produced").notNull(),
    foodConsumed: doublePrecision("food_consumed").notNull(),
    foodStored: doublePrecision("food_stored").notNull(),
    technologies: integer("technologies").notNull(),
    wars: integer("wars").notNull(),
    battles: integer("battles").notNull(),
    births: integer("births").notNull(),
    deaths: integer("deaths").notNull(),
    starvationDeaths: integer("starvation_deaths").notNull(),
    conflictDeaths: integer("conflict_deaths").notNull(),
    epidemicDeaths: integer("epidemic_deaths").notNull().default(0),
    foodSurplus: doublePrecision("food_surplus").notNull().default(0),
    storageCapacity: doublePrecision("storage_capacity").notNull().default(0),
    goodsProduced: doublePrecision("goods_produced").notNull().default(0),
    tradeVolume: doublePrecision("trade_volume").notNull().default(0),
    wealth: doublePrecision("wealth").notNull().default(0),
    buildings: integer("buildings").notNull().default(0),
    territory: integer("territory").notNull().default(0),
    averageTemperature: doublePrecision("average_temperature").notNull().default(0.5),
    climateStress: doublePrecision("climate_stress").notNull().default(0),
    averageStability: doublePrecision("average_stability").notNull().default(0),
    migrations: integer("migrations").notNull().default(0),
    season: text("season").notNull().default("winter"),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.tick] }), index("world_stats_year_idx").on(t.worldId, t.year)],
);

export const worldSnapshots = pgTable(
  "world_snapshots",
  {
    worldId: worldRef(),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    stateVersion: integer("state_version").notNull(),
    /** Full serialized WorldState (living entities only): base for replays and rollbacks. */
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.tick] })],
);

/** Ruling families: they outlive their members and give continuity to the political history. */
export const dynasties = pgTable(
  "dynasties",
  {
    worldId: worldRef(),
    id: text("id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    tribeId: text("tribe_id").notNull(),
    founderId: text("founder_id").notNull(),
    foundedYear: integer("founded_year").notNull(),
    endedYear: integer("ended_year"),
    prestige: doublePrecision("prestige").notNull(),
    rulers: integer("rulers").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.id] }), index("dynasties_tribe_idx").on(t.worldId, t.tribeId)],
);

/** Per-civilization time series, written every `observability.civStatsInterval` ticks. */
export const civilizationStats = pgTable(
  "civilization_stats",
  {
    worldId: worldRef(),
    civilizationId: text("civilization_id").notNull(),
    tick: integer("tick").notNull(),
    year: integer("year").notNull(),
    population: integer("population").notNull(),
    settlements: integer("settlements").notNull(),
    technologies: integer("technologies").notNull(),
    foodStored: doublePrecision("food_stored").notNull(),
    wealth: doublePrecision("wealth").notNull(),
    territory: integer("territory").notNull(),
    stability: doublePrecision("stability").notNull(),
    atWar: boolean("at_war").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.civilizationId, t.tick] }),
    index("civ_stats_world_tick_idx").on(t.worldId, t.tick),
  ],
);

export const simulationLocks = pgTable("simulation_locks", {
  worldId: uuid("world_id")
    .primaryKey()
    .references(() => worlds.id, { onDelete: "cascade" }),
  token: uuid("token").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worldId: worldRef(),
    fromTick: integer("from_tick").notNull(),
    toTick: integer("to_tick").notNull(),
    requestedTicks: integer("requested_ticks").notNull(),
    ticksRun: integer("ticks_run").notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: text("status", { enum: ["completed", "partial", "failed"] }).notNull(),
    eventsCount: integer("events_count").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("simulation_runs_world_idx").on(t.worldId, t.createdAt)],
);

export type WorldRow = typeof worlds.$inferSelect;
export type TribeRow = typeof tribes.$inferSelect;
export type CivilizationRow = typeof civilizations.$inferSelect;
export type DynastyRow = typeof dynasties.$inferSelect;
export type CivilizationStatsRow = typeof civilizationStats.$inferSelect;
export type EventRow = typeof historicalEvents.$inferSelect;
export type StatsRow = typeof worldStats.$inferSelect;
