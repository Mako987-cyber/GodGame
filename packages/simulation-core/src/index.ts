export * from "./types";
export * from "./constants";
export { Rng, deriveRng, type RngState } from "./prng";
export { createWorld, type CreateWorldOptions } from "./world-generator";
export { generateTerrain, computeHabitability } from "./terrain";
export {
  runSimulation,
  runTick,
  createContext,
  buildCommunities,
  collectStats,
  type RunOptions,
} from "./simulation-engine";
export {
  TECHNOLOGIES,
  TECH_BY_ID,
  techEffects,
  canResearch,
  type TechnologyDefinition,
  type TechEffects,
} from "./technology";
export { resolveBattle, sidePower, type BattleOutcome, type CombatSide } from "./warfare";
export { birthProbability, baseMortality } from "./population";
export { EVENT_TYPE_LABELS, formatYear, describePlace } from "./events";
export {
  serializeWorld,
  deserializeWorld,
  cloneWorld,
  normalizeState,
  hashWorld,
  STATE_VERSION,
} from "./serialization";
export { cellAt, distance, inBounds } from "./grid";
