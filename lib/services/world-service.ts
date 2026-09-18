import { BIOMES, createWorld, runSimulation, TECHNOLOGIES } from "@genesis/simulation-core";
import { getDb, type Database } from "@/lib/db";
import { PostgresSimulationLock, type SimulationLock } from "@/lib/db/lock";
import {
  deleteWorldRow,
  getLatestSnapshot,
  getStatsSeries,
  getWorldEntities,
  getWorldRow,
  insertWorld,
  listEvents,
  listWorldRows,
  loadWorldState,
  persistSimulation,
  recordSimulationRun,
  updateWorldStatus,
} from "@/lib/db/queries";
import type { EventRow, WorldRow } from "@/lib/db/schema";
import { simulationConfig } from "@/lib/config";
import type {
  CivilizationDTO,
  EventDTO,
  EventsPage,
  MapLayers,
  SimulateResponse,
  StatsPoint,
  WorldDetail,
  WorldListItem,
} from "@/lib/dto";
import { AppError, notFound } from "@/lib/utils/errors";
import { errorDetails, logger } from "@/lib/utils/logger";
import type { CreateWorldInput, EventsQuery } from "@/lib/validation/world";

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
    importance: e.importance,
    actors: e.actors,
    x: e.x,
    y: e.y,
    title: e.title,
    description: e.description,
    metadata: e.metadata,
  };
}

export async function createWorldService(input: CreateWorldInput, deps?: ServiceDeps) {
  const { db } = deps ?? (await defaultDeps());
  const seed = input.seed ?? randomSeed();
  const started = Date.now();
  const state = createWorld({ seed, width: input.width, height: input.height ?? input.width });
  const row = await insertWorld(db, { id: crypto.randomUUID(), name: input.name, state });
  logger.info("world.created", {
    worldId: row.id,
    seed,
    size: `${state.width}x${state.height}`,
    tribes: state.tribes.length,
    people: state.people.length,
    durationMs: Date.now() - started,
  });
  return toListItem(row);
}

export async function listWorldsService(deps?: Pick<ServiceDeps, "db">): Promise<WorldListItem[]> {
  const { db } = deps ?? (await defaultDeps());
  return (await listWorldRows(db)).map(toListItem);
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
  const { cells, tribes, settlements, civilizations, relationships, populations, notable, techRows } =
    entities;

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
    };
  });

  return {
    world: {
      ...toListItem(row),
      settings: row.settings,
      climate: { modifier: row.climate.modifier, droughts: row.climate.droughts.length },
    },
    map,
    tribes: tribes.map((t) => {
      const leader = t.leaderId ? people.get(t.leaderId) : undefined;
      const agg = byTribe.get(t.id) ?? { population: 0, adults: 0, children: 0 };
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        status: t.status,
        x: t.x,
        y: t.y,
        ...agg,
        stock: {
          food: round2(t.food),
          wood: round2(t.wood),
          stone: round2(t.stone),
          copper: round2(t.copper),
        },
        techs: t.techs,
        techProgress: t.techProgress,
        civilizationId: t.civilizationId,
        leader: leader ? { id: leader.id, name: leader.name, age: leader.age } : null,
        foundedYear: t.foundedYear,
        extinctYear: t.extinctYear,
        morale: t.morale,
        lastFoodRatio: t.lastFoodRatio,
        lastFoodProduced: t.lastFoodProduced,
        scarcityYears: t.scarcityYears,
        parentTribeId: t.parentTribeId,
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
      status: s.status,
      population: s.status === "active" ? (bySettlement.get(s.id) ?? 0) : 0,
      stock: { food: round2(s.food), wood: round2(s.wood), stone: round2(s.stone), copper: round2(s.copper) },
      buildings: s.buildings,
      construction: s.construction
        ? { type: s.construction.type, progress: s.construction.progress, required: s.construction.required }
        : null,
      defense: s.defense,
      territoryRadius: s.territoryRadius,
      foundedYear: s.foundedYear,
      abandonedYear: s.abandonedYear,
      lastProduction: s.lastProduction,
      lastFoodRatio: s.lastFoodRatio,
      famineYears: s.famineYears,
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
    })),
    technologies: TECHNOLOGIES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prerequisites: t.prerequisites,
      cost: t.cost,
      effectSummary: t.effectSummary,
    })),
    discoveries: techRows.map((r) => ({
      tribeId: r.tribeId,
      techId: r.techId,
      year: r.discoveredYear,
      method: r.method,
    })),
    lastSnapshot: snapshot ? { tick: snapshot.tick, year: snapshot.year } : null,
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

export async function deleteWorldService(worldId: string, deps?: Pick<ServiceDeps, "db">) {
  const { db } = deps ?? (await defaultDeps());
  if (!(await deleteWorldRow(db, worldId))) throw notFound();
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
  });
  return {
    items: items.map(toEventDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getStatsService(
  worldId: string,
  maxPoints: number,
  deps?: Pick<ServiceDeps, "db">,
): Promise<StatsPoint[]> {
  const { db } = deps ?? (await defaultDeps());
  const row = await getWorldRow(db, worldId);
  if (!row) throw notFound();
  const rows = await getStatsSeries(db, worldId, row.currentTick, maxPoints);
  return rows.map(({ worldId: _w, ...rest }) => rest);
}

function isPostgresError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

function mapDbError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (isPostgresError(cause)) {
    if (cause.code === "57014")
      return new AppError("TIMEOUT", "Il database ha interrotto l'operazione per timeout");
    return new AppError("DATABASE_ERROR", "Errore del database durante il salvataggio della simulazione", {
      code: cause.code,
    });
  }
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

    const summary = await db.transaction((tx) => persistSimulation(tx, loaded, result));
    const durationMs = Date.now() - started;
    const sum = (
      k: "births" | "deaths" | "starvationDeaths" | "conflictDeaths" | "battles" | "foodProduced",
    ) => Math.round(result.stats.reduce((acc, st) => acc + st[k], 0) * 10) / 10;

    logger.info("simulate.batch", {
      worldId,
      fromTick,
      toTick: loaded.state.tick,
      requestedTicks: ticks,
      ticksRun: result.ticksRun,
      partial: result.partial,
      people: loaded.state.people.length,
      events: result.events.length,
      loadMs: loadedAt - started,
      computeMs: computedAt - loadedAt,
      saveMs: Date.now() - computedAt,
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
