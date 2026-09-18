import type { Biome, BuildingType, WorldSettings } from "./types";

export const DEFAULT_SETTINGS: WorldSettings = {
  width: 48,
  height: 48,
  startYear: -10000,
  minTribes: 3,
  maxTribes: 6,
  minTribeSize: 15,
  maxTribeSize: 40,
  settlementMinPopulation: 25,
  raidGraceYears: 40,
  warGraceYears: 150,
  populationSoftCap: 1500,
};

export const MIN_MAP_SIZE = 24;
export const MAX_MAP_SIZE = 96;

export const BIOMES: readonly Biome[] = [
  "ocean",
  "coast",
  "plains",
  "forest",
  "hills",
  "mountain",
  "desert",
  "tundra",
];

export interface BiomeProfile {
  fertility: number;
  maxFauna: number;
  maxWood: number;
  stone: number;
  habitabilityModifier: number;
}

export const BIOME_PROFILES: Record<Biome, BiomeProfile> = {
  ocean: { fertility: 0, maxFauna: 0, maxWood: 0, stone: 0, habitabilityModifier: -1 },
  coast: { fertility: 0.5, maxFauna: 20, maxWood: 15, stone: 15, habitabilityModifier: 0.1 },
  plains: { fertility: 0.75, maxFauna: 22, maxWood: 25, stone: 15, habitabilityModifier: 0.1 },
  forest: { fertility: 0.55, maxFauna: 28, maxWood: 100, stone: 20, habitabilityModifier: 0 },
  hills: { fertility: 0.4, maxFauna: 16, maxWood: 35, stone: 70, habitabilityModifier: -0.05 },
  mountain: { fertility: 0.1, maxFauna: 6, maxWood: 12, stone: 100, habitabilityModifier: -0.45 },
  desert: { fertility: 0.08, maxFauna: 4, maxWood: 2, stone: 40, habitabilityModifier: -0.3 },
  tundra: { fertility: 0.15, maxFauna: 10, maxWood: 8, stone: 30, habitabilityModifier: -0.25 },
};

/** Economy constants: 1 unit of food = what one adult eats in one year. */
export const ECONOMY = {
  adultNeed: 1,
  childNeed: 0.6,
  elderNeed: 0.8,
  gatherYield: 1.35,
  huntYield: 1.7,
  farmYield: 2.6,
  fishingBonus: 0.25,
  /** Max share of a cell's natural food that can be taken in one year. */
  harvestFraction: 0.45,
  faunaRegenRate: 0.45,
  woodRegenRate: 0.06,
  fertilityRecovery: 0.03,
  fieldDepletion: 0.006,
  farmersPerField: 4,
  maxFieldsPerCell: 2,
  bandCarryPerPerson: 0.8,
  baseSpoilage: 0.25,
  fuelWoodPerPerson: 0.15,
} as const;

export interface BuildingDefinition {
  label: string;
  wood: number;
  stone: number;
  work: number;
  requiresTech: string | null;
}

export const BUILDINGS: Record<BuildingType, BuildingDefinition> = {
  camp: { label: "accampamento", wood: 0, stone: 0, work: 0, requiresTech: null },
  hut: { label: "capanne", wood: 14, stone: 0, work: 8, requiresTech: null },
  storehouse: { label: "magazzino", wood: 20, stone: 12, work: 18, requiresTech: null },
  farm: { label: "campo agricolo", wood: 5, stone: 0, work: 12, requiresTech: "agriculture" },
  road: { label: "strada", wood: 0, stone: 16, work: 20, requiresTech: null },
  palisade: { label: "palizzata", wood: 40, stone: 0, work: 26, requiresTech: null },
};

export const HOUSING = { camp: 15, hut: 8 } as const;
export const STORAGE = { settlementBase: 30, storehouse: 90 } as const;

export const AGE = {
  adult: 16,
  workingChild: 10,
  elder: 58,
  fertileMin: 16,
  fertileMax: 45,
  combatMax: 50,
} as const;

/** Annual base probability of natural death by age bracket (upper bound exclusive). */
export const MORTALITY: ReadonlyArray<readonly [number, number]> = [
  [1, 0.1],
  [5, 0.025],
  [16, 0.006],
  [40, 0.009],
  [55, 0.02],
  [65, 0.05],
  [75, 0.11],
  [85, 0.2],
  [Infinity, 0.35],
];

export const CONTACT_DISTANCE = 14;
export const TRIBE_COLORS = [
  "#e4572e",
  "#29a8ab",
  "#f3a712",
  "#a23b72",
  "#6bb86b",
  "#5f7ee8",
  "#d17bd6",
  "#c0c0c0",
  "#ff8c61",
  "#3ec1d3",
  "#b3d334",
  "#ef476f",
] as const;
