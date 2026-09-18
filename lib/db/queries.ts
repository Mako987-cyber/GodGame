import {
  collectStats,
  createContext,
  DEFAULT_SIMULATION_CONFIG,
  migrateState,
  normalizeState,
  parseSimulationConfig,
  serializeWorld,
  SIMULATION_VERSION,
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
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./index";
import * as m from "./mappers";
import * as s from "./schema";

const CHUNK_ROWS = 400;
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
        simulationVersion: state.simulationVersion,
        config: state.config,
        crises: state.crises,
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
  const [cells, people, tribes, settlements, civilizations, households, relationships, dynasties] =
    await Promise.all([
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
      db
        .select()
        .from(s.households)
        .where(and(eq(s.households.worldId, worldId), isNull(s.households.dissolvedYear)))
        .orderBy(asc(s.households.seq)),
      db.select().from(s.relationships).where(eq(s.relationships.worldId, worldId)),
      db.select().from(s.dynasties).where(eq(s.dynasties.worldId, worldId)).orderBy(asc(s.dynasties.seq)),
    ]);
  // `migrateState` fills everything a world created by an older engine version is missing.
  const state: WorldState = normalizeState(
    migrateState({
      seed: row.seed,
      width: row.width,
      height: row.height,
      tick: row.currentTick,
      year: row.currentYear,
      rng: row.rngState,
      simulationVersion: row.simulationVersion ?? 1,
      config: parseSimulationConfig(row.config ?? DEFAULT_SIMULATION_CONFIG),
      settings: row.settings,
      counters: row.counters,
      climate: row.climate,
      cells: cells.map((c) => m.cellFromRow(row.seed, c)),
      people: people.map(m.personFromRow),
      tribes: tribes.map((t) => m.tribeFromRow(row.seed, t)),
      settlements: settlements.map(m.settlementFromRow),
      civilizations: civilizations.map(m.civilizationFromRow),
      households: households.map(m.householdFromRow),
      relationships: relationships.map(m.relationshipFromRow),
      dynasties: dynasties.map(m.dynastyFromRow),
      crises: row.crises ?? [],
      archive: { people: [], households: [] },
    }),
  );
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

  await bulkUpsert(
    tx,
    s.dynasties,
    state.dynasties.map((d) => m.dynastyToRow(worldId, d)),
    [s.dynasties.worldId, s.dynasties.id],
    ["worldId", "id"],
  );

  if (result.events.length)
    await bulkInsert(
      tx,
      s.historicalEvents,
      result.events.map((e) => m.eventToRow(worldId, e)),
    );
  if (result.civStats.length) {
    await bulkUpsert(
      tx,
      s.civilizationStats,
      result.civStats.map((st) => m.civStatsToRow(worldId, st)),
      [s.civilizationStats.worldId, s.civilizationStats.civilizationId, s.civilizationStats.tick],
      ["worldId", "civilizationId", "tick"],
    );
  }
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
      simulationVersion: SIMULATION_VERSION,
      config: state.config,
      crises: state.crises,
      updatedAt: new Date(),
    })
    .where(eq(s.worlds.id, worldId));

  const snapshotInterval = state.config.observability.snapshotInterval;
  if (Math.floor(row.currentTick / snapshotInterval) !== Math.floor(state.tick / snapshotInterval)) {
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
  search?: string;
  fromYear?: number;
  toYear?: number;
  actorId?: string;
}

export async function listEvents(db: Database, worldId: string, q: EventQuery) {
  const filters = [eq(s.historicalEvents.worldId, worldId)];
  if (q.types?.length) filters.push(inArray(s.historicalEvents.type, q.types));
  if (q.minImportance) filters.push(gte(s.historicalEvents.importance, q.minImportance));
  if (q.fromYear !== undefined) filters.push(gte(s.historicalEvents.year, q.fromYear));
  if (q.toYear !== undefined) filters.push(lte(s.historicalEvents.year, q.toYear));
  if (q.search) {
    // Parameterized: the term never reaches SQL as text.
    const term = `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(
      sql`(${s.historicalEvents.title} ilike ${term} or ${s.historicalEvents.description} ilike ${term})`,
    );
  }
  if (q.actorId) {
    filters.push(sql`${s.historicalEvents.actors} @> ${JSON.stringify([{ id: q.actorId }])}::jsonb`);
  }
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
  const [
    cells,
    tribes,
    settlements,
    civilizations,
    relationships,
    populations,
    notable,
    techRows,
    dynasties,
  ] = await Promise.all([
    db
      .select()
      .from(s.worldCells)
      .where(eq(s.worldCells.worldId, worldId))
      .orderBy(asc(s.worldCells.y), asc(s.worldCells.x)),
    db.select().from(s.tribes).where(eq(s.tribes.worldId, worldId)).orderBy(asc(s.tribes.seq)),
    db.select().from(s.settlements).where(eq(s.settlements.worldId, worldId)).orderBy(asc(s.settlements.seq)),
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
        title: s.people.title,
        prestige: s.people.prestige,
      })
      .from(s.people)
      .where(and(eq(s.people.worldId, worldId), eq(s.people.alive, true), eq(s.people.notable, true))),
    db.select().from(s.worldTechnologies).where(eq(s.worldTechnologies.worldId, worldId)),
    db.select().from(s.dynasties).where(eq(s.dynasties.worldId, worldId)).orderBy(asc(s.dynasties.seq)),
  ]);
  return {
    cells,
    tribes,
    settlements,
    civilizations,
    relationships,
    populations,
    notable,
    techRows,
    dynasties,
  };
}

/** Per-civilization series, downsampled like the world one. */
export async function getCivilizationStatsSeries(
  db: Database,
  worldId: string,
  currentTick: number,
  maxPoints: number,
) {
  const step = Math.max(1, Math.ceil((currentTick + 1) / maxPoints));
  return db
    .select()
    .from(s.civilizationStats)
    .where(
      and(
        eq(s.civilizationStats.worldId, worldId),
        sql`(${s.civilizationStats.tick} % ${step} = 0 or ${s.civilizationStats.tick} = ${currentTick})`,
      ),
    )
    .orderBy(asc(s.civilizationStats.tick));
}

/**
 * Detail of a single person, loaded on demand: the world payload only carries the notable
 * ones, everybody else is fetched by id.
 */
export async function getPersonDetail(db: Database, worldId: string, personId: string) {
  const [person] = await db
    .select()
    .from(s.people)
    .where(and(eq(s.people.worldId, worldId), eq(s.people.id, personId)))
    .limit(1);
  if (!person) return null;
  const relatives = [person.motherId, person.fatherId].filter((id): id is string => Boolean(id));
  const [parents, children, household, tribe, settlement, dynasty, events] = await Promise.all([
    relatives.length
      ? db
          .select({ id: s.people.id, name: s.people.name })
          .from(s.people)
          .where(and(eq(s.people.worldId, worldId), inArray(s.people.id, relatives)))
      : Promise.resolve([] as { id: string; name: string }[]),
    db
      .select({ id: s.people.id, name: s.people.name, alive: s.people.alive })
      .from(s.people)
      .where(
        and(
          eq(s.people.worldId, worldId),
          sql`(${s.people.motherId} = ${personId} or ${s.people.fatherId} = ${personId})`,
        ),
      )
      .limit(40),
    person.householdId
      ? db
          .select()
          .from(s.households)
          .where(and(eq(s.households.worldId, worldId), eq(s.households.id, person.householdId)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ id: s.tribes.id, name: s.tribes.name })
      .from(s.tribes)
      .where(and(eq(s.tribes.worldId, worldId), eq(s.tribes.id, person.tribeId)))
      .limit(1),
    person.settlementId
      ? db
          .select({ id: s.settlements.id, name: s.settlements.name })
          .from(s.settlements)
          .where(and(eq(s.settlements.worldId, worldId), eq(s.settlements.id, person.settlementId)))
          .limit(1)
      : Promise.resolve([]),
    person.dynastyId
      ? db
          .select({ id: s.dynasties.id, name: s.dynasties.name })
          .from(s.dynasties)
          .where(and(eq(s.dynasties.worldId, worldId), eq(s.dynasties.id, person.dynastyId)))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(s.historicalEvents)
      .where(
        and(
          eq(s.historicalEvents.worldId, worldId),
          sql`${s.historicalEvents.actors} @> ${JSON.stringify([{ id: personId }])}::jsonb`,
        ),
      )
      .orderBy(desc(s.historicalEvents.seq))
      .limit(25),
  ]);
  let partnerId: string | null = null;
  const h = household[0];
  // Children keep the household id of their parents: only an actual partner has a partner.
  if (h && h.dissolvedYear === null && (h.partnerAId === personId || h.partnerBId === personId)) {
    partnerId = h.partnerAId === personId ? h.partnerBId : h.partnerAId;
  }
  const partner = partnerId
    ? ((
        await db
          .select({ id: s.people.id, name: s.people.name })
          .from(s.people)
          .where(and(eq(s.people.worldId, worldId), eq(s.people.id, partnerId)))
          .limit(1)
      )[0] ?? null)
    : null;
  return {
    person,
    mother: parents.find((p) => p.id === person.motherId) ?? null,
    father: parents.find((p) => p.id === person.fatherId) ?? null,
    partner,
    children,
    tribe: tribe[0] ?? null,
    settlement: settlement[0] ?? null,
    dynasty: dynasty[0] ?? null,
    events,
  };
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
