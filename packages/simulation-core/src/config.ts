import { z } from "zod";

/**
 * Central, validated configuration of the simulation. Everything the engine can tune at
 * runtime lives here: constants that never change stay in `constants.ts`.
 *
 * The object is validated with Zod so a world persisted with a partial/older configuration
 * is always normalized to a complete, in-range value (see `parseSimulationConfig`).
 */
const ratio = z.number().min(0).max(1);
const positive = z.number().min(0);

export const seasonSchema = z.enum(["spring", "summer", "autumn", "winter"]);
export type Season = z.infer<typeof seasonSchema>;

export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

export const SEASON_LABELS: Record<Season, string> = {
  spring: "primavera",
  summer: "estate",
  autumn: "autunno",
  winter: "inverno",
};

export const distributionPolicySchema = z.enum(["egalitarian", "workers", "warriors", "elite"]);
export type DistributionPolicy = z.infer<typeof distributionPolicySchema>;

export const DISTRIBUTION_POLICY_LABELS: Record<DistributionPolicy, string> = {
  egalitarian: "egualitaria",
  workers: "orientata ai lavoratori",
  warriors: "orientata ai guerrieri",
  elite: "orientata alle élite",
};

export const climateConfigSchema = z.object({
  /** Amplitude of the slow multi-decade climate oscillation. */
  slowCycleAmplitude: positive.max(0.5).default(0.07),
  /** Amplitude of the fast (decadal) oscillation. */
  fastCycleAmplitude: positive.max(0.5).default(0.04),
  /** Yearly white noise added to the global modifier. */
  yearlyNoise: positive.max(0.3).default(0.05),
  /** Probability per year that a new regional drought starts. */
  droughtChance: ratio.default(0.025),
  /** Probability per year that a river/coastal region floods. */
  floodChance: ratio.default(0.018),
  /** Probability per year that a dry forested region burns. */
  wildfireChance: ratio.default(0.016),
  /** Probability per year that an unusually harsh winter hits the world. */
  harshWinterChance: ratio.default(0.03),
  /** How much a harsh winter multiplies winter consumption and mortality. */
  harshWinterSeverity: z.number().min(1).max(3).default(1.45),
  /** Multiplier applied to food consumption during a normal winter. */
  winterConsumption: z.number().min(1).max(2).default(1.14),
});
export type ClimateConfig = z.infer<typeof climateConfigSchema>;

export const economyConfigSchema = z.object({
  /** Default rationing policy of a newly created group. */
  defaultDistribution: distributionPolicySchema.default("egalitarian"),
  /** Base annual spoilage of stored food without any preservation technology. */
  baseSpoilage: ratio.default(0.25),
  /** Share of the yearly labour pool allocated to each season. */
  seasonWeights: z
    .object({
      spring: positive.max(1).default(0.27),
      summer: positive.max(1).default(0.31),
      autumn: positive.max(1).default(0.29),
      winter: positive.max(1).default(0.13),
    })
    .default({ spring: 0.27, summer: 0.31, autumn: 0.29, winter: 0.13 })
    .describe("Quota annuale di lavoro dedicata a ciascuna stagione"),
  /** Fraction of surplus a settlement is willing to trade away in one year. */
  tradeSurplusShare: ratio.default(0.25),
  /** Transport cost per cell of distance, as a fraction of the traded volume. */
  transportCostPerCell: ratio.default(0.03),
});
export type EconomyConfig = z.infer<typeof economyConfigSchema>;

export const societyConfigSchema = z.object({
  /** Minimum consecutive years of instability before a revolt can break out. */
  unrestYearsBeforeRevolt: z.number().int().min(1).max(50).default(4),
  /** Probability multiplier of a revolt once the conditions hold. */
  revoltChance: ratio.default(0.12),
  /** Yearly speed at which culture traits drift toward their pressures. */
  cultureDrift: ratio.default(0.06),
  /** Yearly speed at which stability indicators move toward their target. */
  stabilityInertia: ratio.default(0.25),
});
export type SocietyConfig = z.infer<typeof societyConfigSchema>;

export const crisisConfigSchema = z.object({
  /** Base yearly probability of an epidemic in a dense, unhealthy settlement. */
  epidemicBaseChance: ratio.default(0.005),
  /** Population density (people per housing slot) above which epidemics become likely. */
  epidemicDensityThreshold: z.number().min(0.1).max(5).default(0.9),
  /** Maximum share of a settlement killed by a single epidemic year. */
  epidemicMaxMortality: ratio.default(0.28),
  /** Consecutive famine years after which a settlement is abandoned. */
  collapseFamineYears: z.number().int().min(1).max(20).default(3),
});
export type CrisisConfig = z.infer<typeof crisisConfigSchema>;

export const observabilityConfigSchema = z.object({
  /** Minimum importance an event must have to be stored at all. */
  minEventImportance: z.number().int().min(1).max(5).default(1),
  /** Ticks between two full per-civilization statistics rows. */
  civStatsInterval: z.number().int().min(1).max(100).default(5),
  /** Ticks between two full world snapshots. */
  snapshotInterval: z.number().int().min(10).max(1000).default(100),
});
export type ObservabilityConfig = z.infer<typeof observabilityConfigSchema>;

export const simulationConfigSchema = z.object({
  climate: climateConfigSchema.default(climateConfigSchema.parse({})),
  economy: economyConfigSchema.default(economyConfigSchema.parse({})),
  society: societyConfigSchema.default(societyConfigSchema.parse({})),
  crisis: crisisConfigSchema.default(crisisConfigSchema.parse({})),
  observability: observabilityConfigSchema.default(observabilityConfigSchema.parse({})),
});

export type SimulationConfig = z.infer<typeof simulationConfigSchema>;

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = simulationConfigSchema.parse({});

/**
 * Normalizes any (possibly partial, possibly older) configuration into a complete one.
 * Invalid values fall back to the defaults instead of throwing: a world stored years ago
 * must always stay loadable.
 */
export function parseSimulationConfig(input: unknown): SimulationConfig {
  const parsed = simulationConfigSchema.safeParse(input ?? {});
  if (parsed.success) return parsed.data;
  return DEFAULT_SIMULATION_CONFIG;
}

/** Seasonal share of the yearly labour, normalized so the four seasons always sum to 1. */
export function seasonWeights(config: SimulationConfig): Record<Season, number> {
  const w = config.economy.seasonWeights;
  const total = w.spring + w.summer + w.autumn + w.winter;
  if (total <= 0) return { spring: 0.25, summer: 0.25, autumn: 0.25, winter: 0.25 };
  return {
    spring: w.spring / total,
    summer: w.summer / total,
    autumn: w.autumn / total,
    winter: w.winter / total,
  };
}
