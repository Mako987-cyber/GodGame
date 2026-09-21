import {
  FOUNDING_REASON_LABELS,
  SPECIALIZATION_LABELS,
  TECHNOLOGIES,
  TECH_BY_ID,
  canBeLost,
  canDiffuse,
  canResearch,
  researchAptitude,
  researchWeight,
  variantByKey,
  viewOf,
  techAffinity,
  techStatus,
  type TechConditionInput,
  type TechnologyDefinition,
  type Tribe,
} from "@genesis/simulation-core";
import { and, asc, eq } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { knowledgeFromRow, tribeFromRow } from "@/lib/db/mappers";
import { getWorldRow, listEvents } from "@/lib/db/queries";
import { notFound } from "@/lib/utils/errors";
import {
  TECH_STATUSES,
  civilizationKnowledgeSchema,
  civilizationTechnologyPageSchema,
  discoverableTechnologyPageSchema,
  technologyHistorySchema,
  settlementHistorySchema,
  worldTechnologiesSchema,
  type CivilizationKnowledgeDTO,
  type CivilizationTechnologyPageDTO,
  type CivilizationTechnologyQuery,
  type DiscoverableTechnologyPageDTO,
  type SettlementHistoryDTO,
  type SettlementHistoryQuery,
  type TechnologyHistoryDTO,
  type WorldTechnologiesDTO,
} from "@/lib/validation/technology";

/**
 * Technology as the API exposes it.
 *
 * The catalogue is static and shared by every world, so its serialised form is built once per
 * server instance. Everything else is read with targeted queries on `world_technologies` and
 * `tribes`: no endpoint here loads a whole world, and none of them queries per row.
 *
 * A technology in the catalogue is never presented as something everybody has: every response
 * says who actually holds it.
 */

/** Serialised catalogue, built once: the definitions never change at runtime. */
const DEFINITIONS = TECHNOLOGIES.map((tech) => ({
  id: tech.id,
  name: tech.name,
  category: tech.category,
  description: tech.description,
  prerequisites: [...tech.prerequisites],
  cost: tech.cost,
  minPopulation: tech.minPopulation,
  requiresSettlement: tech.requiresSettlement,
  resourceRequirement: tech.resourceRequirement,
  geographyRequirement: tech.geographyRequirement,
  effectSummary: tech.effectSummary,
  tradeOff: tech.tradeOff,
  canDiffuse: canDiffuse(tech),
  canBeLost: canBeLost(tech),
}));

const DEFINITION_BY_ID = new Map(DEFINITIONS.map((d) => [d.id, d]));

type DiscoveryRow = { tribeId: string; techId: string; discoveredYear: number; method: string };

async function worldOrThrow(db: Database, worldId: string) {
  const row = await getWorldRow(db, worldId);
  if (!row) throw notFound("Mondo");
  return row;
}

/** Tribes and discoveries of one world, in two queries. */
async function loadTechState(db: Database, worldId: string) {
  const [tribeRows, discoveries] = await Promise.all([
    db.select().from(s.tribes).where(eq(s.tribes.worldId, worldId)).orderBy(asc(s.tribes.seq)),
    db
      .select()
      .from(s.worldTechnologies)
      .where(eq(s.worldTechnologies.worldId, worldId))
      .orderBy(asc(s.worldTechnologies.discoveredTick)),
  ]);
  return { tribeRows, discoveries: discoveries as DiscoveryRow[] };
}

const holds = (tribe: Tribe, id: string) => tribe.techs.includes(id);

function missingPrerequisites(tribe: Tribe, tech: TechnologyDefinition): string[] {
  return tech.prerequisites.filter((id) => !tribe.techs.includes(id));
}

/** GET /api/worlds/:worldId/technologies */
export async function getWorldTechnologiesService(
  worldId: string,
  deps?: { db: Database },
): Promise<WorldTechnologiesDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const { tribeRows, discoveries } = await loadTechState(db, worldId);
  const tribes = tribeRows.map((r) => tribeFromRow(row.seed, r));
  const alive = tribes.filter((t) => t.status !== "extinct");

  const firstByTech = new Map<string, DiscoveryRow>();
  for (const d of discoveries) if (!firstByTech.has(d.techId)) firstByTech.set(d.techId, d);

  const dto: WorldTechnologiesDTO = {
    worldId,
    year: row.currentYear,
    items: DEFINITIONS.map((definition) => {
      const first = firstByTech.get(definition.id);
      return {
        ...definition,
        holders: alive.filter((t) => t.techs.includes(definition.id)).length,
        civilizations: alive.length,
        firstDiscoveredYear: first?.discoveredYear ?? null,
        pioneerCivilizationId: first?.tribeId ?? null,
        lostBy: alive.filter((t) => t.techLost?.[definition.id] !== undefined).length,
      };
    }),
  };
  return worldTechnologiesSchema.parse(dto);
}

/** GET /api/worlds/:worldId/civilizations/:civilizationId/technologies */
export async function getCivilizationTechnologiesService(
  worldId: string,
  civilizationId: string,
  query: CivilizationTechnologyQuery,
  deps?: { db: Database },
): Promise<CivilizationTechnologyPageDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const [tribeRow] = await db
    .select()
    .from(s.tribes)
    .where(and(eq(s.tribes.worldId, worldId), eq(s.tribes.id, civilizationId)))
    .limit(1);
  if (!tribeRow) throw notFound("Civiltà");
  const tribe = tribeFromRow(row.seed, tribeRow);
  const discoveries = (await db
    .select()
    .from(s.worldTechnologies)
    .where(
      and(eq(s.worldTechnologies.worldId, worldId), eq(s.worldTechnologies.tribeId, civilizationId)),
    )) as DiscoveryRow[];
  const byTech = new Map(discoveries.map((d) => [d.techId, d]));

  const all = TECHNOLOGIES.map((tech) => {
    const discovery = byTech.get(tech.id);
    const status = techStatus(tribe, tech.id);
    const variant = holds(tribe, tech.id) ? variantByKey(tribe.techVariants?.[tech.id]) : null;
    const progress = tribe.techProgress[tech.id] ?? 0;
    const held = tribe.techs.includes(tech.id);
    return {
      technologyId: tech.id,
      name: tech.name,
      category: tech.category,
      status,
      discoveryProgress: held ? 1 : Math.min(1, Math.round((progress / tech.cost) * 1000) / 1000),
      adoptionPercentage: held ? Math.round((tribe.techAdoption?.[tech.id] ?? 1) * 100) : 0,
      progress: Math.round(progress * 100) / 100,
      cost: tech.cost,
      discoveredYear: discovery?.discoveredYear ?? null,
      lostYear: tribe.techLost?.[tech.id] ?? null,
      source: (discovery?.method as CivilizationTechnologyPageDTO["items"][number]["source"]) ?? null,
      // The engine records the source people on the event, not on the discovery row.
      sourceCivilizationId: null,
      prerequisitesMet: missingPrerequisites(tribe, tech).length === 0,
      missingPrerequisites: missingPrerequisites(tribe, tech),
      effectSummary: tech.effectSummary,
      tradeOff: tech.tradeOff,
      localName: variant?.name ?? null,
      localDescription: variant?.description ?? null,
      localCause: variant?.cause ?? null,
    };
  });

  // Every status is present, zero included: the client never has to guard for undefined.
  const counts = TECH_STATUSES.reduce<Record<string, number>>((acc, status) => ({ ...acc, [status]: 0 }), {});
  for (const item of all) counts[item.status] = (counts[item.status] ?? 0) + 1;

  const filtered = all.filter(
    (item) =>
      (!query.status || query.status.includes(item.status)) &&
      (!query.category || query.category.includes(item.category)),
  );
  const start = (query.page - 1) * query.pageSize;
  const dto: CivilizationTechnologyPageDTO = {
    worldId,
    civilizationId,
    civilizationName: tribe.name,
    counts: counts as CivilizationTechnologyPageDTO["counts"],
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
  };
  return civilizationTechnologyPageSchema.parse(dto);
}

/**
 * GET /api/worlds/:worldId/civilizations/:civilizationId/technologies/discoverable
 *
 * Deliberately not "everything this people does not know": that list is long and useless. Only
 * what is actually within reach — being worked on, one prerequisite away, or already in use by
 * a neighbour it is in contact with.
 */
export async function getDiscoverableTechnologiesService(
  worldId: string,
  civilizationId: string,
  deps?: { db: Database },
): Promise<DiscoverableTechnologyPageDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const [tribeRows, relationships, settlementRows, cellRows, knowledgeRows] = await Promise.all([
    db.select().from(s.tribes).where(eq(s.tribes.worldId, worldId)).orderBy(asc(s.tribes.seq)),
    db.select().from(s.relationships).where(eq(s.relationships.worldId, worldId)),
    db.select().from(s.settlements).where(eq(s.settlements.worldId, worldId)),
    db.select().from(s.worldCells).where(eq(s.worldCells.worldId, worldId)),
    db
      .select()
      .from(s.civilizationKnowledge)
      .where(
        and(
          eq(s.civilizationKnowledge.worldId, worldId),
          eq(s.civilizationKnowledge.observerId, civilizationId),
        ),
      ),
  ]);
  const tribes = tribeRows.map((r) => tribeFromRow(row.seed, r));
  const tribe = tribes.find((t) => t.id === civilizationId);
  if (!tribe) throw notFound("Civiltà");

  // The land this people actually works, read once from the cells it owns.
  const area = cellRows
    .filter((c) => c.ownerTribeId === civilizationId)
    .map((c) => ({ ...c }) as unknown as TechConditionInput["area"][number]);
  const owned = settlementRows.filter((x) => x.tribeId === civilizationId && x.status === "active");
  const population = owned.reduce((acc, x) => acc + x.population, 0);
  const rels = relationships.filter((r) => r.aId === civilizationId || r.bId === civilizationId);
  const input: TechConditionInput = {
    tribe,
    population: Math.max(population, 1),
    settled: owned.length > 0,
    settlements: owned.length,
    maxSettlementLevel: owned.reduce((acc, x) => Math.max(acc, x.level), 0),
    area,
    maxHostility: rels.reduce((acc, r) => Math.max(acc, r.hostility), 0),
    conflictMemory: rels.reduce((acc, r) => Math.max(acc, r.conflictMemory), 0),
    tradePartners: rels.filter((r) => r.tradeVolume > 10 && !r.atWar).length,
    culture: tribe.culture,
    foodRatio: 1,
    order: tribe.stability.order,
  };

  // What this people has SEEN its neighbours use — its own knowledge, possibly out of date —
  // never what they actually use. Reading the neighbours' real technologies here would leak.
  const nameOf = new Map(tribes.map((t) => [t.id, t.name]));
  const seenUsing = (techId: string) =>
    knowledgeRows
      .filter((k) => k.technologies?.ids.includes(techId))
      .map((k) => nameOf.get(k.targetId) ?? k.targetId);

  const items = TECHNOLOGIES.filter((tech) => {
    if (tribe.techs.includes(tech.id)) return false;
    const started = (tribe.techProgress[tech.id] ?? 0) > 0;
    const oneAway = missingPrerequisites(tribe, tech).length <= 1;
    const seen = seenUsing(tech.id).length > 0;
    const remembered = tribe.techLost?.[tech.id] !== undefined;
    return started || oneAway || seen || remembered;
  }).map((tech) => {
    const missing: string[] = [];
    if (input.population < tech.minPopulation) missing.push(`almeno ${tech.minPopulation} abitanti`);
    if (tech.requiresSettlement && !input.settled) missing.push("un insediamento stabile");
    if (!tech.condition(input)) {
      missing.push(tech.geographyRequirement ?? tech.resourceRequirement);
    }
    return {
      technologyId: tech.id,
      name: tech.name,
      category: tech.category,
      progress: Math.round((tribe.techProgress[tech.id] ?? 0) * 100) / 100,
      cost: tech.cost,
      affinity: techAffinity(tech, input),
      weight: researchWeight(tech, input, researchAptitude(row.seed, tribe.id, tech.category)),
      prerequisitesMet: missingPrerequisites(tribe, tech).length === 0,
      missingPrerequisites: missingPrerequisites(tribe, tech),
      missingRequirements: missing.filter(Boolean),
      knownByNeighbours: seenUsing(tech.id),
      previouslyLost: tribe.techLost?.[tech.id] !== undefined,
    };
  });
  // Most attainable first: what the people is likeliest to actually get next.
  items.sort(
    (a, b) => b.weight - a.weight || a.cost - b.cost || a.technologyId.localeCompare(b.technologyId),
  );

  void canResearch;
  return discoverableTechnologyPageSchema.parse({ worldId, civilizationId, items });
}

/** GET /api/worlds/:worldId/technologies/:technologyId/history */
export async function getTechnologyHistoryService(
  worldId: string,
  technologyId: string,
  deps?: { db: Database },
): Promise<TechnologyHistoryDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const definition = DEFINITION_BY_ID.get(technologyId);
  const tech = TECH_BY_ID.get(technologyId);
  if (!definition || !tech) throw notFound("Tecnologia");

  const { tribeRows, discoveries } = await loadTechState(db, worldId);
  const tribes = tribeRows.map((r) => tribeFromRow(row.seed, r));
  const byId = new Map(tribes.map((t) => [t.id, t]));
  const mine = discoveries.filter((d) => d.techId === technologyId);

  const holders = mine
    .map((d) => {
      const holder = byId.get(d.tribeId);
      if (!holder) return null;
      return {
        civilizationId: d.tribeId,
        name: holder.name,
        year: d.discoveredYear,
        method: d.method,
        adoptionPercentage: holder.techs.includes(technologyId)
          ? Math.round((holder.techAdoption?.[technologyId] ?? 1) * 100)
          : 0,
        status: techStatus(holder, technologyId),
        localName: holder.techs.includes(technologyId)
          ? (variantByKey(holder.techVariants?.[technologyId])?.name ?? null)
          : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const lostBy = tribes
    .filter((t) => t.techLost?.[technologyId] !== undefined)
    .map((t) => ({
      civilizationId: t.id,
      name: t.name,
      year: t.techLost[technologyId] as number,
    }));

  const years = mine.map((d) => d.discoveredYear);
  const events = await listEvents(db, worldId, { page: 1, pageSize: 50, types: ["tech_discovered"] });

  const dto: TechnologyHistoryDTO = {
    worldId,
    technologyId,
    definition,
    pioneer: mine[0]
      ? {
          civilizationId: mine[0].tribeId,
          name: byId.get(mine[0].tribeId)?.name ?? mine[0].tribeId,
          year: mine[0].discoveredYear,
        }
      : null,
    holders,
    lostBy,
    spreadYears: years.length > 1 ? Math.max(...years) - Math.min(...years) : null,
    events: events.items
      .filter((e) => (e.metadata as { techId?: string })?.techId === technologyId)
      .map((e) => ({
        id: e.id,
        year: e.year,
        subtype: e.subtype,
        title: e.title,
        description: e.description,
      })),
  };
  return technologyHistorySchema.parse(dto);
}

/** GET /api/worlds/:worldId/settlements/:settlementId/history */
export async function getSettlementHistoryService(
  worldId: string,
  settlementId: string,
  query: SettlementHistoryQuery,
  deps?: { db: Database },
): Promise<SettlementHistoryDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const [settlementRow] = await db
    .select()
    .from(s.settlements)
    .where(and(eq(s.settlements.worldId, worldId), eq(s.settlements.id, settlementId)))
    .limit(1);
  if (!settlementRow) throw notFound("Insediamento");
  const [tribeRow] = await db
    .select()
    .from(s.tribes)
    .where(and(eq(s.tribes.worldId, worldId), eq(s.tribes.id, settlementRow.tribeId)))
    .limit(1);
  if (!tribeRow) throw notFound("Civiltà");
  const tribe = tribeFromRow(row.seed, tribeRow);

  const events = await listEvents(db, worldId, {
    page: query.page,
    pageSize: query.pageSize,
    actorId: settlementId,
  });
  // A world saved before places remembered anything gets the same shape, filled from its row.
  const history = settlementRow.history ?? {
    foundingReason: "migration" as const,
    founderName: null,
    specializations: [],
    peakPopulation: settlementRow.population,
    peakYear: settlementRow.foundedYear,
    destructions: settlementRow.status === "abandoned" ? 1 : 0,
    reconstructions: 0,
    occupiedYears: 0,
    capitalPeriods: [],
    notableEventIds: [],
  };

  const dto: SettlementHistoryDTO = {
    worldId,
    settlementId,
    name: settlementRow.name,
    civilizationId: tribe.id,
    civilizationName: tribe.name,
    status: settlementRow.status,
    foundedYear: settlementRow.foundedYear,
    abandonedYear: settlementRow.abandonedYear,
    population: settlementRow.population,
    tier: settlementRow.tier ?? "camp",
    history: {
      foundingReason: history.foundingReason,
      foundingReasonLabel: FOUNDING_REASON_LABELS[history.foundingReason],
      founderName: history.founderName,
      specializations: history.specializations.map((key) => ({
        key,
        label: SPECIALIZATION_LABELS[key],
      })),
      peakPopulation: history.peakPopulation,
      peakYear: history.peakYear,
      destructions: history.destructions,
      reconstructions: history.reconstructions,
      occupiedYears: history.occupiedYears,
      capitalPeriods: history.capitalPeriods,
    },
    // Only what the people actually uses: a technology it merely knows changes nothing here.
    technologies: tribe.techs
      .map((id) => ({
        id,
        name: TECH_BY_ID.get(id)?.name ?? id,
        adoptionPercentage: Math.round((tribe.techAdoption?.[id] ?? 1) * 100),
      }))
      .filter((t) => t.adoptionPercentage > 0),
    events: {
      items: events.items.map((e) => ({
        id: e.id,
        year: e.year,
        type: e.type,
        subtype: e.subtype,
        title: e.title,
        description: e.description,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: events.total,
      totalPages: Math.max(1, Math.ceil(events.total / query.pageSize)),
    },
  };
  return settlementHistorySchema.parse(dto);
}

/**
 * GET /api/worlds/:worldId/civilizations/:civilizationId/knowledge
 *
 * What one people believes about the others it has met. Built only from its own knowledge
 * records: of the targets, nothing is read but their name.
 */
export async function getCivilizationKnowledgeService(
  worldId: string,
  observerId: string,
  deps?: { db: Database },
): Promise<CivilizationKnowledgeDTO> {
  const db = deps?.db ?? (await getDb());
  const row = await worldOrThrow(db, worldId);
  const [observer] = await db
    .select({ id: s.tribes.id })
    .from(s.tribes)
    .where(and(eq(s.tribes.worldId, worldId), eq(s.tribes.id, observerId)))
    .limit(1);
  if (!observer) throw notFound("Civiltà");
  const [records, names] = await Promise.all([
    db
      .select()
      .from(s.civilizationKnowledge)
      .where(
        and(eq(s.civilizationKnowledge.worldId, worldId), eq(s.civilizationKnowledge.observerId, observerId)),
      )
      .orderBy(asc(s.civilizationKnowledge.targetId)),
    db.select({ id: s.tribes.id, name: s.tribes.name }).from(s.tribes).where(eq(s.tribes.worldId, worldId)),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const dto: CivilizationKnowledgeDTO = {
    worldId,
    observerId,
    year: row.currentYear,
    items: records.map((r) => ({
      ...viewOf(knowledgeFromRow(r), row.currentYear),
      targetName: nameOf.get(r.targetId) ?? r.targetId,
      spyAttempts: r.spyAttempts,
      spiesCaught: r.spiesCaught,
    })),
  };
  return civilizationKnowledgeSchema.parse(dto);
}
