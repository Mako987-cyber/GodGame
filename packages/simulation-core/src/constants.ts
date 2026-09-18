import type { ResourceBundle } from "./stock";
import type { Biome, BuildingType, GovernmentType, SettlementTier, WorldSettings } from "./types";

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

export const BIOME_LABELS: Record<Biome, string> = {
  ocean: "oceano",
  coast: "costa",
  plains: "pianura",
  forest: "foresta",
  hills: "collina",
  mountain: "montagna",
  desert: "deserto",
  tundra: "tundra",
};

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
  // Base yields are calibrated against the seasonal model: a year is split across four
  // seasons, so the per-season figures have to add up to a viable annual harvest.
  gatherYield: 1.55,
  huntYield: 1.95,
  farmYield: 3,
  herdYield: 2.4,
  fishYield: 2.1,
  fishingBonus: 0.25,
  /** Max share of a cell's natural food that can be taken in one year. */
  harvestFraction: 0.45,
  faunaRegenRate: 0.45,
  woodRegenRate: 0.06,
  fertilityRecovery: 0.03,
  fieldDepletion: 0.006,
  farmersPerField: 4,
  herdersPerPasture: 3,
  maxFieldsPerCell: 2,
  maxPasturesPerCell: 1,
  bandCarryPerPerson: 0.8,
  baseSpoilage: 0.25,
  /** Annual spoilage of hides and worked textiles. */
  hideSpoilage: 0.12,
  fuelWoodPerPerson: 0.15,
  /** Units of ore a single miner can extract in one year. */
  minerYield: 2.4,
  /** Units of tools a single crafter produces in one year. */
  crafterYield: 0.9,
  /** Tools consumed every year by the working population (wear and tear). */
  toolWear: 0.02,
  /** Extra production every worker gets when the group holds enough tools. */
  toolBonus: 0.25,
} as const;

export const BUILDING_TYPES: readonly BuildingType[] = [
  "camp",
  "hut",
  "storehouse",
  "farm",
  "road",
  "palisade",
  "pasture",
  "well",
  "quarry",
  "mine",
  "kiln",
  "foundry",
  "market",
  "temple",
  "barracks",
  "walls",
  "port",
];

export interface BuildingDefinition {
  label: string;
  description: string;
  cost: ResourceBundle;
  /** Person-years of work required. */
  work: number;
  requiresTech: string | null;
  /** Minimum settlement level. */
  minLevel: number;
  /** Yearly upkeep, paid from the settlement stock when available. */
  upkeep: ResourceBundle;
  effectSummary: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDefinition> = {
  camp: {
    label: "accampamento",
    description: "Il nucleo originario dell'insediamento.",
    cost: {},
    work: 0,
    requiresTech: null,
    minLevel: 1,
    upkeep: {},
    effectSummary: "Ospita fino a 15 persone",
  },
  hut: {
    label: "capanne",
    description: "Abitazioni stabili in legno e fango.",
    cost: { wood: 14 },
    work: 8,
    requiresTech: null,
    minLevel: 1,
    upkeep: {},
    effectSummary: "+8 posti abitativi",
  },
  storehouse: {
    label: "magazzino",
    description: "Silos e fosse per conservare le scorte.",
    cost: { wood: 20, stone: 12 },
    work: 18,
    requiresTech: null,
    minLevel: 1,
    upkeep: {},
    effectSummary: "+90 capacità di stoccaggio, meno sprechi",
  },
  farm: {
    label: "campo agricolo",
    description: "Terra dissodata e seminata.",
    cost: { wood: 5 },
    work: 12,
    requiresTech: "agriculture",
    minLevel: 1,
    upkeep: {},
    effectSummary: "Fino a 4 agricoltori produttivi",
  },
  road: {
    label: "strada",
    description: "Pista battuta e selciata tra due insediamenti.",
    cost: { stone: 16 },
    work: 20,
    requiresTech: null,
    minLevel: 2,
    upkeep: {},
    effectSummary: "Dimezza la distanza per scambi e soccorsi",
  },
  palisade: {
    label: "palizzata",
    description: "Recinto di pali appuntiti attorno all'abitato.",
    cost: { wood: 40 },
    work: 26,
    requiresTech: null,
    minLevel: 1,
    upkeep: {},
    effectSummary: "+50% difesa",
  },
  pasture: {
    label: "pascolo",
    description: "Terreno recintato per capre, pecore e bovini.",
    cost: { wood: 10 },
    work: 14,
    requiresTech: "animal_husbandry",
    minLevel: 1,
    upkeep: {},
    effectSummary: "Cibo e pelli anche d'inverno",
  },
  well: {
    label: "pozzo",
    description: "Pozzo e canali per l'acqua potabile.",
    cost: { stone: 18, wood: 6 },
    work: 20,
    requiresTech: "irrigation",
    minLevel: 2,
    upkeep: {},
    effectSummary: "+igiene, meno epidemie, campi irrigati",
  },
  quarry: {
    label: "cava",
    description: "Fronte di cava per estrarre pietra da costruzione.",
    cost: { wood: 12 },
    work: 22,
    requiresTech: "stone_tools",
    minLevel: 2,
    upkeep: {},
    effectSummary: "+pietra estratta ogni anno",
  },
  mine: {
    label: "miniera",
    description: "Gallerie per rame, stagno, ferro e carbone.",
    cost: { wood: 26, stone: 10 },
    work: 34,
    requiresTech: "copper_working",
    minLevel: 2,
    upkeep: { wood: 1 },
    effectSummary: "+minerali estratti, si esaurisce col tempo",
  },
  kiln: {
    label: "fornace da ceramica",
    description: "Forno per cuocere vasi e mattoni.",
    cost: { clay: 20, wood: 14 },
    work: 24,
    requiresTech: "pottery",
    minLevel: 2,
    upkeep: { wood: 1 },
    effectSummary: "-40% deperimento, +capacità",
  },
  foundry: {
    label: "fonderia",
    description: "Officina per fondere e legare i metalli.",
    cost: { stone: 26, clay: 14, wood: 18 },
    work: 44,
    requiresTech: "bronze_working",
    minLevel: 3,
    upkeep: { fuel: 2 },
    effectSummary: "Trasforma minerali in strumenti",
  },
  market: {
    label: "mercato",
    description: "Piazza degli scambi e dei pesi.",
    cost: { wood: 22, stone: 16 },
    work: 30,
    requiresTech: "long_distance_trade",
    minLevel: 3,
    upkeep: {},
    effectSummary: "+volume di scambio, +ricchezza",
  },
  temple: {
    label: "tempio",
    description: "Recinto sacro e luogo rituale.",
    cost: { stone: 30, wood: 14 },
    work: 40,
    requiresTech: null,
    minLevel: 3,
    upkeep: { food: 2 },
    effectSummary: "+coesione, +legittimità",
  },
  barracks: {
    label: "caserma",
    description: "Alloggi e addestramento dei guerrieri.",
    cost: { wood: 28, stone: 12 },
    work: 36,
    requiresTech: "military_org",
    minLevel: 3,
    upkeep: { food: 3 },
    effectSummary: "+forza militare, +ordine",
  },
  walls: {
    label: "mura",
    description: "Cinta muraria in pietra.",
    cost: { stone: 90, wood: 20 },
    work: 90,
    requiresTech: "advanced_construction",
    minLevel: 3,
    upkeep: { stone: 1 },
    effectSummary: "+150% difesa, resiste agli assedi",
  },
  port: {
    label: "porto",
    description: "Approdo e magazzini sul mare o sul fiume navigabile.",
    cost: { wood: 40, stone: 20 },
    work: 48,
    requiresTech: "fishing",
    minLevel: 2,
    upkeep: { wood: 1 },
    effectSummary: "Commercio costiero, +pesca",
  },
};

export const HOUSING = { camp: 15, hut: 8 } as const;
export const STORAGE = { settlementBase: 30, storehouse: 90, kiln: 40 } as const;

export const SETTLEMENT_TIER_LABELS: Record<SettlementTier, string> = {
  camp: "accampamento",
  village: "villaggio",
  town: "città",
  city_state: "città-stato",
  capital: "capitale",
};

export const GOVERNMENT_LABELS: Record<GovernmentType, string> = {
  clan: "clan",
  elder_council: "consiglio degli anziani",
  chiefdom: "chiefdom",
  tribal_monarchy: "monarchia tribale",
  city_state: "città-stato",
  merchant_republic: "repubblica mercantile",
};

export interface GovernmentProfile {
  /** Fraction of production the leadership takes from the group. */
  taxation: number;
  /** How fast the group can react (research, construction). */
  decisiveness: number;
  /** Baseline legitimacy the form itself provides. */
  legitimacy: number;
  /** Multiplier on revolt risk. */
  revoltRisk: number;
  militaryMultiplier: number;
  innovationMultiplier: number;
  tradeMultiplier: number;
  /** How succession is resolved. */
  succession: "consensus" | "seniority" | "strength" | "hereditary" | "election";
}

export const GOVERNMENTS: Record<GovernmentType, GovernmentProfile> = {
  clan: {
    taxation: 0.02,
    decisiveness: 0.8,
    legitimacy: 0.6,
    revoltRisk: 0.7,
    militaryMultiplier: 0.95,
    innovationMultiplier: 1,
    tradeMultiplier: 0.9,
    succession: "consensus",
  },
  elder_council: {
    taxation: 0.04,
    decisiveness: 0.75,
    legitimacy: 0.7,
    revoltRisk: 0.6,
    militaryMultiplier: 0.95,
    innovationMultiplier: 1.1,
    tradeMultiplier: 1,
    succession: "seniority",
  },
  chiefdom: {
    taxation: 0.08,
    decisiveness: 1.05,
    legitimacy: 0.6,
    revoltRisk: 1,
    militaryMultiplier: 1.1,
    innovationMultiplier: 1,
    tradeMultiplier: 1,
    succession: "strength",
  },
  tribal_monarchy: {
    taxation: 0.12,
    decisiveness: 1.15,
    legitimacy: 0.65,
    revoltRisk: 1.15,
    militaryMultiplier: 1.2,
    innovationMultiplier: 0.95,
    tradeMultiplier: 1.05,
    succession: "hereditary",
  },
  city_state: {
    taxation: 0.14,
    decisiveness: 1.2,
    legitimacy: 0.7,
    revoltRisk: 1,
    militaryMultiplier: 1.15,
    innovationMultiplier: 1.2,
    tradeMultiplier: 1.15,
    succession: "election",
  },
  merchant_republic: {
    taxation: 0.16,
    decisiveness: 1.1,
    legitimacy: 0.75,
    revoltRisk: 0.9,
    militaryMultiplier: 1.05,
    innovationMultiplier: 1.3,
    tradeMultiplier: 1.4,
    succession: "election",
  },
};

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
