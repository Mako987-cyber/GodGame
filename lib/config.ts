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
