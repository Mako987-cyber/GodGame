import {
  normalizeCell,
  normalizePerson,
  normalizeRelationship,
  normalizeSettlement,
  normalizeStock,
  normalizeTribe,
  tierFromLevel,
  type Cell,
  type CivilizationStats,
  type Civilization,
  type Dynasty,
  type HistoricalEvent,
  type Household,
  type Person,
  type Relationship,
  type Settlement,
  type TickStats,
  type Tribe,
} from "@genesis/simulation-core";
import type * as s from "./schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];
type Select<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export const cellToRow = (worldId: string, c: Cell): Insert<typeof s.worldCells> => ({ worldId, ...c });

/**
 * Cells created before the extended economy have no clay/tin/coal columns: they are derived
 * deterministically from the world seed and the terrain, then persisted on the next save.
 */
export const cellFromRow = (seed: string, r: Select<typeof s.worldCells>): Cell =>
  normalizeCell(seed, {
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
    clay: r.clay as number,
    tin: r.tin as number,
    coal: r.coal as number,
    habitability: r.habitability,
    river: r.river,
    riverName: r.riverName,
    coastal: r.coastal,
    ownerTribeId: r.ownerTribeId,
    settlementId: r.settlementId,
    road: r.road,
    fields: r.fields,
    pastures: r.pastures ?? 0,
  } as Cell);

/** Only these cell columns change during a simulation: they are the only ones written back. */
export function cellSignature(c: Cell): string {
  return [
    c.fertility,
    c.wood,
    c.stone,
    c.fauna,
    c.copper,
    c.iron,
    c.clay,
    c.tin,
    c.coal,
    c.habitability,
    c.ownerTribeId,
    c.settlementId,
    c.road,
    c.fields,
    c.pastures,
    c.biome,
  ].join("|");
}

export const tribeToRow = (worldId: string, t: Tribe): Insert<typeof s.tribes> => {
  const { stock, ...rest } = t;
  return { worldId, ...rest, ...stock, goods: stock.goods };
};

export const tribeFromRow = (seed: string, r: Select<typeof s.tribes>): Tribe =>
  normalizeTribe(seed, {
    id: r.id,
    seq: r.seq,
    name: r.name,
    color: r.color,
    status: r.status,
    x: r.x,
    y: r.y,
    stock: normalizeStock({ food: r.food, wood: r.wood, stone: r.stone, copper: r.copper, goods: r.goods }),
    techs: r.techs,
    techProgress: r.techProgress,
    techAdoption: r.techAdoption ?? {},
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
    culture: r.culture ?? undefined,
    government: r.government ?? undefined,
    stability: r.stability ?? undefined,
    distribution: r.distribution ?? undefined,
    dynastyId: r.dynastyId,
    lastLeaderChangeYear: r.lastLeaderChangeYear,
  } as Tribe);

export const personToRow = (worldId: string, p: Person): Insert<typeof s.people> => ({ worldId, ...p });

export const personFromRow = (r: Select<typeof s.people>): Person =>
  normalizePerson({
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
    prestige: r.prestige,
    education: r.education,
    wealth: r.wealth,
    birthSettlementId: r.birthSettlementId,
    dynastyId: r.dynastyId,
    title: r.title as Person["title"],
    titleSinceYear: r.titleSinceYear,
  } as Person);

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
  return { worldId, ...rest, ...stock, goods: stock.goods };
};

export const settlementFromRow = (r: Select<typeof s.settlements>): Settlement =>
  normalizeSettlement({
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
    stock: normalizeStock({ food: r.food, wood: r.wood, stone: r.stone, copper: r.copper, goods: r.goods }),
    buildings: r.buildings,
    construction: r.construction ?? null,
    defense: r.defense,
    territoryRadius: r.territoryRadius,
    famineYears: r.famineYears,
    roadLinks: r.roadLinks,
    lastProduction: normalizeStock(r.lastProduction),
    lastFoodRatio: r.lastFoodRatio,
    population: r.population,
    tier: (r.tier as Settlement["tier"]) ?? tierFromLevel(r.level),
    hygiene: r.hygiene,
    unrest: r.unrest,
    influence: r.influence,
    founderId: r.founderId,
    lastEpidemicYear: r.lastEpidemicYear,
  } as Settlement);

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

export const relationshipFromRow = (r: Select<typeof s.relationships>): Relationship =>
  normalizeRelationship({
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
    respect: r.respect,
    tradeDependency: r.tradeDependency,
    culturalDistance: r.culturalDistance,
    status: r.status,
    phase: r.phase,
    lastConflictYear: r.lastConflictYear,
    phaseYears: r.phaseYears,
  } as Relationship);

export const eventToRow = (worldId: string, e: HistoricalEvent): Insert<typeof s.historicalEvents> => ({
  worldId,
  ...e,
});

export const statsToRow = (worldId: string, st: TickStats): Insert<typeof s.worldStats> => ({
  worldId,
  ...st,
});

export const dynastyToRow = (worldId: string, d: Dynasty): Insert<typeof s.dynasties> => ({ worldId, ...d });

export const dynastyFromRow = (r: Select<typeof s.dynasties>): Dynasty => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  tribeId: r.tribeId,
  founderId: r.founderId,
  foundedYear: r.foundedYear,
  endedYear: r.endedYear,
  prestige: r.prestige,
  rulers: r.rulers,
});

export const civStatsToRow = (
  worldId: string,
  st: CivilizationStats,
): Insert<typeof s.civilizationStats> => ({ worldId, ...st });
