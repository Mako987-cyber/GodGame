import type {
  Cell,
  Civilization,
  HistoricalEvent,
  Household,
  Person,
  Relationship,
  Settlement,
  TickStats,
  Tribe,
} from "@genesis/simulation-core";
import type * as s from "./schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];
type Select<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export const cellToRow = (worldId: string, c: Cell): Insert<typeof s.worldCells> => ({ worldId, ...c });

export const cellFromRow = (r: Select<typeof s.worldCells>): Cell => ({
  x: r.x,
  y: r.y,
  altitude: r.altitude,
  moisture: r.moisture,
  temperature: r.temperature,
  biome: r.biome as Cell["biome"],
  fertility: r.fertility,
  baseFertility: r.baseFertility,
  water: r.water,
  wood: r.wood,
  maxWood: r.maxWood,
  stone: r.stone,
  fauna: r.fauna,
  maxFauna: r.maxFauna,
  copper: r.copper,
  iron: r.iron,
  habitability: r.habitability,
  river: r.river,
  riverName: r.riverName,
  coastal: r.coastal,
  ownerTribeId: r.ownerTribeId,
  settlementId: r.settlementId,
  road: r.road,
  fields: r.fields,
});

/** Only these cell columns change during a simulation: they are the only ones written back. */
export function cellSignature(c: Cell): string {
  return `${c.fertility}|${c.wood}|${c.stone}|${c.fauna}|${c.copper}|${c.habitability}|${c.ownerTribeId}|${c.settlementId}|${c.road}|${c.fields}|${c.biome}`;
}

export const tribeToRow = (worldId: string, t: Tribe): Insert<typeof s.tribes> => {
  const { stock, ...rest } = t;
  return { worldId, ...rest, ...stock };
};

export const tribeFromRow = (r: Select<typeof s.tribes>): Tribe => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  color: r.color,
  status: r.status,
  x: r.x,
  y: r.y,
  stock: { food: r.food, wood: r.wood, stone: r.stone, copper: r.copper },
  techs: r.techs,
  techProgress: r.techProgress,
  yearsAtLocation: r.yearsAtLocation,
  scarcityYears: r.scarcityYears,
  foundedYear: r.foundedYear,
  extinctYear: r.extinctYear,
  civilizationId: r.civilizationId,
  leaderId: r.leaderId,
  parentTribeId: r.parentTribeId,
  morale: r.morale,
  populationMilestone: r.populationMilestone,
  lastFoodProduced: r.lastFoodProduced,
  lastFoodConsumed: r.lastFoodConsumed,
  lastFoodRatio: r.lastFoodRatio,
});

export const personToRow = (worldId: string, p: Person): Insert<typeof s.people> => ({ worldId, ...p });

export const personFromRow = (r: Select<typeof s.people>): Person => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  tribeId: r.tribeId,
  settlementId: r.settlementId,
  householdId: r.householdId,
  motherId: r.motherId,
  fatherId: r.fatherId,
  birthYear: r.birthYear,
  age: r.age,
  sex: r.sex,
  health: r.health,
  hunger: r.hunger,
  energy: r.energy,
  x: r.x,
  y: r.y,
  role: r.role as Person["role"],
  action: r.action as Person["action"],
  skills: r.skills,
  personality: r.personality,
  alive: r.alive,
  deathYear: r.deathYear,
  deathCause: r.deathCause as Person["deathCause"],
  knowledge: r.knowledge,
  lastChildYear: r.lastChildYear,
  notable: r.notable,
});

export const householdToRow = (worldId: string, h: Household): Insert<typeof s.households> => ({
  worldId,
  id: h.id,
  seq: h.seq,
  tribeId: h.tribeId,
  partnerAId: h.partnerIds[0],
  partnerBId: h.partnerIds[1],
  formedYear: h.formedYear,
  dissolvedYear: h.dissolvedYear,
});

export const householdFromRow = (r: Select<typeof s.households>): Household => ({
  id: r.id,
  seq: r.seq,
  tribeId: r.tribeId,
  partnerIds: [r.partnerAId, r.partnerBId],
  formedYear: r.formedYear,
  dissolvedYear: r.dissolvedYear,
});

export const settlementToRow = (worldId: string, st: Settlement): Insert<typeof s.settlements> => {
  const { stock, ...rest } = st;
  return { worldId, ...rest, ...stock };
};

export const settlementFromRow = (r: Select<typeof s.settlements>): Settlement => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  tribeId: r.tribeId,
  civilizationId: r.civilizationId,
  x: r.x,
  y: r.y,
  level: r.level,
  status: r.status,
  foundedYear: r.foundedYear,
  abandonedYear: r.abandonedYear,
  stock: { food: r.food, wood: r.wood, stone: r.stone, copper: r.copper },
  buildings: r.buildings,
  construction: r.construction ?? null,
  defense: r.defense,
  territoryRadius: r.territoryRadius,
  famineYears: r.famineYears,
  roadLinks: r.roadLinks,
  lastProduction: r.lastProduction,
  lastFoodRatio: r.lastFoodRatio,
  population: r.population,
});

export const civilizationToRow = (worldId: string, c: Civilization): Insert<typeof s.civilizations> => ({
  worldId,
  ...c,
});

export const civilizationFromRow = (r: Select<typeof s.civilizations>): Civilization => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  color: r.color,
  founderTribeId: r.founderTribeId,
  capitalSettlementId: r.capitalSettlementId,
  foundedYear: r.foundedYear,
  status: r.status,
});

export const relationshipToRow = (worldId: string, rel: Relationship): Insert<typeof s.relationships> => ({
  worldId,
  ...rel,
});

export const relationshipFromRow = (r: Select<typeof s.relationships>): Relationship => ({
  id: r.id,
  aId: r.aId,
  bId: r.bId,
  trust: r.trust,
  hostility: r.hostility,
  tradeVolume: r.tradeVolume,
  conflictMemory: r.conflictMemory,
  atWar: r.atWar,
  warStartYear: r.warStartYear,
  allied: r.allied,
  distance: r.distance,
  lastInteractionYear: r.lastInteractionYear,
  battles: r.battles,
  truceUntilYear: r.truceUntilYear,
});

export const eventToRow = (worldId: string, e: HistoricalEvent): Insert<typeof s.historicalEvents> => ({
  worldId,
  ...e,
});

export const statsToRow = (worldId: string, st: TickStats): Insert<typeof s.worldStats> => ({
  worldId,
  ...st,
});
