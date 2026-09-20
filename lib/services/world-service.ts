import {
  AGREEMENT_LABELS,
  BELIEF_TYPE_LABELS,
  BIOMES,
  bundleEntries,
  createWorld,
  definingSeason,
  deriveCulture,
  getIdentity,
  parseRosterConfig,
  politicalTitle,
  initialStability,
  missingResources,
  normalizeStock,
  runSimulation,
  TECHNOLOGIES,
  tierFromLevel,
  type CivilizationRosterConfigInput,
  type GovernmentType,
  type ResourceBundle,
} from "@genesis/simulation-core";
import { getDb, type Database } from "@/lib/db";
import { PostgresSimulationLock, type SimulationLock } from "@/lib/db/lock";
import {
  getCivilizationStatsSeries,
  getLatestSnapshot,
  getPersonDetail,
  getStatsSeries,
  getWorldEntities,
  getWorldRow,
  insertWorld,
  listEvents,
  listWorldRows,
  loadWorldState,
  persistSimulation,
  recordSimulationRun,
  WorldDeletedError,
  updateWorldStatus,
} from "@/lib/db/queries";
import type { EventRow, WorldDeletionJobRow, WorldRow } from "@/lib/db/schema";
import {
  findLatestJob,
  findOpenJob,
  listOpenJobs,
  listResumableJobs,
  runDeletionSlice,
  SimulationBusyError,
  tombstoneWorld,
  WorldNotFoundError,
  type WorldTableName,
} from "@/lib/db/world-deletion";
import { boundedTransaction, isTransientDbError, pgErrorCode } from "@/lib/db/tx";
import * as schema from "@/lib/db/schema";
import { deletionConfig, simulationConfig } from "@/lib/config";
import type {
  CivilizationDTO,
  EventDTO,
  EventsPage,
  MapLayers,
  PersonDTO,
  SettlementDTO,
  SimulateResponse,
  StatsResponse,
  WorldDetail,
  WorldListItem,
} from "@/lib/dto";
import { AppError, notFound } from "@/lib/utils/errors";
import { toIdentitySummary } from "./identity-dto";
import { errorDetails, logger } from "@/lib/utils/logger";
import {
  isDeleteConfirmed,
  type CreateWorldInput,
  type DeleteWorldInput,
  type EventsQuery,
} from "@/lib/validation/world";

export interface ServiceDeps {
  db: Database;
  lock: SimulationLock;
}

async function defaultDeps(): Promise<ServiceDeps> {
  const db = await getDb();
  return { db, lock: new PostgresSimulationLock(db) };
}

function randomSeed(): string {
  const words = ["aurora", "brace", "cenere", "duna", "eco", "fiume", "gelo", "rupe", "selva", "vento"];
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  return `${words[(bytes[0] ?? 0) % words.length]}-${((bytes[1] ?? 0) % 100000).toString().padStart(5, "0")}`;
}

export function toListItem(row: WorldRow): WorldListItem {
  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    width: row.width,
    height: row.height,
    currentTick: row.currentTick,
    currentYear: row.currentYear,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEventDTO(e: EventRow | EventDTO): EventDTO {
  return {
    id: e.id,
    tick: e.tick,
    year: e.year,
    type: e.type,
    subtype: e.subtype ?? null,
    causeEventIds: e.causeEventIds ?? [],
    importance: e.importance,
    actors: e.actors,
    x: e.x,
    y: e.y,
    title: e.title,
    description: e.description,
    metadata: e.metadata,
  };
}

/** Roster of a world created without explicit choices: random historical identities, uniform start. */
export const DEFAULT_WORLD_ROSTER: CivilizationRosterConfigInput = { mode: "random-real" };

export async function createWorldService(input: CreateWorldInput, deps?: ServiceDeps) {
  const { db } = deps ?? (await defaultDeps());
  const seed = input.seed ?? randomSeed();
  const started = Date.now();
  const roster = parseRosterConfig(input.roster ?? DEFAULT_WORLD_ROSTER);
  let state: ReturnType<typeof createWorld>;
  try {
    // The roster is drawn here, once: it is stored with the world and never drawn again.
    state = createWorld({ seed, width: input.width, height: input.height ?? input.width, roster });
  } catch (error) {
    if (error instanceof Error && /abbastanza celle|Posizioni di partenza/.test(error.message))
      throw new AppError(
        "INVALID_INPUT",
        "La mappa è troppo piccola per così tante civiltà: aumenta la dimensione o riduci il roster",
      );
    throw error;
  }
  const row = await insertWorld(db, { id: crypto.randomUUID(), name: input.name, state });
  logger.info("world.created", {
    worldId: row.id,
    seed,
    size: `${state.width}x${state.height}`,
    cells: state.cells.length,
    tribes: state.tribes.length,
    people: state.people.length,
    rosterMode: roster.mode,
    identities: state.roster?.entries.map((e) => e.identityId).join(",") ?? null,
    simulationVersion: state.simulationVersion,
    durationMs: Date.now() - started,
  });
  return toListItem(row);
}

export async function listWorldsService(deps?: Pick<ServiceDeps, "db">): Promise<WorldListItem[]> {
  const { db } = deps ?? (await defaultDeps());
  const rows = await listWorldRows(db);
  const deleting = rows.filter((r) => r.status === "deleting").map((r) => r.id);
  const jobs = deleting.length ? await listOpenJobs(db, deleting) : [];
  const byWorld = new Map(jobs.map((j) => [j.worldId, j]));
  return rows.map((row) => {
    const item = toListItem(row);
    const job = byWorld.get(row.id);
    return job ? { ...item, deletion: { jobId: job.id, status: job.status, progress: job.progress } } : item;
  });
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function getWorldDetailService(
  worldId: string,
  deps?: Pick<ServiceDeps, "db">,
): Promise<WorldDetail> {
  const { db } = deps ?? (await defaultDeps());
  const row = await getWorldRow(db, worldId);
  if (!row) throw notFound();
  const [entities, snapshot] = await Promise.all([
    getWorldEntities(db, worldId),
    getLatestSnapshot(db, worldId),
  ]);
  const {
    cells,
    tribes,
    settlements,
    civilizations,
    relationships,
    populations,
    notable,
    techRows,
    dynasties,
    vassalages,
    occupations,
    composites,
    beliefs,
    agreements,
    reputations,
  } = entities;

  const tribeIndex = new Map(tribes.map((t, i) => [t.id, i]));
  const settlementIndex = new Map(settlements.map((s, i) => [s.id, i]));
  const size = row.width * row.height;
  const layer = () => new Array<number>(size).fill(0);
  const map: MapLayers = {
    biome: layer(),
    altitude: layer(),
    moisture: layer(),
    temperature: layer(),
    fertility: layer(),
    water: layer(),
    wood: layer(),
    stone: layer(),
    fauna: layer(),
    maxFauna: layer(),
    copper: layer(),
    iron: layer(),
    habitability: layer(),
    river: layer(),
    coastal: layer(),
    road: layer(),
    fields: layer(),
    pastures: layer(),
    clay: layer(),
    tin: layer(),
    coal: layer(),
    owner: new Array<number>(size).fill(-1),
    settlement: new Array<number>(size).fill(-1),
    population: layer(),
    riverNames: {},
  };
  for (const c of cells) {
    const i = c.y * row.width + c.x;
    map.biome[i] = BIOMES.indexOf(c.biome as (typeof BIOMES)[number]);
    map.altitude[i] = round2(c.altitude);
    map.moisture[i] = round2(c.moisture);
    map.temperature[i] = round2(c.temperature);
    map.fertility[i] = round2(c.fertility);
    map.water[i] = round2(c.water);
    map.wood[i] = round2(c.wood);
    map.stone[i] = round2(c.stone);
    map.fauna[i] = round2(c.fauna);
    map.maxFauna[i] = round2(c.maxFauna);
    map.copper[i] = round2(c.copper);
    map.iron[i] = round2(c.iron);
    map.habitability[i] = round2(c.habitability);
    map.river[i] = c.river ? 1 : 0;
    map.coastal[i] = c.coastal ? 1 : 0;
    map.road[i] = c.road ? 1 : 0;
    map.fields[i] = c.fields;
    map.pastures[i] = c.pastures ?? 0;
    map.clay[i] = round2(c.clay ?? 0);
    map.tin[i] = round2(c.tin ?? 0);
    map.coal[i] = round2(c.coal ?? 0);
    map.owner[i] = c.ownerTribeId ? (tribeIndex.get(c.ownerTribeId) ?? -1) : -1;
    map.settlement[i] = c.settlementId ? (settlementIndex.get(c.settlementId) ?? -1) : -1;
    if (c.riverName) map.riverNames[i] = c.riverName;
  }

  const byTribe = new Map<string, { population: number; adults: number; children: number }>();
  const bySettlement = new Map<string, number>();
  for (const p of populations) {
    const agg = byTribe.get(p.tribeId) ?? { population: 0, adults: 0, children: 0 };
    agg.population += p.population;
    agg.adults += p.adults;
    agg.children += p.children;
    byTribe.set(p.tribeId, agg);
    if (p.settlementId)
      bySettlement.set(p.settlementId, (bySettlement.get(p.settlementId) ?? 0) + p.population);
  }
  for (const s of settlements) {
    const i = s.y * row.width + s.x;
    if (s.status === "active") map.population[i] = (map.population[i] ?? 0) + (bySettlement.get(s.id) ?? 0);
  }
  for (const p of populations) {
    if (p.settlementId) continue;
    const t = tribes[tribeIndex.get(p.tribeId) ?? -1];
    if (!t) continue;
    const i = t.y * row.width + t.x;
    map.population[i] = (map.population[i] ?? 0) + p.population;
  }
  const people = new Map(notable.map((p) => [p.id, p]));

  const civDTOs: CivilizationDTO[] = civilizations.map((c) => {
    const memberTribes = tribes.filter((t) => t.civilizationId === c.id && t.status !== "extinct");
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      founderTribeId: c.founderTribeId,
      capitalSettlementId: c.capitalSettlementId,
      foundedYear: c.foundedYear,
      status: c.status,
      tribeIds: memberTribes.map((t) => t.id),
      settlementIds: settlements
        .filter((s) => s.civilizationId === c.id && s.status === "active")
        .map((s) => s.id),
      population: memberTribes.reduce((acc, t) => acc + (byTribe.get(t.id)?.population ?? 0), 0),
      identityId: c.identityId ?? null,
      identityType: c.identityType ?? "legacy",
      formerNames: c.formerNames ?? [],
    };
  });
  // Only the identities this world uses travel with it, never the whole catalog.
  const usedIdentities = new Set<string>();
  for (const t of tribes) {
    if (t.identityId) usedIdentities.add(t.identityId);
    for (const id of t.absorbedIdentityIds ?? []) usedIdentities.add(id);
  }
  for (const e of row.roster?.entries ?? []) usedIdentities.add(e.identityId);

  return {
    world: {
      ...toListItem(row),
      settings: row.settings,
      simulationVersion: row.simulationVersion ?? 1,
      climate: {
        modifier: row.climate.modifier,
        droughts: (row.climate.hazards ?? []).filter((h) => h.kind === "drought").length,
        trend: row.climate.trend ?? 0,
        harshWinter: row.climate.harshWinter ?? false,
        winterSeverity: row.climate.winterSeverity ?? 0.5,
        seasons: row.climate.seasons ?? [],
        definingSeason: definingSeason({ climate: row.climate } as Parameters<typeof definingSeason>[0]),
        hazards: (row.climate.hazards ?? []).map((h) => ({
          id: h.id,
          kind: h.kind,
          x: h.x,
          y: h.y,
          radius: h.radius,
          severity: h.severity,
        })),
      },
    },
    map,
    tribes: tribes.map((t) => {
      const leader = t.leaderId ? people.get(t.leaderId) : undefined;
      const government = (t.government ?? "clan") as GovernmentType;
      const agg = byTribe.get(t.id) ?? { population: 0, adults: 0, children: 0 };
      const dynasty = t.dynastyId
        ? dynasties.find((d: (typeof dynasties)[number]) => d.id === t.dynastyId)
        : undefined;
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        status: t.status,
        x: t.x,
        y: t.y,
        ...agg,
        stock: normalizeStock({
          food: round2(t.food),
          wood: round2(t.wood),
          stone: round2(t.stone),
          copper: round2(t.copper),
          goods: t.goods,
        }),
        techs: t.techs,
        techProgress: t.techProgress,
        techAdoption: t.techAdoption ?? {},
        techLost: t.techLost ?? {},
        cultureHistory: t.cultureHistory ?? [],
        resilience: t.resilience ?? null,
        beliefAdherence: t.beliefAdherence ?? 0,
        civilizationId: t.civilizationId,
        leader: leader
          ? {
              id: leader.id,
              name: leader.name,
              age: leader.age,
              title: politicalTitle(government, leader.sex ?? null),
            }
          : null,
        foundedYear: t.foundedYear,
        extinctYear: t.extinctYear,
        morale: t.morale,
        lastFoodRatio: t.lastFoodRatio,
        lastFoodProduced: t.lastFoodProduced,
        scarcityYears: t.scarcityYears,
        parentTribeId: t.parentTribeId,
        culture: t.culture ?? deriveCulture(row.seed, t.id),
        government,
        identityId: t.identityId ?? null,
        identityType: t.identityType ?? "legacy",
        emblemKey:
          getIdentity(t.identityId)?.visualProfile.emblemKey ??
          composites.find((c) => c.id === t.identityId)?.visualProfile.emblemKey ??
          null,
        absorbedIdentityIds: t.absorbedIdentityIds ?? [],
        absorbedByTribeId: t.absorbedByTribeId ?? null,
        stability: t.stability ?? initialStability(),
        distribution: t.distribution ?? "egalitarian",
        dynasty: dynasty
          ? { id: dynasty.id, name: dynasty.name, rulers: dynasty.rulers, prestige: dynasty.prestige }
          : null,
      };
    }),
    settlements: settlements.map((s) => ({
      id: s.id,
      name: s.name,
      tribeId: s.tribeId,
      civilizationId: s.civilizationId,
      x: s.x,
      y: s.y,
      level: s.level,
      tier: (s.tier as SettlementDTO["tier"]) ?? tierFromLevel(s.level),
      status: s.status,
      population: s.status === "active" ? (bySettlement.get(s.id) ?? 0) : 0,
      stock: normalizeStock({
        food: round2(s.food),
        wood: round2(s.wood),
        stone: round2(s.stone),
        copper: round2(s.copper),
        goods: s.goods,
      }),
      buildings: s.buildings,
      construction: s.construction ? toConstructionDTO(s) : null,
      defense: s.defense,
      territoryRadius: s.territoryRadius,
      foundedYear: s.foundedYear,
      abandonedYear: s.abandonedYear,
      lastProduction: normalizeStock(s.lastProduction),
      lastFoodRatio: s.lastFoodRatio,
      famineYears: s.famineYears,
      hygiene: s.hygiene ?? 0.8,
      unrest: s.unrest ?? 0,
      influence: s.influence ?? 1,
      founderId: s.founderId ?? null,
      epidemic: (row.crises ?? []).some(
        (c) => c.kind === "epidemic" && c.targetId === s.id && c.untilYear >= row.currentYear,
      ),
      history: s.history ?? null,
    })),
    civilizations: civDTOs,
    relationships: relationships.map((r) => ({
      aId: r.aId,
      bId: r.bId,
      trust: r.trust,
      hostility: r.hostility,
      tradeVolume: round2(r.tradeVolume),
      conflictMemory: r.conflictMemory,
      atWar: r.atWar,
      allied: r.allied,
      distance: r.distance,
      warStartYear: r.warStartYear,
      battles: r.battles,
      respect: r.respect ?? 0,
      tradeDependency: r.tradeDependency ?? 0,
      culturalDistance: r.culturalDistance ?? 0,
      status: r.status ?? "contact",
      phase: r.phase ?? "peace",
      lastConflictYear: r.lastConflictYear ?? null,
    })),
    technologies: TECHNOLOGIES.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      prerequisites: t.prerequisites,
      cost: t.cost,
      effectSummary: t.effectSummary,
      resourceRequirement: t.resourceRequirement,
      geographyRequirement: t.geographyRequirement,
      tradeOff: t.tradeOff,
    })),
    discoveries: techRows.map((r) => ({
      tribeId: r.tribeId,
      techId: r.techId,
      year: r.discoveredYear,
      method: r.method,
    })),
    dynasties: dynasties.map((d: (typeof dynasties)[number]) => ({
      id: d.id,
      name: d.name,
      tribeId: d.tribeId,
      founderId: d.founderId,
      foundedYear: d.foundedYear,
      endedYear: d.endedYear,
      prestige: d.prestige,
      rulers: d.rulers,
      currentLeaderId: d.currentLeaderId ?? null,
      legitimacy: d.legitimacy ?? 0.6,
      successionLaw: d.successionLaw ?? "hereditary",
      status: d.status ?? (d.endedYear === null ? "active" : "extinct"),
      endReason: d.endReason ?? null,
      crises: d.crises ?? 0,
    })),
    beliefs: beliefs.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      typeLabel: BELIEF_TYPE_LABELS[b.type],
      foundedByTribeId: b.foundedByTribeId,
      principles: b.principles,
      authority: b.authority,
      tolerance: b.tolerance,
      missionaryPressure: b.missionaryPressure,
      createdYear: b.createdYear,
      parentBeliefIds: b.parentBeliefIds,
      status: b.status,
      endedYear: b.endedYear,
      followerTribeIds: tribes.filter((t) => t.beliefSystemId === b.id).map((t) => t.id),
    })),
    agreements: agreements.map((a) => ({
      id: a.id,
      firstCivilizationId: a.firstCivilizationId,
      secondCivilizationId: a.secondCivilizationId,
      type: a.type,
      typeLabel: AGREEMENT_LABELS[a.type],
      startedYear: a.startedYear,
      expiresAtYear: a.expiresAtYear,
      endedYear: a.endedYear,
      status: a.status,
      violationCount: a.violationCount,
      lastViolatorId: a.lastViolatorId,
    })),
    reputations,
    crises: (row.crises ?? [])
      .filter((c) => c.untilYear >= row.currentYear)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        scope: c.scope,
        targetId: c.targetId,
        startYear: c.startYear,
        untilYear: c.untilYear,
        severity: c.severity,
      })),
    notablePeople: notable
      .slice()
      .sort((a, b) => (b.prestige ?? 0) - (a.prestige ?? 0))
      .slice(0, 60)
      .map((p) => ({
        id: p.id,
        name: p.name,
        tribeId: p.tribeId,
        age: p.age,
        role: p.role,
        title: p.title ?? null,
        prestige: round2(p.prestige ?? 0),
      })),
    lastSnapshot: snapshot ? { tick: snapshot.tick, year: snapshot.year } : null,
    roster: row.roster
      ? {
          mode: row.roster.config.mode,
          catalogVersion: row.roster.catalogVersion,
          enableIdentityModifiers: row.roster.config.enableIdentityModifiers,
          balancedPlacement: row.roster.config.balancedPlacement,
          equalStartingLevel: row.roster.config.equalStartingLevel,
          entries: row.roster.entries.map((e) => ({ ...e })),
          placement: row.roster.placement ?? null,
        }
      : null,
    identities: [...usedIdentities]
      .map((key) => getIdentity(key))
      .filter((i) => i !== undefined)
      .map(toIdentitySummary),
    vassalages: vassalages.map((v) => ({
      id: v.id,
      overlordCivilizationId: v.overlordCivilizationId,
      vassalCivilizationId: v.vassalCivilizationId,
      startedYear: v.startedYear,
      endedYear: v.endedYear,
      tributePolicy: v.tributePolicy,
      autonomy: round2(v.autonomy),
      militaryObligation: round2(v.militaryObligation),
      diplomaticStatus: v.diplomaticStatus,
      endReason: v.endReason ?? null,
      totalTribute: round2(v.totalTribute),
      lastTribute: round2(v.lastTribute),
    })),
    occupations: occupations.map((o) => ({
      id: o.id,
      occupyingCivilizationId: o.occupyingCivilizationId,
      occupiedCivilizationId: o.occupiedCivilizationId,
      occupiedSettlementId: o.occupiedSettlementId,
      startedYear: o.startedYear,
      endedYear: o.endedYear,
      occupationPolicy: o.occupationPolicy,
      resistance: round2(o.resistance),
      control: round2(o.control),
      status: o.status,
      upkeepPaid: round2(o.upkeepPaid),
      extracted: round2(o.extracted),
    })),
    composites: composites.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      collectiveName: c.collectiveName,
      adjective: c.adjective,
      sourceIdentityIds: c.sourceIdentityIds,
      sourceNames: c.sourceIdentityIds.map(
        (key) => getIdentity(key)?.displayName ?? composites.find((x) => x.id === key)?.displayName ?? key,
      ),
      sourceCivilizationIds: c.sourceCivilizationIds,
      civilizationId: c.civilizationId,
      primaryColor: c.visualProfile.primaryColor,
      secondaryColor: c.visualProfile.secondaryColor,
      emblemKey: c.visualProfile.emblemKey,
      createdYear: c.createdYear,
      status: c.status,
      tags: c.culturalProfile.tags,
    })),
  };
}

/** Construction sites are shown with what they still need, not just a progress bar. */
function toConstructionDTO(s: typeof schema.settlements.$inferSelect) {
  const project = s.construction;
  if (!project) return null;
  const stock = normalizeStock({
    food: s.food,
    wood: s.wood,
    stone: s.stone,
    copper: s.copper,
    goods: s.goods,
  });
  const outstanding: ResourceBundle = {};
  for (const [kind, amount] of bundleEntries(project.requiredResources ?? {})) {
    const delivered = project.deliveredResources?.[kind] ?? 0;
    if (amount - delivered > 0.001) outstanding[kind] = round2(amount - delivered);
  }
  const missing = missingResources(stock, outstanding);
  return {
    type: project.buildingType ?? project.type ?? "hut",
    progress: round2(project.laborCompleted ?? project.progress ?? 0),
    required: round2(project.laborRequired ?? project.required ?? 1),
    status: project.status ?? "building",
    missing: Object.fromEntries(bundleEntries(missing)),
    startedAtTick: project.startedAtTick ?? 0,
  };
}

export async function setWorldStatusService(
  worldId: string,
  status: "running" | "paused",
  deps?: Pick<ServiceDeps, "db">,
) {
  const { db } = deps ?? (await defaultDeps());
  const row = await updateWorldStatus(db, worldId, status);
  if (!row) throw notFound();
  return toListItem(row);
}

/** Who is asking. The project has no authentication yet: the principal is always anonymous. */
export interface Actor {
  userId: string | null;
}
export const ANONYMOUS: Actor = { userId: null };

/**
 * State of a world deletion, as returned by `DELETE /api/worlds/:id` and the deletion
 * endpoints. `deleted`/`total` keep the shape of the former synchronous response.
 */
export interface DeleteWorldResult {
  worldId: string;
  name: string;
  jobId: string;
  status: WorldDeletionJobRow["status"];
  /** True once the world row and every row of the world are gone (verified). */
  completed: boolean;
  /** 0..1, by tables cleared. */
  progress: number;
  currentPhase: string | null;
  deleted: Partial<Record<WorldTableName, number>>;
  total: number;
  attempts: number;
  errorCode: string | null;
  /** When to call again (in progress, busy or after a transient error); null when done. */
  retryAfterMs: number | null;
}

export interface DeletionDeps extends Partial<ServiceDeps> {
  actor?: Actor;
  /** Correlates the logs of one request (Vercel request id when available). */
  requestId?: string;
  /** Overrides the time budget of the slice run inside the request. */
  budgetMs?: number;
  batchSizes?: Partial<Record<string, number>>;
}

export function toDeletionResult(job: WorldDeletionJobRow): DeleteWorldResult {
  const done = job.status === "completed";
  return {
    worldId: job.worldId,
    name: job.worldName,
    jobId: job.id,
    status: job.status,
    completed: done,
    progress: job.progress,
    currentPhase: job.currentPhase,
    deleted: job.deletedByTable as Partial<Record<WorldTableName, number>>,
    total: job.deletedRows,
    attempts: job.attempts,
    errorCode: job.errorCode,
    retryAfterMs: done || job.status === "failed" ? null : deletionConfig().pollIntervalMs,
  };
}

/** Every precondition of a deletion, checked inside the transaction that locks the world row. */
function assertDeletable(row: WorldRow, input: DeleteWorldInput, actor: Actor) {
  // Ownership is reserved for future authentication: an owned world can only be deleted by its
  // owner, and an anonymous request can never prove to be the owner.
  if (row.ownerId !== null && row.ownerId !== actor.userId) {
    throw new AppError("FORBIDDEN", "Non sei autorizzato a eliminare questo mondo");
  }
  if (!isDeleteConfirmed(row.name, input)) {
    throw new AppError(
      "CONFIRMATION_MISMATCH",
      "La conferma non corrisponde al nome del mondo: nessun dato è stato eliminato",
    );
  }
  if (row.status === "running") {
    throw new AppError("WORLD_RUNNING", "Il mondo è in esecuzione: mettilo in pausa prima di eliminarlo");
  }
}

async function runSlice(db: Database, jobId: string, deps?: DeletionDeps): Promise<DeleteWorldResult> {
  const config = deletionConfig();
  const { outcome, job } = await runDeletionSlice(db, jobId, {
    budgetMs: deps?.budgetMs ?? config.budgetMs,
    leaseMs: config.leaseMs,
    timeouts: {
      lockTimeoutMs: config.lockTimeoutMs,
      statementTimeoutMs: config.statementTimeoutMs,
      idleInTransactionMs: config.idleInTransactionMs,
    },
    batchSizes: deps?.batchSizes,
    requestId: deps?.requestId,
  });
  if (outcome === "failed") {
    throw new AppError(
      "DELETION_FAILED",
      "Eliminazione interrotta da un errore: il mondo resta nascosto e l'eliminazione può essere ripresa",
      { jobId: job.id, errorCode: job.errorCode },
    );
  }
  return toDeletionResult(job);
}

/**
 * Deletes one world and every row that belongs to it.
 *
 * Guard rails: typed confirmation checked against the stored name, ownership, the world must be
 * paused and no simulation batch may hold the world lock. They are all checked inside one short
 * transaction that locks the world row with a `lock_timeout` (an orphaned transaction can make
 * the request fail with 409 WORLD_BUSY, never hang it) and tombstones the world. The purge then
 * runs set-based batches for at most `budgetMs`: small and medium worlds complete within the
 * request (`completed: true`), a huge one answers `completed: false` and is resumed by
 * `resumeWorldDeletionService` (client polling, or the optional cron).
 */
export async function deleteWorldService(
  worldId: string,
  input: DeleteWorldInput,
  deps?: DeletionDeps,
): Promise<DeleteWorldResult> {
  const db = deps?.db ?? (await getDb());
  const actor = deps?.actor ?? ANONYMOUS;
  const started = Date.now();
  let job: WorldDeletionJobRow;
  try {
    ({ job } = await tombstoneWorld(db, worldId, (row) => assertDeletable(row, input, actor), {
      requestedBy: actor.userId,
    }));
  } catch (error) {
    if (error instanceof WorldNotFoundError) throw notFound();
    if (error instanceof SimulationBusyError)
      throw new AppError(
        "SIMULATION_IN_PROGRESS",
        "Una simulazione o un'altra operazione è in corso su questo mondo: riprova tra qualche secondo",
      );
    if (error instanceof AppError) throw error;
    const code = pgErrorCode(error);
    logger.error("world.delete.tombstone_failed", {
      worldId,
      requestId: deps?.requestId,
      pgCode: code,
      durationMs: Date.now() - started,
      ...errorDetails(error),
    });
    if (isTransientDbError(error))
      throw new AppError(
        "WORLD_BUSY",
        "Il mondo è bloccato da un'altra operazione sul database: nessun dato è stato eliminato, riprova tra qualche secondo",
        { pgCode: code },
      );
    throw new AppError("DATABASE_ERROR", "Eliminazione non riuscita: nessun dato è stato modificato");
  }
  logger.info("world.delete.accepted", {
    worldId,
    jobId: job.id,
    requestId: deps?.requestId,
    durationMs: Date.now() - started,
  });
  return runSlice(db, job.id, deps);
}

/**
 * Continues the deletion of a world already confirmed (tombstoned). Idempotent: on a finished
 * deletion it returns the completed job; 404 only when no deletion of this world ever existed.
 */
export async function resumeWorldDeletionService(
  worldId: string,
  deps?: DeletionDeps,
): Promise<DeleteWorldResult> {
  const db = deps?.db ?? (await getDb());
  const actor = deps?.actor ?? ANONYMOUS;
  const open = await findOpenJob(db, worldId);
  if (!open) {
    const latest = await findLatestJob(db, worldId);
    if (latest) return toDeletionResult(latest);
    throw new AppError("NOT_FOUND", "Nessuna eliminazione in corso per questo mondo");
  }
  if (open.requestedBy !== null && open.requestedBy !== actor.userId)
    throw new AppError("FORBIDDEN", "Non sei autorizzato a proseguire questa eliminazione");
  return runSlice(db, open.id, deps);
}

/** Read-only state of the latest deletion of a world. */
export async function getWorldDeletionService(
  worldId: string,
  deps?: Pick<ServiceDeps, "db">,
): Promise<DeleteWorldResult> {
  const { db } = deps ?? (await defaultDeps());
  const latest = await findLatestJob(db, worldId);
  if (!latest) throw new AppError("NOT_FOUND", "Nessuna eliminazione per questo mondo");
  return toDeletionResult(latest);
}

/** Cron helper: advances deletions nobody is polling any more (tab closed mid-deletion). */
export async function resumePendingDeletionsService(
  limit: number,
  deps?: Pick<ServiceDeps, "db"> & { budgetMs?: number },
): Promise<DeleteWorldResult[]> {
  const { db } = deps ?? (await defaultDeps());
  const out: DeleteWorldResult[] = [];
  for (const job of await listResumableJobs(db, limit)) {
    try {
      out.push(await runSlice(db, job.id, { db, budgetMs: deps?.budgetMs }));
    } catch (error) {
      logger.warn("world.delete.sweep_failed", {
        jobId: job.id,
        worldId: job.worldId,
        ...errorDetails(error),
      });
    }
  }
  return out;
}

export async function getEventsService(
  worldId: string,
  query: EventsQuery,
  deps?: Pick<ServiceDeps, "db">,
): Promise<EventsPage> {
  const { db } = deps ?? (await defaultDeps());
  if (!(await getWorldRow(db, worldId))) throw notFound();
  const { items, total } = await listEvents(db, worldId, {
    page: query.page,
    pageSize: query.pageSize,
    types: query.type,
    minImportance: query.minImportance,
    search: query.search,
    fromYear: query.fromYear,
    toYear: query.toYear,
    actorId: query.actorId,
  });
  return {
    items: items.map(toEventDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** World series plus, optionally, the per-civilization ones used by the comparison charts. */
export async function getStatsService(
  worldId: string,
  maxPoints: number,
  options: { civilizations?: boolean } = {},
  deps?: Pick<ServiceDeps, "db">,
): Promise<StatsResponse> {
  const { db } = deps ?? (await defaultDeps());
  const row = await getWorldRow(db, worldId);
  if (!row) throw notFound();
  const [rows, civRows] = await Promise.all([
    getStatsSeries(db, worldId, row.currentTick, maxPoints),
    options.civilizations
      ? getCivilizationStatsSeries(db, worldId, row.currentTick, maxPoints)
      : Promise.resolve([]),
  ]);
  return {
    world: rows.map(({ worldId: _w, ...rest }) => rest),
    civilizations: civRows.map(({ worldId: _w, ...rest }) => rest),
  };
}

/** Detail of one person: family, standing, and the events they took part in. */
export async function getPersonService(
  worldId: string,
  personId: string,
  deps?: Pick<ServiceDeps, "db">,
): Promise<PersonDTO> {
  const { db } = deps ?? (await defaultDeps());
  if (!(await getWorldRow(db, worldId))) throw notFound();
  const detail = await getPersonDetail(db, worldId, personId);
  if (!detail) throw notFound("Persona");
  const p = detail.person;
  return {
    id: p.id,
    name: p.name,
    tribeId: p.tribeId,
    tribeName: detail.tribe?.name ?? null,
    settlementId: p.settlementId,
    settlementName: detail.settlement?.name ?? null,
    sex: p.sex,
    age: p.age,
    birthYear: p.birthYear,
    alive: p.alive,
    deathYear: p.deathYear,
    deathCause: p.deathCause,
    role: p.role,
    action: p.action,
    health: round2(p.health),
    hunger: round2(p.hunger),
    prestige: round2(p.prestige ?? 0),
    education: round2(p.education ?? 0),
    wealth: round2(p.wealth ?? 0),
    title: p.title ?? null,
    titleSinceYear: p.titleSinceYear ?? null,
    notable: p.notable,
    dynasty: detail.dynasty ? { id: detail.dynasty.id, name: detail.dynasty.name } : null,
    skills: p.skills as unknown as Record<string, number>,
    personality: p.personality as unknown as Record<string, number>,
    knowledge: p.knowledge,
    family: {
      mother: detail.mother,
      father: detail.father,
      partner: detail.partner,
      children: detail.children,
    },
    events: detail.events.map(toEventDTO),
  };
}

function mapDbError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof WorldDeletedError) return notFound();
  const code = pgErrorCode(error);
  if (code === "57014") return new AppError("TIMEOUT", "Il database ha interrotto l'operazione per timeout");
  if (code === "55P03")
    return new AppError(
      "WORLD_BUSY",
      "Il mondo è bloccato da un'altra operazione sul database: il batch non è stato salvato, riprova",
    );
  if (code)
    return new AppError("DATABASE_ERROR", "Errore del database durante il salvataggio della simulazione", {
      code,
    });
  return error;
}

/**
 * Stateless batch: lock → load → compute N ticks → save in one transaction → unlock.
 * Nothing lives in server memory between requests.
 */
export async function simulateWorldService(
  worldId: string,
  ticks: number,
  deps?: ServiceDeps,
): Promise<SimulateResponse> {
  const { db, lock } = deps ?? (await defaultDeps());
  const config = simulationConfig();
  if (ticks > config.maxTicksPerRequest) {
    throw new AppError("TICKS_NOT_ALLOWED", `Massimo ${config.maxTicksPerRequest} tick per richiesta`);
  }
  if (!(await getWorldRow(db, worldId))) throw notFound();

  const handle = await lock.acquire(worldId, config.lockTtlMs);
  if (!handle)
    throw new AppError("SIMULATION_IN_PROGRESS", "Una simulazione è già in corso per questo mondo");

  const started = Date.now();
  let fromTick = 0;
  try {
    const loaded = await loadWorldState(db, worldId);
    if (!loaded) throw notFound();
    fromTick = loaded.state.tick;
    const populationBefore = loaded.state.people.length;
    const loadedAt = Date.now();

    const result = runSimulation(loaded.state, ticks, { deadline: started + config.timeBudgetMs });
    const computedAt = Date.now();
    if (result.ticksRun === 0)
      throw new AppError("TIMEOUT", "Tempo di calcolo esaurito prima di completare un tick");

    // Bounded: an orphaned transaction on the world row makes the batch fail fast (and be
    // retried) instead of hanging the function; statements of a big world get more time.
    const summary = await boundedTransaction(db, (tx) => persistSimulation(tx, loaded, result), {
      statementTimeoutMs: config.persistStatementTimeoutMs,
    });
    const durationMs = Date.now() - started;
    const sum = (
      k:
        | "births"
        | "deaths"
        | "starvationDeaths"
        | "conflictDeaths"
        | "battles"
        | "foodProduced"
        | "epidemicDeaths"
        | "migrations"
        | "tradeVolume",
    ) => Math.round(result.stats.reduce((acc, st) => acc + st[k], 0) * 10) / 10;

    // Performance budget: every phase of the batch is measured, so a slow world is
    // diagnosable from the logs alone (load, compute, save).
    logger.info("simulate.batch", {
      worldId,
      fromTick,
      toTick: loaded.state.tick,
      requestedTicks: ticks,
      ticksRun: result.ticksRun,
      partial: result.partial,
      people: loaded.state.people.length,
      settlements: loaded.state.settlements.filter((s) => s.status === "active").length,
      tribes: loaded.state.tribes.filter((t) => t.status !== "extinct").length,
      events: result.events.length,
      civStats: result.civStats.length,
      loadMs: loadedAt - started,
      computeMs: computedAt - loadedAt,
      saveMs: Date.now() - computedAt,
      msPerTick: result.ticksRun > 0 ? Math.round(((computedAt - loadedAt) / result.ticksRun) * 10) / 10 : 0,
      durationMs,
    });
    await recordSimulationRun(db, {
      worldId,
      fromTick,
      toTick: loaded.state.tick,
      requestedTicks: ticks,
      ticksRun: result.ticksRun,
      durationMs,
      status: result.partial ? "partial" : "completed",
      eventsCount: result.events.length,
    }).catch((e) => logger.warn("simulate.run_log_failed", errorDetails(e)));

    const events = [...result.events]
      .sort((a, b) => b.importance - a.importance || b.seq - a.seq)
      .slice(0, 100);
    return {
      worldId,
      fromTick,
      toTick: loaded.state.tick,
      year: loaded.state.year,
      requestedTicks: ticks,
      ticksRun: result.ticksRun,
      partial: result.partial,
      durationMs,
      summary,
      events: events.map(toEventDTO),
      eventsTotal: result.events.length,
      metrics: {
        births: sum("births"),
        deaths: sum("deaths"),
        starvationDeaths: sum("starvationDeaths"),
        conflictDeaths: sum("conflictDeaths"),
        battles: sum("battles"),
        foodProduced: sum("foodProduced"),
        population: loaded.state.people.length,
        populationDelta: loaded.state.people.length - populationBefore,
        epidemicDeaths: sum("epidemicDeaths"),
        migrations: sum("migrations"),
        tradeVolume: sum("tradeVolume"),
      },
    };
  } catch (error) {
    const mapped = mapDbError(error);
    logger.error("simulate.failed", { worldId, ticks, ...errorDetails(error) });
    await recordSimulationRun(db, {
      worldId,
      fromTick,
      toTick: fromTick,
      requestedTicks: ticks,
      ticksRun: 0,
      durationMs: Date.now() - started,
      status: "failed",
      eventsCount: 0,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    }).catch(() => undefined);
    throw mapped;
  } finally {
    await lock
      .release(handle)
      .catch((e) => logger.error("simulate.unlock_failed", { worldId, ...errorDetails(e) }));
  }
}
