import {
  normalizeCell,
  normalizePerson,
  normalizeRelationship,
  normalizeSettlement,
  normalizeStock,
  normalizeTribe,
  tierFromLevel,
  type Cell,
  type CompositeIdentity,
  type Occupation,
  type VassalRelationship,
  type CivilizationStats,
  type Civilization,
  type BeliefSystem,
  type DiplomaticAgreement,
  type DiplomaticReputation,
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
    techLost: r.techLost ?? {},
    beliefSystemId: r.beliefSystemId ?? null,
    beliefAdherence: r.beliefAdherence ?? 0,
    cultureHistory: r.cultureHistory ?? [],
    resilience: r.resilience ?? null,
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
    identityId: r.identityId,
    identityType: r.identityType,
    absorbedIdentityIds: r.absorbedIdentityIds ?? [],
    absorbedByTribeId: r.absorbedByTribeId,
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
    history: r.history ?? undefined,
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
  identityId: r.identityId,
  identityType: r.identityType,
  politicalStem: r.politicalStem,
  formerNames: r.formerNames ?? [],
  namePattern: r.namePattern ?? null,
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
    fusionYears: r.fusionYears ?? 0,
  } as Relationship);

// --- Political relations and composite identities ---------------------------------------------

export const vassalToRow = (
  worldId: string,
  v: VassalRelationship,
): Insert<typeof s.vassalRelationships> => ({
  worldId,
  ...v,
});

export const vassalFromRow = (r: Select<typeof s.vassalRelationships>): VassalRelationship => ({
  id: r.id,
  seq: r.seq,
  overlordCivilizationId: r.overlordCivilizationId,
  vassalCivilizationId: r.vassalCivilizationId,
  startedAtTick: r.startedAtTick,
  startedYear: r.startedYear,
  endedAtTick: r.endedAtTick,
  endedYear: r.endedYear,
  tributePolicy: r.tributePolicy,
  autonomy: r.autonomy,
  militaryObligation: r.militaryObligation,
  diplomaticStatus: r.diplomaticStatus,
  endReason: r.endReason ?? null,
  totalTribute: r.totalTribute,
  lastTribute: r.lastTribute,
  causeEventId: r.causeEventId,
});

export const occupationToRow = (worldId: string, o: Occupation): Insert<typeof s.occupations> => ({
  worldId,
  ...o,
});

export const occupationFromRow = (r: Select<typeof s.occupations>): Occupation => ({
  id: r.id,
  seq: r.seq,
  occupyingCivilizationId: r.occupyingCivilizationId,
  occupiedCivilizationId: r.occupiedCivilizationId,
  occupiedSettlementId: r.occupiedSettlementId,
  occupiedTerritory: r.occupiedTerritory,
  startedAtTick: r.startedAtTick,
  startedYear: r.startedYear,
  endedAtTick: r.endedAtTick,
  endedYear: r.endedYear,
  occupationPolicy: r.occupationPolicy,
  resistance: r.resistance,
  control: r.control,
  status: r.status,
  upkeepPaid: r.upkeepPaid,
  extracted: r.extracted,
  causeEventId: r.causeEventId,
});

export const compositeToRow = (
  worldId: string,
  c: CompositeIdentity,
): Insert<typeof s.compositeIdentities> => ({
  worldId,
  ...c,
});

export const compositeFromRow = (r: Select<typeof s.compositeIdentities>): CompositeIdentity => ({
  id: r.id,
  seq: r.seq,
  sourceIdentityIds: r.sourceIdentityIds,
  sourceCivilizationIds: r.sourceCivilizationIds,
  memberKey: r.memberKey,
  displayName: r.displayName,
  singularNoun: r.singularNoun,
  adjective: r.adjective,
  adjectiveFeminine: r.adjectiveFeminine,
  collectiveName: r.collectiveName,
  namingProfile: r.namingProfile,
  visualProfile: r.visualProfile,
  culturalProfile: r.culturalProfile,
  createdAtTick: r.createdAtTick,
  createdYear: r.createdYear,
  origin: r.origin,
  status: r.status,
  civilizationId: r.civilizationId,
  causeEventId: r.causeEventId,
});

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
  currentLeaderId: r.currentLeaderId,
  legitimacy: r.legitimacy,
  successionLaw: r.successionLaw as Dynasty["successionLaw"],
  status: r.status as Dynasty["status"],
  endReason: r.endReason as Dynasty["endReason"],
  crises: r.crises,
});

export const beliefToRow = (worldId: string, b: BeliefSystem): Insert<typeof s.beliefSystems> => ({
  worldId,
  ...b,
});

export const beliefFromRow = (r: Select<typeof s.beliefSystems>): BeliefSystem => ({
  id: r.id,
  seq: r.seq,
  name: r.name,
  type: r.type,
  foundedByTribeId: r.foundedByTribeId,
  principles: r.principles ?? [],
  authority: r.authority,
  tolerance: r.tolerance,
  missionaryPressure: r.missionaryPressure,
  cohesionEffect: r.cohesionEffect,
  legitimacyEffect: r.legitimacyEffect,
  conflictRisk: r.conflictRisk,
  createdAtTick: r.createdAtTick,
  createdYear: r.createdYear,
  parentBeliefIds: r.parentBeliefIds ?? [],
  status: r.status,
  endedYear: r.endedYear,
  causeEventId: r.causeEventId,
});

export const agreementToRow = (
  worldId: string,
  a: DiplomaticAgreement,
): Insert<typeof s.diplomaticAgreements> => ({ worldId, ...a });

export const agreementFromRow = (r: Select<typeof s.diplomaticAgreements>): DiplomaticAgreement => ({
  id: r.id,
  seq: r.seq,
  firstCivilizationId: r.firstCivilizationId,
  secondCivilizationId: r.secondCivilizationId,
  type: r.type,
  startedAtTick: r.startedAtTick,
  startedYear: r.startedYear,
  expiresAtYear: r.expiresAtYear,
  endedYear: r.endedYear,
  trustAtStart: r.trustAtStart,
  status: r.status,
  violationCount: r.violationCount,
  lastViolatorId: r.lastViolatorId,
  causeEventId: r.causeEventId,
});

export const reputationToRow = (
  worldId: string,
  r: DiplomaticReputation,
): Insert<typeof s.diplomaticReputations> => ({ worldId, ...r });

export const reputationFromRow = (r: Select<typeof s.diplomaticReputations>): DiplomaticReputation => ({
  civilizationId: r.civilizationId,
  reliability: r.reliability,
  aggression: r.aggression,
  tradeReliability: r.tradeReliability,
  treatyRespect: r.treatyRespect,
  threatLevel: r.threatLevel,
  agreementsSigned: r.agreementsSigned,
  agreementsBroken: r.agreementsBroken,
  updatedAtTick: r.updatedAtTick,
});

export const civStatsToRow = (
  worldId: string,
  st: CivilizationStats,
): Insert<typeof s.civilizationStats> => ({ worldId, ...st });
