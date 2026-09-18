export * from "./types";
export * from "./constants";
export {
  DEFAULT_SIMULATION_CONFIG,
  DISTRIBUTION_POLICY_LABELS,
  SEASONS,
  SEASON_LABELS,
  parseSimulationConfig,
  seasonWeights,
  simulationConfigSchema,
  type DistributionPolicy,
  type Season,
  type SimulationConfig,
} from "./config";
export {
  CORE_RESOURCES,
  EXTRA_RESOURCES,
  RESOURCES,
  RESOURCE_LABELS,
  RESOURCE_VALUE,
  addBundle,
  addResource,
  bundleEntries,
  bundleTotal,
  clampResource,
  consumeResource,
  emptyStock,
  getResourceAmount,
  hasRequiredResources,
  missingResources,
  normalizeStock,
  payResources,
  roundStock,
  stockToBundle,
  stockValue,
  transferResource,
  type CoreResource,
  type ExtraResource,
  type GoodsBag,
  type ResourceKind,
} from "./stock";
export { Rng, deriveRng, hashCode, hashFloat, type RngState } from "./prng";
export { createWorld, type CreateWorldOptions } from "./world-generator";
export { generateTerrain, computeHabitability } from "./terrain";
export {
  runSimulation,
  runTick,
  createContext,
  buildCommunities,
  collectStats,
  collectCivilizationStats,
  type RunOptions,
} from "./simulation-engine";
export {
  TECHNOLOGIES,
  TECH_BY_ID,
  TECH_CATEGORY_LABELS,
  TECH_STATUS_LABELS,
  advanceAdoption,
  canResearch,
  neutralEffects,
  techEffects,
  techStatus,
  tribeEffects,
  type TechCategory,
  type TechEffects,
  type TechStatus,
  type TechnologyDefinition,
} from "./technology";
export { resolveBattle, sidePower, type BattleOutcome, type CombatSide } from "./warfare";
export { birthProbability, baseMortality, related } from "./population";
export { EVENT_TYPE_LABELS, IMPORTANCE_LABELS, formatYear, describePlace } from "./events";
export {
  serializeWorld,
  deserializeWorld,
  deserializeState,
  cloneWorld,
  normalizeState,
  hashWorld,
  STATE_VERSION,
  MIN_SUPPORTED_STATE_VERSION,
  SIMULATION_VERSION,
} from "./serialization";
export {
  SIMULATION_VERSION as ENGINE_VERSION,
  deriveCulture,
  deriveDeposits,
  migrateState,
  normalizeCell,
  normalizePerson,
  normalizeRelationship,
  normalizeSettlement,
  normalizeSkills,
  normalizeTribe,
  tierFromLevel,
} from "./normalize";
export { checkInvariants, assertInvariants, InvariantError, type InvariantOptions } from "./invariants";
export {
  CULTURE_LABELS,
  culturalDistance,
  initialStability,
  randomCulture,
  type CulturePressure,
} from "./culture";
export { leaderScore, leaderScoreParts, heirsOf, isEligibleLeader } from "./leadership";
export { epidemicRisk, type EpidemicRisk } from "./crises";
export {
  annualYieldAt,
  averageTemperature,
  cellClimate,
  climateAt,
  climateStress,
  computeSeasons,
  hazardsAt,
  seasonYieldAt,
  winterConsumptionFactor,
  winterMortalityFactor,
} from "./climate";
export { areaDeposits, areaQuality, workArea } from "./resources";
export { foodNeed, housingCapacity, storageCapacity, type Production } from "./economy";
export {
  SETTLE_AFTER_YEARS,
  TIER_REQUIREMENTS,
  computeLevel,
  tierOf,
  type TierRequirement,
} from "./settlements";
export { cellAt, distance, inBounds, clamp, round } from "./grid";
