/**
 * Complete, transactional deletion of one world.
 *
 * Dependency graph (verified against `schema.ts` and the migrations):
 *
 *   worlds (id)
 *     ├─ world_cells, tribes, households, people, settlements, civilizations,
 *     ├─ world_technologies, relationships, historical_events, world_stats,
 *     ├─ world_snapshots, dynasties, civilization_stats, simulation_runs
 *     └─ simulation_locks                       (all: world_id → worlds.id ON DELETE CASCADE)
 *
 *   technologies  — global catalogue shared by every world: NEVER deleted.
 *
 * Entity ids inside a world (t3, s5, p12…) live in composite keys `(world_id, id)`, so no row of a
 * world can reference a row of another world, and deleting by `world_id` cannot touch other worlds.
 * The cascade stays as a safety net, but every child table is deleted explicitly (and counted) so
 * the result reports what was removed and the final check can prove nothing is left behind.
 */
import { count, eq } from "drizzle-orm";
import type { Database } from "./index";
import * as s from "./schema";

/** Child tables in deletion order: history and derived data first, then entities, then the map. */
export const WORLD_CHILD_TABLES = [
  { name: "simulation_runs", table: s.simulationRuns },
  { name: "world_snapshots", table: s.worldSnapshots },
  { name: "world_stats", table: s.worldStats },
  { name: "civilization_stats", table: s.civilizationStats },
  { name: "historical_events", table: s.historicalEvents },
  { name: "relationships", table: s.relationships },
  { name: "world_technologies", table: s.worldTechnologies },
  { name: "households", table: s.households },
  { name: "people", table: s.people },
  { name: "dynasties", table: s.dynasties },
  { name: "settlements", table: s.settlements },
  { name: "civilizations", table: s.civilizations },
  { name: "tribes", table: s.tribes },
  { name: "world_cells", table: s.worldCells },
] as const;

/** Removed with the world row (the lock row of the deletion itself lives here until commit). */
export const WORLD_CASCADE_ONLY_TABLES = [{ name: "simulation_locks", table: s.simulationLocks }] as const;

export type WorldTableName =
  (typeof WORLD_CHILD_TABLES)[number]["name"] | (typeof WORLD_CASCADE_ONLY_TABLES)[number]["name"] | "worlds";

export class WorldNotFoundError extends Error {
  constructor() {
    super("world not found");
    this.name = "WorldNotFoundError";
  }
}

export class ResidualDataError extends Error {
  constructor(readonly residual: Partial<Record<WorldTableName, number>>) {
    super(`residual rows after world deletion: ${JSON.stringify(residual)}`);
    this.name = "ResidualDataError";
  }
}

/** Rows each table holds for the world (used by the deletion report and by tests). */
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

/**
 * Deletes the world and all its rows in one transaction:
 * lock the world row (FOR UPDATE) → `verify` it (confirmation, ownership, status) → delete every
 * child table → delete the world → check that no row is left → commit. Any failure rolls back.
 */
export async function deleteWorldTransaction(
  db: Database,
  worldId: string,
  verify: (row: s.WorldRow) => void,
): Promise<{ row: s.WorldRow; deleted: Record<WorldTableName, number> }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.worlds).where(eq(s.worlds.id, worldId)).for("update");
    if (!row) throw new WorldNotFoundError();
    verify(row);

    const deleted = {} as Record<WorldTableName, number>;
    for (const { name, table } of WORLD_CHILD_TABLES) {
      const [c] = await tx.select({ n: count() }).from(table).where(eq(table.worldId, worldId));
      await tx.delete(table).where(eq(table.worldId, worldId));
      deleted[name] = Number(c?.n ?? 0);
    }
    for (const { name, table } of WORLD_CASCADE_ONLY_TABLES) {
      const [c] = await tx.select({ n: count() }).from(table).where(eq(table.worldId, worldId));
      deleted[name] = Number(c?.n ?? 0);
    }
    const gone = await tx.delete(s.worlds).where(eq(s.worlds.id, worldId)).returning({ id: s.worlds.id });
    if (gone.length !== 1) throw new WorldNotFoundError();
    deleted.worlds = 1;

    const left = await countWorldRows(tx, worldId);
    const residual = Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0));
    if (Object.keys(residual).length) throw new ResidualDataError(residual);
    return { row, deleted };
  });
}
