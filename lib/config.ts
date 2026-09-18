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
