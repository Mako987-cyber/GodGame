/**
 * Deletion of one world: a tombstone, then a resumable, set-based purge.
 *
 * Dependency graph (verified against `schema.ts`, the migrations and `pg_constraint`, see
 * `tests/world-deletion.test.ts` → "audit dello schema"):
 *
 *   worlds (id)
 *     ├─ world_cells, tribes, households, people, settlements, civilizations,
 *     ├─ world_technologies, relationships, historical_events, world_stats,
 *     ├─ world_snapshots, dynasties, civilization_stats, simulation_runs,
 *     ├─ vassal_relationships, occupations, composite_identities
 *     └─ simulation_locks                (all: world_id → worlds.id ON DELETE CASCADE,
 *                                         every FK column is the leading column of the PK)
 *   technologies         — global catalogue shared by every world: NEVER deleted.
 *   world_deletion_jobs  — no FK on purpose: the job record outlives the world.
 *
 * Entity ids inside a world (t3, s5, p12…) live in composite keys `(world_id, id)`: no row of a
 * world can reference a row of another world, and every statement below is scoped by
 * `world_id`, so deleting one world can never touch another.
 *
 * Why not one big transaction? Measured cost is small (a 96×96 world after 500 years, ~32k rows,
 * is purged in < 0.1 s), but a single long transaction that must lock the world row can wait
 * forever behind an orphaned transaction and hold the request until the platform kills it
 * (HTTP 504). So:
 *
 * 1. `tombstoneWorld` — one short transaction with `lock_timeout`: lock the world row, verify
 *    confirmation/ownership/status, refuse if a simulation holds the lock, mark the world
 *    `deleting` and open a job. From here on the world is invisible to reads and writes.
 * 2. `runDeletionSlice` — within a time budget, delete batches of rows (one statement per batch,
 *    never per record) in short bounded transactions; each batch updates the job progress in the
 *    same transaction, so accounting is exact even after a crash. A lease makes a slice
 *    exclusive and expires by itself if the function dies.
 * 3. Last transaction: delete the world row (the cascade is the safety net), verify that no row
 *    of any table is left, mark the job `completed`.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, count } from "drizzle-orm";
import type { PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { logger } from "@/lib/utils/logger";
import type { Database } from "./index";
import * as s from "./schema";
import { boundedTransaction, isTransientDbError, pgErrorCode, type TxTimeouts } from "./tx";

interface ChildTable {
  name: string;
  table: PgTable;
  /** Rows per DELETE statement. Snapshots are multi-megabyte JSON documents: a few at a time. */
  batch: number;
}

/** Child tables in deletion order: history and derived data first, then entities, then the map. */
export const WORLD_CHILD_TABLES = [
  { name: "simulation_runs", table: s.simulationRuns, batch: 5000 },
  { name: "world_snapshots", table: s.worldSnapshots, batch: 2 },
  { name: "world_stats", table: s.worldStats, batch: 5000 },
  { name: "civilization_stats", table: s.civilizationStats, batch: 5000 },
  { name: "historical_events", table: s.historicalEvents, batch: 5000 },
  { name: "relationships", table: s.relationships, batch: 5000 },
  { name: "world_technologies", table: s.worldTechnologies, batch: 5000 },
  { name: "vassal_relationships", table: s.vassalRelationships, batch: 5000 },
  { name: "occupations", table: s.occupations, batch: 5000 },
  { name: "composite_identities", table: s.compositeIdentities, batch: 5000 },
  { name: "belief_systems", table: s.beliefSystems, batch: 5000 },
  { name: "diplomatic_agreements", table: s.diplomaticAgreements, batch: 5000 },
  { name: "diplomatic_reputations", table: s.diplomaticReputations, batch: 5000 },
  { name: "civilization_knowledge", table: s.civilizationKnowledge, batch: 5000 },
  { name: "households", table: s.households, batch: 5000 },
  { name: "people", table: s.people, batch: 5000 },
  { name: "dynasties", table: s.dynasties, batch: 5000 },
  { name: "settlements", table: s.settlements, batch: 5000 },
  { name: "civilizations", table: s.civilizations, batch: 5000 },
  { name: "tribes", table: s.tribes, batch: 5000 },
  { name: "world_cells", table: s.worldCells, batch: 5000 },
] as const satisfies readonly ChildTable[];

/** Removed with the world row by the cascade (the lock row lives until the very end). */
export const WORLD_CASCADE_ONLY_TABLES = [{ name: "simulation_locks", table: s.simulationLocks }] as const;

/** Tables with a `world_id` column that are not world data (checked by the schema audit test). */
export const WORLD_ID_NON_CHILD_TABLES = ["world_deletion_jobs"] as const;

export type WorldTableName =
  (typeof WORLD_CHILD_TABLES)[number]["name"] | (typeof WORLD_CASCADE_ONLY_TABLES)[number]["name"] | "worlds";

export class WorldNotFoundError extends Error {
  constructor() {
    super("world not found");
    this.name = "WorldNotFoundError";
  }
}

export class SimulationBusyError extends Error {
  constructor() {
    super("a simulation batch holds the world lock");
    this.name = "SimulationBusyError";
  }
}

export class ResidualDataError extends Error {
  constructor(readonly residual: string[]) {
    super(`residual rows after world deletion in: ${residual.join(", ")}`);
    this.name = "ResidualDataError";
  }
}

class LeaseLostError extends Error {
  constructor() {
    super("deletion lease lost");
    this.name = "LeaseLostError";
  }
}

/** Rows each table holds for the world. Diagnostics and tests only: never on the request path. */
export async function countWorldRows(
  db: Pick<Database, "select">,
  worldId: string,
): Promise<Record<WorldTableName, number>> {
  const out = {} as Record<WorldTableName, number>;
  for (const { name, table } of [...WORLD_CHILD_TABLES, ...WORLD_CASCADE_ONLY_TABLES]) {
    const [row] = await db.select({ n: count() }).from(table).where(eq(table.worldId, worldId));
    out[name] = Number(row?.n ?? 0);
  }
  const [w] = await db.select({ n: count() }).from(s.worlds).where(eq(s.worlds.id, worldId));
  out.worlds = Number(w?.n ?? 0);
  return out;
}

/** Names of the tables that still hold at least one row of the world (one round trip). */
export async function residualTables(db: Pick<Database, "execute">, worldId: string): Promise<string[]> {
  const probes = [...WORLD_CHILD_TABLES, ...WORLD_CASCADE_ONLY_TABLES].map(
    ({ name }) =>
      sql`select ${name}::text as t where exists (select 1 from ${sql.identifier(name)} where world_id = ${worldId})`,
  );
  probes.push(sql`select 'worlds'::text as t where exists (select 1 from worlds where id = ${worldId})`);
  const result = await db.execute(sql.join(probes, sql` union all `));
  return rowsOf<{ t: string }>(result).map((r) => r.t);
}

/** Rows of `db.execute` for both drivers (postgres-js returns an array, PGlite `{ rows }`). */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** One set-based batch: at most `limit` rows of the world, located by ctid, in one statement. */
async function deleteBatch(tx: Database, name: string, worldId: string, limit: number): Promise<number> {
  const t = sql.identifier(name);
  const result = await tx.execute(sql`
    with gone as (
      delete from ${t}
      where world_id = ${worldId}
        and ctid = any(array(select ctid from ${t} where world_id = ${worldId} limit ${limit}))
      returning 1
    )
    select count(*)::int as n from gone`);
  return Number(rowsOf<{ n: number }>(result)[0]?.n ?? 0);
}

// --- Tombstone ---------------------------------------------------------------------------

/** The open job of a world (queued, running or failed), if any. */
export async function findOpenJob(db: Database, worldId: string) {
  const [job] = await db
    .select()
    .from(s.worldDeletionJobs)
    .where(
      and(
        eq(s.worldDeletionJobs.worldId, worldId),
        inArray(s.worldDeletionJobs.status, ["queued", "running", "failed"]),
      ),
    )
    .limit(1);
  return job ?? null;
}

/** Open jobs of several worlds in one query (world list page). */
export async function listOpenJobs(db: Database, worldIds: string[]) {
  return db
    .select()
    .from(s.worldDeletionJobs)
    .where(
      and(
        inArray(s.worldDeletionJobs.worldId, worldIds),
        inArray(s.worldDeletionJobs.status, ["queued", "running", "failed"]),
      ),
    );
}

export async function findLatestJob(db: Database, worldId: string) {
  const [job] = await db
    .select()
    .from(s.worldDeletionJobs)
    .where(eq(s.worldDeletionJobs.worldId, worldId))
    .orderBy(desc(s.worldDeletionJobs.createdAt))
    .limit(1);
  return job ?? null;
}

/**
 * Step 1: one short, bounded transaction. Locks the world row (waiting at most
 * `lockTimeoutMs`), runs `verify`, refuses while a simulation batch holds the world lock, then
 * marks the world `deleting` and opens the job. Idempotent: a world already being deleted
 * returns its open job.
 */
export async function tombstoneWorld(
  db: Database,
  worldId: string,
  verify: (row: s.WorldRow) => void,
  options: { requestedBy: string | null; timeouts?: Partial<TxTimeouts> },
): Promise<{ row: s.WorldRow; job: s.WorldDeletionJobRow; created: boolean }> {
  return boundedTransaction(
    db,
    async (tx) => {
      const [row] = await tx.select().from(s.worlds).where(eq(s.worlds.id, worldId)).for("update");
      if (!row) throw new WorldNotFoundError();
      verify(row);
      if (row.status === "deleting") {
        const open = await findOpenJob(tx, worldId);
        if (open) return { row, job: open, created: false };
      } else {
        const [held] = await tx
          .select({ worldId: s.simulationLocks.worldId })
          .from(s.simulationLocks)
          .where(and(eq(s.simulationLocks.worldId, worldId), sql`${s.simulationLocks.expiresAt} > now()`));
        if (held) throw new SimulationBusyError();
        await tx
          .update(s.worlds)
          .set({ status: "deleting", updatedAt: sql`now()` })
          .where(eq(s.worlds.id, worldId));
      }
      const [job] = await tx
        .insert(s.worldDeletionJobs)
        .values({ worldId, worldName: row.name, requestedBy: options.requestedBy })
        .returning();
      if (!job) throw new Error("deletion job not created");
      return { row: { ...row, status: "deleting" as const }, job, created: true };
    },
    { lockTimeoutMs: 3_000, statementTimeoutMs: 10_000, ...options.timeouts },
  );
}

// --- Purge -------------------------------------------------------------------------------

export interface DeletionSliceOptions {
  /** Wall-clock budget of this slice; the job stops at a batch boundary once it is spent. */
  budgetMs: number;
  /** Lease length. Must exceed the longest batch: it is renewed after every batch. */
  leaseMs: number;
  timeouts: TxTimeouts;
  /** Overrides of the batch sizes (tests). */
  batchSizes?: Partial<Record<string, number>>;
  /** Correlation id for the logs (Vercel request id when available). */
  requestId?: string;
  now?: () => number;
}

type JobUpdate = PgUpdateSetSource<typeof s.worldDeletionJobs>;

export type SliceOutcome = "completed" | "in_progress" | "busy" | "retry" | "failed";

export interface SliceResult {
  outcome: SliceOutcome;
  job: s.WorldDeletionJobRow;
  errorCode?: string;
}

function progressOf(done: number): number {
  // Tables are cleared in order; the final step (world row + verification) is the last share.
  return Math.round((done / (WORLD_CHILD_TABLES.length + 1)) * 1000) / 1000;
}

async function reload(db: Database, jobId: string): Promise<s.WorldDeletionJobRow> {
  const [job] = await db.select().from(s.worldDeletionJobs).where(eq(s.worldDeletionJobs.id, jobId));
  if (!job) throw new Error(`deletion job ${jobId} not found`);
  return job;
}

/** Postgres messages can quote values: keep them in the job for operators, capped. */
function safeMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 300);
}

/**
 * Step 2 and 3: advances one job by at most `budgetMs`. Never throws for database errors: the
 * outcome says what happened and the job row records it.
 * - `completed`: the world and all its rows are gone, verified;
 * - `in_progress`: the budget ran out between two batches (call again);
 * - `busy`: another slice holds the lease (call again later);
 * - `retry`: a transient database error (lock/statement timeout, dropped connection): the batch
 *   rolled back, nothing is lost, the job can be resumed;
 * - `failed`: an unexpected error; the job is `failed` and can be resumed after a fix.
 */
export async function runDeletionSlice(
  db: Database,
  jobId: string,
  options: DeletionSliceOptions,
): Promise<SliceResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const token = crypto.randomUUID();
  const [claimed] = await db
    .update(s.worldDeletionJobs)
    .set({
      leaseToken: token,
      leaseUntil: sql`now() + ${options.leaseMs} * interval '1 millisecond'`,
      status: "running",
      startedAt: sql`coalesce(${s.worldDeletionJobs.startedAt}, now())`,
      attempts: sql`${s.worldDeletionJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(s.worldDeletionJobs.id, jobId),
        inArray(s.worldDeletionJobs.status, ["queued", "running", "failed"]),
        or(isNull(s.worldDeletionJobs.leaseUntil), lt(s.worldDeletionJobs.leaseUntil, sql`now()`)),
      ),
    )
    .returning();
  if (!claimed) {
    const job = await reload(db, jobId);
    return { outcome: job.status === "completed" ? "completed" : "busy", job };
  }

  const log = { worldId: claimed.worldId, jobId, requestId: options.requestId };
  const deletedByTable: Record<string, number> = { ...claimed.deletedByTable };
  const completed = [...claimed.completedTables];
  let deletedRows = claimed.deletedRows;
  let phase = claimed.currentPhase ?? "start";
  logger.info("world.delete.slice_start", { ...log, attempt: claimed.attempts, resumeFrom: phase });

  const saveProgress = async (tx: Database, extra: JobUpdate = {}) => {
    const updated = await tx
      .update(s.worldDeletionJobs)
      .set({
        currentPhase: phase,
        deletedRows,
        deletedByTable,
        completedTables: completed,
        progress: progressOf(completed.length),
        leaseUntil: sql`now() + ${options.leaseMs} * interval '1 millisecond'`,
        errorCode: null,
        errorMessage: null,
        updatedAt: sql`now()`,
        ...extra,
      })
      .where(and(eq(s.worldDeletionJobs.id, jobId), eq(s.worldDeletionJobs.leaseToken, token)))
      .returning({ id: s.worldDeletionJobs.id });
    if (updated.length !== 1) throw new LeaseLostError();
  };

  const release = (extra: JobUpdate) =>
    db
      .update(s.worldDeletionJobs)
      .set({ leaseToken: null, leaseUntil: null, updatedAt: sql`now()`, ...extra })
      .where(and(eq(s.worldDeletionJobs.id, jobId), eq(s.worldDeletionJobs.leaseToken, token)))
      .returning();

  try {
    for (const { name, batch } of WORLD_CHILD_TABLES) {
      if (completed.includes(name)) continue;
      const limit = options.batchSizes?.[name] ?? batch;
      for (;;) {
        if (now() - started >= options.budgetMs) {
          const [job] = await release({});
          logger.info("world.delete.slice_paused", {
            ...log,
            phase,
            deletedRows,
            durationMs: now() - started,
          });
          return { outcome: "in_progress", job: job ?? (await reload(db, jobId)) };
        }
        phase = name;
        const batchStarted = now();
        const n = await boundedTransaction(
          db,
          async (tx) => {
            const deleted = await deleteBatch(tx, name, claimed.worldId, limit);
            deletedRows += deleted;
            deletedByTable[name] = (deletedByTable[name] ?? 0) + deleted;
            if (deleted < limit) completed.push(name);
            await saveProgress(tx);
            return deleted;
          },
          options.timeouts,
        );
        logger.debug("world.delete.batch", {
          ...log,
          table: name,
          rows: n,
          durationMs: now() - batchStarted,
        });
        if (n < limit) break;
      }
    }

    // Final step: the world row goes (cascade = safety net), then nothing may be left anywhere.
    phase = "worlds";
    const job = await boundedTransaction(
      db,
      async (tx) => {
        const [world] = await tx
          .select({ status: s.worlds.status })
          .from(s.worlds)
          .where(eq(s.worlds.id, claimed.worldId))
          .for("update");
        if (world && world.status !== "deleting") throw new Error("world is not tombstoned");
        const [locks] = await tx
          .select({ n: count() })
          .from(s.simulationLocks)
          .where(eq(s.simulationLocks.worldId, claimed.worldId));
        const gone = await tx
          .delete(s.worlds)
          .where(eq(s.worlds.id, claimed.worldId))
          .returning({ id: s.worlds.id });
        const residual = await residualTables(tx, claimed.worldId);
        if (residual.length) throw new ResidualDataError(residual);
        deletedByTable.simulation_locks = Number(locks?.n ?? 0);
        deletedByTable.worlds = gone.length;
        deletedRows += gone.length + deletedByTable.simulation_locks;
        phase = "done";
        await saveProgress(tx, {
          status: "completed",
          progress: 1,
          finishedAt: sql`now()`,
          leaseToken: null,
          leaseUntil: null,
        });
        return reload(tx, jobId);
      },
      options.timeouts,
    );
    logger.info("world.delete.completed", {
      ...log,
      deletedRows,
      deletedByTable,
      attempts: job.attempts,
      durationMs: now() - started,
    });
    return { outcome: "completed", job };
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn("world.delete.lease_lost", { ...log, phase });
      return { outcome: "busy", job: await reload(db, jobId) };
    }
    const code = pgErrorCode(error) ?? (error instanceof ResidualDataError ? "RESIDUAL_DATA" : "INTERNAL");
    const transient = isTransientDbError(error);
    logger.error(transient ? "world.delete.transient_error" : "world.delete.failed", {
      ...log,
      phase,
      errorCode: code,
      error: safeMessage(error),
      deletedRows,
      durationMs: now() - started,
    });
    const [job] = await release({
      status: transient ? "running" : "failed",
      currentPhase: phase,
      errorCode: code,
      errorMessage: safeMessage(error),
    }).catch(() => [undefined]);
    return {
      outcome: transient ? "retry" : "failed",
      job: job ?? (await reload(db, jobId).catch(() => claimed)),
      errorCode: code,
    };
  }
}

/** Open jobs whose lease is free (never started, paused, crashed or failed transiently). */
export async function listResumableJobs(db: Database, limit: number) {
  return db
    .select()
    .from(s.worldDeletionJobs)
    .where(
      and(
        inArray(s.worldDeletionJobs.status, ["queued", "running"]),
        or(isNull(s.worldDeletionJobs.leaseUntil), lt(s.worldDeletionJobs.leaseUntil, sql`now()`)),
      ),
    )
    .orderBy(s.worldDeletionJobs.updatedAt)
    .limit(limit);
}
