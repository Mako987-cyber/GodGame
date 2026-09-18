import {
  collectStats,
  createContext,
  normalizeState,
  serializeWorld,
  STATE_VERSION,
  TECHNOLOGIES,
  type HistoricalEvent,
  type SimulationResult,
  type WorldState,
} from "@genesis/simulation-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./index";
import * as m from "./mappers";
import * as s from "./schema";

const CHUNK_ROWS = 400;
const SNAPSHOT_INTERVAL = 100;
const SNAPSHOTS_KEPT = 3;

function chunk<T>(rows: T[], size = CHUNK_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** `SET col = excluded.col` for every non-key column: bulk upserts in a single statement per chunk. */
function upsertSet(table: PgTable, keys: string[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !keys.includes(key))
      .map(([key, col]) => [key, sql.raw(`excluded."${col.name}"`)]),
  );
}

async function bulkInsert<T extends PgTable>(db: Database, table: T, rows: T["$inferInsert"][]) {
  for (const part of chunk(rows)) await db.insert(table).values(part);
}

async function bulkUpsert<T extends PgTable>(
  db: Database,
  table: T,
  rows: T["$inferInsert"][],
  target: PgColumn[],
  keys: string[],
) {
  if (rows.length === 0) return;
  const set = upsertSet(table, keys);
  for (const part of chunk(rows)) {
    await db.insert(table).values(part).onConflictDoUpdate({ target, set });
  }
}

export async function seedTechnologyCatalog(db: Database) {
  const rows = TECHNOLOGIES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    prerequisites: t.prerequisites,
    cost: t.cost,
    minPopulation: t.minPopulation,
    requiresSettlement: t.requiresSettlement,
    resourceRequirement: t.resourceRequirement,
    geographyRequirement: t.geographyRequirement,
    effects: t.effects as Record<string, number>,
    effectSummary: t.effectSummary,
  }));
  await bulkUpsert(db, s.technologies, rows, [s.technologies.id], ["id"]);
}

export function computeSummary(
  state: WorldState,
  lastEvent: HistoricalEvent | null,
  previous?: s.WorldSummary,
): s.WorldSummary {
  const techs = new Set<string>();
  for (const t of state.tribes) if (t.status !== "extinct") for (const id of t.techs) techs.add(id);
  return {
    population: state.people.length,
    tribes: state.tribes.filter((t) => t.status !== "extinct").length,
    settlements: state.settlements.filter((st) => st.status === "active").length,
    civilizations: state.civilizations.filter((c) => c.status === "active").length,
    technologies: techs.size,
    lastEvent: lastEvent
      ? { title: lastEvent.title, year: lastEvent.year, type: lastEvent.type }
      : (previous?.lastEvent ?? null),
  };
}

export async function insertWorld(
  db: Database,
  input: { id: string; name: string; state: WorldState },
): Promise<s.WorldRow> {
  const { id: worldId, name, state } = input;
  return db.transaction(async (tx) => {
    await seedTechnologyCatalog(tx);
    const [row] = await tx
      .insert(s.worlds)
      .values({
        id: worldId,
        name,
        seed: state.seed,
        width: state.width,
        height: state.height,
        currentTick: state.tick,
        currentYear: state.year,
        rngState: state.rng,
        settings: state.settings,
        counters: state.counters,
        climate: state.climate,
        summary: computeSummary(state, null),
      })
      .returning();
    await bulkInsert(
      tx,
      s.worldCells,
      state.cells.map((c) => m.cellToRow(worldId, c)),
    );
    await bulkInsert(
      tx,
      s.tribes,
      state.tribes.map((t) => m.tribeToRow(worldId, t)),
    );
    await bulkInsert(
      tx,
      s.people,
      state.people.map((p) => m.personToRow(worldId, p)),
    );
    if (state.households.length)
      await bulkInsert(
        tx,
        s.households,
        state.households.map((h) => m.householdToRow(worldId, h)),
      );
    await tx.insert(s.worldStats).values(m.statsToRow(worldId, collectStats(createContext(state))));
    await tx.insert(s.worldSnapshots).values({
      worldId,
      tick: state.tick,
      year: state.year,
      stateVersion: STATE_VERSION,
      state: JSON.parse(serializeWorld(state)),
    });
    if (!row) throw new Error("Inserimento del mondo fallito");
    return row;
  });
}

export async function getWorldRow(db: Database, worldId: string): Promise<s.WorldRow | null> {
  const [row] = await db.select().from(s.worlds).where(eq(s.worlds.id, worldId)).limit(1);
  return row ?? null;
}

export async function listWorldRows(db: Database, limit = 50): Promise<s.WorldRow[]> {
  return db.select().from(s.worlds).orderBy(desc(s.worlds.updatedAt)).limit(limit);
}

export async function deleteWorldRow(db: Database, worldId: string): Promise<boolean> {
  const rows = await db.delete(s.worlds).where(eq(s.worlds.id, worldId)).returning({ id: s.worlds.id });
  return rows.length > 0;
}

export async function updateWorldStatus(db: Database, worldId: string, status: "paused" | "running") {
  const [row] = await db
    .update(s.worlds)
    .set({ status, updatedAt: new Date() })
    .where(eq(s.worlds.id, worldId))
    .returning();
  return row ?? null;
}

export interface LoadedWorld {
  row: s.WorldRow;
  state: WorldState;
  cellSignatures: string[];
}

/** Loads the complete simulation state of a world: 8 queries, no N+1. */
export async function loadWorldState(db: Database, worldId: string): Promise<LoadedWorld | null> {
  const row = await getWorldRow(db, worldId);
  if (!row) return null;
  const [cells, people, tribes, settlements, civilizations, households, relationships] = await Promise.all([
    db
      .select()
      .from(s.worldCells)
      .where(eq(s.worldCells.worldId, worldId))
      .orderBy(asc(s.worldCells.y), asc(s.worldCells.x)),
    db
      .select()
      .from(s.people)
      .where(and(eq(s.people.worldId, worldId), eq(s.people.alive, true)))
      .orderBy(asc(s.people.seq)),
    db.select().from(s.tribes).where(eq(s.tribes.worldId, worldId)).orderBy(asc(s.tribes.seq)),
    db.select().from(s.settlements).where(eq(s.settlements.worldId, worldId)).orderBy(asc(s.settlements.seq)),
    db
      .select()
      .from(s.civilizations)
      .where(eq(s.civilizations.worldId, worldId))
      .orderBy(asc(s.civilizations.seq)),
    db
      .select()
      .from(s.households)
      .where(and(eq(s.households.worldId, worldId), isNull(s.households.dissolvedYear)))
      .orderBy(asc(s.households.seq)),
    db.select().from(s.relationships).where(eq(s.relationships.worldId, worldId)),
  ]);
  const state: WorldState = normalizeState({
    seed: row.seed,
    width: row.width,
    height: row.height,
    tick: row.currentTick,
    year: row.currentYear,
    rng: row.rngState,
    settings: row.settings,
    counters: row.counters,
    climate: row.climate,
    cells: cells.map(m.cellFromRow),
    people: people.map(m.personFromRow),
    tribes: tribes.map(m.tribeFromRow),
    settlements: settlements.map(m.settlementFromRow),
    civilizations: civilizations.map(m.civilizationFromRow),
    households: households.map(m.householdFromRow),
    relationships: relationships.map(m.relationshipFromRow),
    archive: { people: [], households: [] },
  });
  return { row, state, cellSignatures: state.cells.map(m.cellSignature) };
}

/**
 * Writes a simulation batch. Must run inside a transaction: either the whole batch
 * (state + events + stats) is persisted or nothing is.
 */
export async function persistSimulation(
  tx: Database,
  loaded: LoadedWorld,
  result: SimulationResult,
): Promise<s.WorldSummary> {
  const { row, state } = loaded;
  const worldId = row.id;

  const changedCells = state.cells.filter((c, i) => m.cellSignature(c) !== loaded.cellSignatures[i]);
  await bulkUpsert(
    tx,
    s.worldCells,
    changedCells.map((c) => m.cellToRow(worldId, c)),
    [s.worldCells.worldId, s.worldCells.y, s.worldCells.x],
    ["worldId", "x", "y"],
  );

  const people = [...state.people, ...state.archive.people];
  await bulkUpsert(
    tx,
    s.people,
    people.map((p) => m.personToRow(worldId, p)),
    [s.people.worldId, s.people.id],
    ["worldId", "id"],
  );
  const households = [...state.households, ...state.archive.households];
  await bulkUpsert(
    tx,
    s.households,
    households.map((h) => m.householdToRow(worldId, h)),
    [s.households.worldId, s.households.id],
    ["worldId", "id"],
  );
  await bulkUpsert(
    tx,
    s.tribes,
    state.tribes.map((t) => m.tribeToRow(worldId, t)),
    [s.tribes.worldId, s.tribes.id],
    ["worldId", "id"],
  );
  await bulkUpsert(
    tx,
    s.settlements,
    state.settlements.map((st) => m.settlementToRow(worldId, st)),
    [s.settlements.worldId, s.settlements.id],
    ["worldId", "id"],
  );
  await bulkUpsert(
    tx,
    s.civilizations,
    state.civilizations.map((c) => m.civilizationToRow(worldId, c)),
    [s.civilizations.worldId, s.civilizations.id],
    ["worldId", "id"],
  );
  await bulkUpsert(
    tx,
    s.relationships,
    state.relationships.map((r) => m.relationshipToRow(worldId, r)),
    [s.relationships.worldId, s.relationships.id],
    ["worldId", "id"],
  );

  if (result.events.length)
    await bulkInsert(
      tx,
      s.historicalEvents,
      result.events.map((e) => m.eventToRow(worldId, e)),
    );
  if (result.stats.length) {
    await bulkUpsert(
      tx,
      s.worldStats,
      result.stats.map((st) => m.statsToRow(worldId, st)),
      [s.worldStats.worldId, s.worldStats.tick],
      ["worldId", "tick"],
    );
  }

  const discoveries = new Map<string, HistoricalEvent>();
  for (const e of result.events) {
    if (e.type === "tech_discovered") discoveries.set(`${e.actors[0]?.id}|${String(e.metadata.techId)}`, e);
  }
  const techRows = state.tribes
    .filter((t) => t.status !== "extinct")
    .flatMap((t) =>
      t.techs.map((techId) => {
        const e = discoveries.get(`${t.id}|${techId}`);
        return {
          worldId,
          tribeId: t.id,
          techId,
          discoveredYear: e?.year ?? state.year,
          discoveredTick: e?.tick ?? state.tick,
          method: e ? String(e.metadata.method ?? "invention") : "inherited",
        };
      }),
    );
  for (const part of chunk(techRows)) await tx.insert(s.worldTechnologies).values(part).onConflictDoNothing();

  const lastEvent =
    [...result.events].sort((a, b) => b.importance - a.importance || b.seq - a.seq)[0] ?? null;
  const summary = computeSummary(state, lastEvent, row.summary);
  await tx
    .update(s.worlds)
    .set({
      currentTick: state.tick,
      currentYear: state.year,
      rngState: state.rng,
      counters: state.counters,
      climate: state.climate,
      summary,
      updatedAt: new Date(),
    })
    .where(eq(s.worlds.id, worldId));

  if (Math.floor(row.currentTick / SNAPSHOT_INTERVAL) !== Math.floor(state.tick / SNAPSHOT_INTERVAL)) {
    const snapshotState = { ...state, archive: { people: [], households: [] } };
    await tx
      .insert(s.worldSnapshots)
      .values({
        worldId,
        tick: state.tick,
        year: state.year,
        stateVersion: STATE_VERSION,
        state: JSON.parse(serializeWorld(snapshotState)),
      })
      .onConflictDoNothing();
    const keep = await tx
      .select({ tick: s.worldSnapshots.tick })
      .from(s.worldSnapshots)
      .where(and(eq(s.worldSnapshots.worldId, worldId), ne(s.worldSnapshots.tick, 0)))
      .orderBy(desc(s.worldSnapshots.tick))
      .limit(SNAPSHOTS_KEPT);
    const oldest = keep.at(-1)?.tick;
    if (keep.length === SNAPSHOTS_KEPT && oldest !== undefined) {
      await tx
        .delete(s.worldSnapshots)
        .where(
          and(
            eq(s.worldSnapshots.worldId, worldId),
            ne(s.worldSnapshots.tick, 0),
            lt(s.worldSnapshots.tick, oldest),
          ),
        );
    }
  }
  state.archive = { people: [], households: [] };
  return summary;
}

export async function recordSimulationRun(db: Database, run: typeof s.simulationRuns.$inferInsert) {
  await db.insert(s.simulationRuns).values(run);
}

export interface EventQuery {
  page: number;
  pageSize: number;
  types?: string[];
  minImportance?: number;
}

export async function listEvents(db: Database, worldId: string, q: EventQuery) {
  const filters = [eq(s.historicalEvents.worldId, worldId)];
  if (q.types?.length) filters.push(inArray(s.historicalEvents.type, q.types));
  if (q.minImportance) filters.push(gte(s.historicalEvents.importance, q.minImportance));
  const where = and(...filters);
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(s.historicalEvents)
      .where(where)
      .orderBy(desc(s.historicalEvents.seq))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ value: count() }).from(s.historicalEvents).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
}

/** Time series downsampled to at most `maxPoints` rows (every n-th tick plus the latest). */
export async function getStatsSeries(db: Database, worldId: string, currentTick: number, maxPoints: number) {
  const step = Math.max(1, Math.ceil((currentTick + 1) / maxPoints));
  return db
    .select()
    .from(s.worldStats)
    .where(
      and(
        eq(s.worldStats.worldId, worldId),
        sql`(${s.worldStats.tick} % ${step} = 0 or ${s.worldStats.tick} = ${currentTick})`,
      ),
    )
    .orderBy(asc(s.worldStats.tick));
}

export async function getWorldEntities(db: Database, worldId: string) {
  const [cells, tribes, settlements, civilizations, relationships, populations, notable, techRows] =
    await Promise.all([
      db
        .select()
        .from(s.worldCells)
        .where(eq(s.worldCells.worldId, worldId))
        .orderBy(asc(s.worldCells.y), asc(s.worldCells.x)),
      db.select().from(s.tribes).where(eq(s.tribes.worldId, worldId)).orderBy(asc(s.tribes.seq)),
      db
        .select()
        .from(s.settlements)
        .where(eq(s.settlements.worldId, worldId))
        .orderBy(asc(s.settlements.seq)),
      db
        .select()
        .from(s.civilizations)
        .where(eq(s.civilizations.worldId, worldId))
        .orderBy(asc(s.civilizations.seq)),
      db.select().from(s.relationships).where(eq(s.relationships.worldId, worldId)),
      db
        .select({
          tribeId: s.people.tribeId,
          settlementId: s.people.settlementId,
          population: count(),
          adults: sql<number>`count(*) filter (where ${s.people.age} >= 16)`.mapWith(Number),
          children: sql<number>`count(*) filter (where ${s.people.age} < 16)`.mapWith(Number),
        })
        .from(s.people)
        .where(and(eq(s.people.worldId, worldId), eq(s.people.alive, true)))
        .groupBy(s.people.tribeId, s.people.settlementId),
      db
        .select({
          id: s.people.id,
          name: s.people.name,
          age: s.people.age,
          tribeId: s.people.tribeId,
          role: s.people.role,
        })
        .from(s.people)
        .where(and(eq(s.people.worldId, worldId), eq(s.people.alive, true), eq(s.people.notable, true))),
      db.select().from(s.worldTechnologies).where(eq(s.worldTechnologies.worldId, worldId)),
    ]);
  return { cells, tribes, settlements, civilizations, relationships, populations, notable, techRows };
}

export async function getLatestSnapshot(db: Database, worldId: string) {
  const [row] = await db
    .select({
      tick: s.worldSnapshots.tick,
      year: s.worldSnapshots.year,
      createdAt: s.worldSnapshots.createdAt,
    })
    .from(s.worldSnapshots)
    .where(eq(s.worldSnapshots.worldId, worldId))
    .orderBy(desc(s.worldSnapshots.tick))
    .limit(1);
  return row ?? null;
}

export async function listRunningWorldIds(db: Database, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: s.worlds.id })
    .from(s.worlds)
    .where(eq(s.worlds.status, "running"))
    .orderBy(asc(s.worlds.updatedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}
