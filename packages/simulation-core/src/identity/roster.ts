import { z } from "zod";
import { clamp } from "../grid";
import { deriveRng } from "../prng";
import type { CultureTraits } from "../types";
import { HISTORICAL_IDENTITIES, IDENTITY_BY_KEY } from "./catalog";
import type { HistoricalIdentityDefinition } from "./definition";

/**
 * Common starting state of every people in a historical world. Identities never alter it:
 * the same technology, government, buildings and food for everyone.
 *
 * `buildings: ["camp"]` is the nomadic encampment of a band: the first permanent settlement
 * is founded by the engine when the band settles, exactly as for procedural tribes.
 */
export const STARTING_CIVILIZATION_STATE = {
  technologies: ["stone_tools"],
  buildings: ["camp"],
  government: "clan",
  settlementLevel: "camp",
  militaryLevel: "primitive",
  literacy: 0,
  administration: 0,
  /** Stored food per member at tick 0. */
  foodPerCapita: 0.5,
  /** Radius of the land a nomadic band works, in cells. */
  territoryRadius: 2,
} as const;

export type StartingCivilizationState = typeof STARTING_CIVILIZATION_STATE;

export const MIN_ROSTER_SIZE = 2;
export const MAX_ROSTER_SIZE = HISTORICAL_IDENTITIES.length;

/** Land needed per people (cells of map area): below it starting points would be cramped. */
export const CELLS_PER_CIVILIZATION = 60;

/** Largest roster a map of this size can host with meaningful room around each start. */
export function maxRosterSize(width: number, height: number): number {
  return Math.max(
    MIN_ROSTER_SIZE,
    Math.min(MAX_ROSTER_SIZE, Math.floor((width * height) / CELLS_PER_CIVILIZATION)),
  );
}

export const ROSTER_MODES = ["random-real", "selected", "custom", "all-real", "procedural"] as const;
export type RosterMode = (typeof ROSTER_MODES)[number];

/** Canonical catalog order, so the same selection in a different order yields the same world. */
function canonical(keys: readonly string[]): string[] {
  const index = new Map(HISTORICAL_IDENTITIES.map((identity, i) => [identity.key, i]));
  return [...keys].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
}

export const civilizationRosterConfigSchema = z
  .object({
    /**
     * - `random-real`: the seed picks `civilizationCount` identities;
     * - `selected`: exactly the listed identities;
     * - `custom`: the listed identities, completed at random up to `civilizationCount`;
     * - `all-real`: every identity of the catalog;
     * - `procedural`: classic invented tribes, no historical identity.
     */
    mode: z.enum(ROSTER_MODES).default("random-real"),
    identityKeys: z.array(z.string().trim().min(1).max(40)).max(MAX_ROSTER_SIZE).default([]),
    civilizationCount: z.number().int().min(MIN_ROSTER_SIZE).max(MAX_ROSTER_SIZE).default(6),
    allowDuplicateCulturalIdentity: z.boolean().default(false),
    /** Same headcount for everyone (otherwise: same range, drawn per people). */
    equalStartingLevel: z.boolean().default(true),
    /** Light, balanced culture leanings of the identities. Off in competitive games. */
    enableIdentityModifiers: z.boolean().default(true),
    /** Comparable land quality and water access at every starting point. */
    balancedPlacement: z.boolean().default(true),
    startingTechnologyPolicy: z.literal("uniform").default("uniform"),
    startingGovernmentPolicy: z.literal("uniform").default("uniform"),
  })
  .superRefine((cfg, ctx) => {
    for (const key of cfg.identityKeys) {
      if (!IDENTITY_BY_KEY.has(key))
        ctx.addIssue({ code: "custom", path: ["identityKeys"], message: `Identità sconosciuta: ${key}` });
    }
    if (!cfg.allowDuplicateCulturalIdentity && new Set(cfg.identityKeys).size !== cfg.identityKeys.length)
      ctx.addIssue({
        code: "custom",
        path: ["identityKeys"],
        message: "La stessa identità compare due volte ma i duplicati non sono consentiti",
      });
    if (cfg.mode === "selected" && cfg.identityKeys.length < MIN_ROSTER_SIZE)
      ctx.addIssue({
        code: "custom",
        path: ["identityKeys"],
        message: `Seleziona almeno ${MIN_ROSTER_SIZE} identità`,
      });
    if (cfg.mode === "custom" && cfg.identityKeys.length > cfg.civilizationCount)
      ctx.addIssue({
        code: "custom",
        path: ["identityKeys"],
        message: "Il roster personalizzato contiene più identità del numero di civiltà",
      });
  })
  // Stored in catalog order: the same choice in a different order is the same world.
  .transform((cfg) => ({ ...cfg, identityKeys: canonical(cfg.identityKeys) }));

export type CivilizationRosterConfigInput = z.input<typeof civilizationRosterConfigSchema>;
export type CivilizationRosterConfig = z.output<typeof civilizationRosterConfigSchema>;

export function parseRosterConfig(input: unknown): CivilizationRosterConfig {
  return civilizationRosterConfigSchema.parse(input ?? {});
}

/** One founding slot of a world: which identity starts where. Written once, at creation. */
export interface RosterEntry {
  slot: number;
  identityId: string;
  tribeId: string;
  displayName: string;
  color: string;
  emblemKey: string;
  startX: number;
  startY: number;
  /** Land quality score of the starting area (0..1), recorded to audit the balance. */
  startQuality: number;
  /** River, coast or fresh water within reach of the starting cell. */
  startWater: boolean;
  population: number;
  initialLeaderId: string | null;
  initialLeaderName: string | null;
  /** Name of the first encampment (the band's home before any settlement). */
  homeName: string;
}

export interface WorldRoster {
  config: CivilizationRosterConfig;
  catalogVersion: string;
  entries: RosterEntry[];
}

/**
 * Deterministic list of identities, in slot order, for a world. Uses its own stream derived
 * from the seed: the simulation RNG is untouched, and for the same count the permutation of
 * slots is the same whatever identities fill them.
 */
export function resolveRosterIdentities(
  seed: string,
  config: CivilizationRosterConfig,
): HistoricalIdentityDefinition[] {
  if (config.mode === "procedural") return [];
  const rng = deriveRng(seed, "roster");
  const all = HISTORICAL_IDENTITIES.map((identity) => identity.key);
  let keys: string[];
  switch (config.mode) {
    case "selected":
      keys = canonical(config.identityKeys);
      break;
    case "all-real":
      keys = all;
      break;
    case "custom": {
      const chosen = canonical(config.identityKeys);
      const rest = rng.shuffle(all.filter((k) => !chosen.includes(k)));
      keys = [...chosen, ...rest].slice(0, config.civilizationCount);
      break;
    }
    default:
      keys = rng.shuffle([...all]).slice(0, config.civilizationCount);
  }
  // Slot order decides who starts where: a pure permutation, blind to geography and history.
  const order = rng.shuffle(keys.map((_, i) => i));
  return order.map((i) => {
    const identity = IDENTITY_BY_KEY.get(keys[i] ?? "");
    if (!identity) throw new Error(`Identità sconosciuta nel roster: ${keys[i]}`);
    return identity;
  });
}

/** Starting culture nudged by the identity's modifiers (if enabled). Consumes no randomness. */
export function applyIdentityModifiers(
  culture: CultureTraits,
  identity: HistoricalIdentityDefinition,
  enabled: boolean,
): CultureTraits {
  if (!enabled) return culture;
  const out = { ...culture };
  for (const mod of identity.behavioralModifiers)
    out[mod.trait] = Math.round(clamp(out[mod.trait] + mod.value, 5, 95));
  return out;
}
