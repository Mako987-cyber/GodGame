function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

export function simulationConfig() {
  return {
    maxTicksPerRequest: intFromEnv("SIMULATION_MAX_TICKS_PER_REQUEST", 100, 1, 1000),
    timeBudgetMs: intFromEnv("SIMULATION_TIME_BUDGET_MS", 20_000, 1_000, 280_000),
    lockTtlMs: intFromEnv("SIMULATION_LOCK_TTL_MS", 60_000, 5_000, 600_000),
    /** Per-statement limit while saving a batch (bulk upserts of a large world). */
    persistStatementTimeoutMs: intFromEnv("SIMULATION_PERSIST_STATEMENT_TIMEOUT_MS", 25_000, 1_000, 55_000),
  };
}

/**
 * Optional autonomous mode. Without CRON_SECRET the cron route answers 401 and nothing
 * advances on its own: every parameter here only bounds how much work one invocation does.
 */
export function cronConfig() {
  return {
    secret: process.env.CRON_SECRET?.trim() || null,
    worldsPerRun: intFromEnv("CRON_WORLDS_PER_RUN", 3, 1, 20),
    ticksPerWorld: intFromEnv("CRON_TICKS_PER_WORLD", 10, 1, 100),
    budgetMs: intFromEnv("CRON_BUDGET_MS", 45_000, 5_000, 280_000),
  };
}

/**
 * World deletion. The budget is the wall time one request spends purging before answering
 * 202 (resume later); it stays well below the route's `maxDuration` (60 s). The lease must
 * exceed the longest single batch; the timeouts bound every transaction of the purge.
 */
export function deletionConfig() {
  return {
    budgetMs: intFromEnv("WORLD_DELETE_BUDGET_MS", 15_000, 500, 50_000),
    leaseMs: intFromEnv("WORLD_DELETE_LEASE_MS", 45_000, 5_000, 300_000),
    lockTimeoutMs: intFromEnv("WORLD_DELETE_LOCK_TIMEOUT_MS", 3_000, 100, 30_000),
    statementTimeoutMs: intFromEnv("WORLD_DELETE_STATEMENT_TIMEOUT_MS", 20_000, 1_000, 55_000),
    idleInTransactionMs: intFromEnv("WORLD_DELETE_IDLE_TX_TIMEOUT_MS", 10_000, 1_000, 60_000),
    pollIntervalMs: intFromEnv("WORLD_DELETE_POLL_MS", 1_000, 200, 30_000),
  };
}
