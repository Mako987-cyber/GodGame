import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "./index";
import { simulationLocks } from "./schema";
import { boundedTransaction, pgErrorCode } from "./tx";

export interface LockHandle {
  worldId: string;
  token: string;
}

/**
 * Per-world mutual exclusion for the simulate endpoint. The interface is intentionally
 * small so the Postgres implementation can be swapped for Upstash Redis (SET NX PX).
 */
export interface SimulationLock {
  acquire(worldId: string, ttlMs: number): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
}

/**
 * Row-based lock: INSERT ... ON CONFLICT DO UPDATE only takes over a lock that has
 * expired, so a crashed function cannot block a world forever.
 *
 * The insert checks the foreign key on `worlds`, i.e. it needs a share lock on the world row.
 * It is bounded by `lock_timeout`: if an orphaned transaction holds that row, the caller is told
 * "busy" (409) within seconds instead of waiting until the platform kills the request (504).
 */
export class PostgresSimulationLock implements SimulationLock {
  constructor(
    private readonly db: Database,
    private readonly lockTimeoutMs = 3_000,
  ) {}

  async acquire(worldId: string, ttlMs: number): Promise<LockHandle | null> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
      const rows = await boundedTransaction(
        this.db,
        (tx) =>
          tx
            .insert(simulationLocks)
            .values({ worldId, token, expiresAt })
            .onConflictDoUpdate({
              target: simulationLocks.worldId,
              set: { token, lockedAt: sql`now()`, expiresAt },
              setWhere: lt(simulationLocks.expiresAt, sql`now()`),
            })
            .returning({ token: simulationLocks.token }),
        { lockTimeoutMs: this.lockTimeoutMs, statementTimeoutMs: this.lockTimeoutMs + 2_000 },
      );
      return rows[0]?.token === token ? { worldId, token } : null;
    } catch (error) {
      // Row locked by someone else for longer than lock_timeout: the world is busy.
      if (pgErrorCode(error) === "55P03") return null;
      throw error;
    }
  }

  async release(handle: LockHandle): Promise<void> {
    await this.db
      .delete(simulationLocks)
      .where(and(eq(simulationLocks.worldId, handle.worldId), eq(simulationLocks.token, handle.token)));
  }
}

/** Single-process implementation, useful in tests. */
export class InMemorySimulationLock implements SimulationLock {
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(worldId: string, ttlMs: number): Promise<LockHandle | null> {
    const current = this.locks.get(worldId);
    if (current && current.expiresAt > Date.now()) return null;
    const token = crypto.randomUUID();
    this.locks.set(worldId, { token, expiresAt: Date.now() + ttlMs });
    return { worldId, token };
  }

  async release(handle: LockHandle): Promise<void> {
    if (this.locks.get(handle.worldId)?.token === handle.token) this.locks.delete(handle.worldId);
  }
}
