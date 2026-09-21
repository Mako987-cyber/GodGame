import { z } from "zod";
import { TECHNOLOGIES } from "@genesis/simulation-core";

/**
 * Contracts of the technology endpoints. Every response is parsed against these before it
 * leaves the server: a shape that drifts is a failed request, not a surprise in the browser.
 */

export const TECH_STATUSES = [
  "unknown",
  "observed",
  "experimenting",
  "developing",
  "discovered",
  "spreading",
  "adopted",
  "lost",
] as const;

export const TECH_CATEGORIES = ["survival", "neolithic", "metals", "organization"] as const;

/**
 * How a people came to hold a technology, exactly as `world_technologies.method` records it:
 * `starting` is the parity every world begins with, `inherited` is a row reconstructed for a
 * technology whose discovery event is no longer in the batch being persisted.
 */
export const TECH_SOURCES = [
  "starting",
  "invention",
  "diffusion",
  "conquest",
  "migration",
  "inherited",
] as const;

const TECH_IDS = new Set(TECHNOLOGIES.map((t) => t.id));

export const technologyIdSchema = z.string().refine((id) => TECH_IDS.has(id), "Tecnologia sconosciuta");

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

/** `?status=adopted,lost` and `?category=metals` narrow the list without extra round trips. */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(values)).optional());

export const civilizationTechnologyQuerySchema = z.object({
  page,
  pageSize,
  status: csv(TECH_STATUSES),
  category: csv(TECH_CATEGORIES),
});

export type CivilizationTechnologyQuery = z.infer<typeof civilizationTechnologyQuerySchema>;

export const technologyDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(TECH_CATEGORIES),
  description: z.string(),
  prerequisites: z.array(z.string()),
  cost: z.number(),
  minPopulation: z.number(),
  requiresSettlement: z.boolean(),
  resourceRequirement: z.string(),
  geographyRequirement: z.string().nullable(),
  effectSummary: z.string(),
  tradeOff: z.string().nullable(),
  canDiffuse: z.boolean(),
  canBeLost: z.boolean(),
});

/** One technology as one people knows it right now. */
export const civilizationTechnologySchema = z.object({
  technologyId: z.string(),
  name: z.string(),
  category: z.enum(TECH_CATEGORIES),
  status: z.enum(TECH_STATUSES),
  /** 0..1 of the way to discovering it; 1 once discovered. */
  discoveryProgress: z.number(),
  /** 0..1 of how far it has spread inside the people. */
  adoptionPercentage: z.number(),
  /** Research points accumulated against `cost`. */
  progress: z.number(),
  cost: z.number(),
  discoveredYear: z.number().nullable(),
  lostYear: z.number().nullable(),
  source: z.enum(TECH_SOURCES).nullable(),
  sourceCivilizationId: z.string().nullable(),
  prerequisitesMet: z.boolean(),
  missingPrerequisites: z.array(z.string()),
  effectSummary: z.string(),
  tradeOff: z.string().nullable(),
  /** How this people practises it where it lives, when its land called for an adaptation. */
  localName: z.string().nullable(),
  localDescription: z.string().nullable(),
  localCause: z.string().nullable(),
});

export const civilizationTechnologyPageSchema = z.object({
  worldId: z.string(),
  civilizationId: z.string(),
  civilizationName: z.string(),
  counts: z.record(z.enum(TECH_STATUSES), z.number()),
  items: z.array(civilizationTechnologySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export type CivilizationTechnologyPageDTO = z.infer<typeof civilizationTechnologyPageSchema>;

/** What this people could realistically work on next, and what is still missing for it. */
export const discoverableTechnologySchema = z.object({
  technologyId: z.string(),
  name: z.string(),
  category: z.enum(TECH_CATEGORIES),
  progress: z.number(),
  cost: z.number(),
  /** 0..1: how favourable the land is for it. */
  affinity: z.number(),
  /** Relative pull on the research budget, before normalization. */
  weight: z.number(),
  prerequisitesMet: z.boolean(),
  missingPrerequisites: z.array(z.string()),
  /** Requirements the people does not meet yet, in plain language. */
  missingRequirements: z.array(z.string()),
  /**
   * Peoples this one has SEEN using it, from its own (possibly stale) knowledge — not the
   * truth. A neighbour that adopted it unseen is not listed.
   */
  knownByNeighbours: z.array(z.string()),
  previouslyLost: z.boolean(),
});

export const discoverableTechnologyPageSchema = z.object({
  worldId: z.string(),
  civilizationId: z.string(),
  items: z.array(discoverableTechnologySchema),
});

export type DiscoverableTechnologyPageDTO = z.infer<typeof discoverableTechnologyPageSchema>;

/** How one technology has travelled through one world. */
export const technologyHistorySchema = z.object({
  worldId: z.string(),
  technologyId: z.string(),
  definition: technologyDefinitionSchema,
  /** The first people to develop it, if anyone has. */
  pioneer: z.object({ civilizationId: z.string(), name: z.string(), year: z.number() }).nullable(),
  holders: z.array(
    z.object({
      civilizationId: z.string(),
      name: z.string(),
      year: z.number(),
      method: z.string(),
      adoptionPercentage: z.number(),
      status: z.enum(TECH_STATUSES),
      /** The local form this people practises, when its land called for one. */
      localName: z.string().nullable(),
    }),
  ),
  lostBy: z.array(z.object({ civilizationId: z.string(), name: z.string(), year: z.number() })),
  /** Years between the first discovery and the last acquisition; null with fewer than two. */
  spreadYears: z.number().nullable(),
  events: z.array(
    z.object({
      id: z.string(),
      year: z.number(),
      subtype: z.string().nullable(),
      title: z.string(),
      description: z.string(),
    }),
  ),
});

export type TechnologyHistoryDTO = z.infer<typeof technologyHistorySchema>;

/** The world's catalogue, with how far each technology has actually spread in it. */
export const worldTechnologiesSchema = z.object({
  worldId: z.string(),
  year: z.number(),
  items: z.array(
    technologyDefinitionSchema.extend({
      /** Peoples that hold it now. Never presented as "everyone has it". */
      holders: z.number(),
      /** Peoples alive in this world, for the denominator. */
      civilizations: z.number(),
      firstDiscoveredYear: z.number().nullable(),
      pioneerCivilizationId: z.string().nullable(),
      lostBy: z.number(),
    }),
  ),
});

export type WorldTechnologiesDTO = z.infer<typeof worldTechnologiesSchema>;

/** What one place remembers about itself, plus the events that shaped it. */
export const settlementHistorySchema = z.object({
  worldId: z.string(),
  settlementId: z.string(),
  name: z.string(),
  civilizationId: z.string(),
  civilizationName: z.string(),
  status: z.enum(["active", "abandoned"]),
  foundedYear: z.number(),
  abandonedYear: z.number().nullable(),
  population: z.number(),
  tier: z.string(),
  history: z.object({
    foundingReason: z.string(),
    foundingReasonLabel: z.string(),
    founderName: z.string().nullable(),
    specializations: z.array(z.object({ key: z.string(), label: z.string() })),
    peakPopulation: z.number(),
    peakYear: z.number(),
    destructions: z.number(),
    reconstructions: z.number(),
    occupiedYears: z.number(),
    capitalPeriods: z.array(z.object({ fromYear: z.number(), toYear: z.number().nullable() })),
  }),
  /** Technologies actually in use where this place stands. */
  technologies: z.array(z.object({ id: z.string(), name: z.string(), adoptionPercentage: z.number() })),
  events: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        year: z.number(),
        type: z.string(),
        subtype: z.string().nullable(),
        title: z.string(),
        description: z.string(),
      }),
    ),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type SettlementHistoryDTO = z.infer<typeof settlementHistorySchema>;

export const settlementHistoryQuerySchema = z.object({ page, pageSize });
export type SettlementHistoryQuery = z.infer<typeof settlementHistoryQuerySchema>;

const estimateSchema = z
  .object({
    value: z.number(),
    confidence: z.number(),
    year: z.number(),
    source: z.enum(["exploration", "trade", "diplomat", "spy", "battle", "rumor"]),
  })
  .nullable();

/**
 * What one people believes about the others. Every number here is an ESTIMATE from the
 * observer's own record: the contract has no field that could carry the truth.
 */
export const civilizationKnowledgeSchema = z.object({
  worldId: z.string(),
  observerId: z.string(),
  year: z.number(),
  items: z.array(
    z.object({
      targetId: z.string(),
      targetName: z.string(),
      lastSeen: z.object({ x: z.number(), y: z.number(), year: z.number() }).nullable(),
      population: estimateSchema,
      military: estimateSchema,
      stability: estimateSchema,
      technologies: z
        .object({ ids: z.array(z.string()), confidence: z.number(), year: z.number(), source: z.string() })
        .nullable(),
      intent: z
        .object({ hostile: z.boolean(), confidence: z.number(), year: z.number(), source: z.string() })
        .nullable(),
      staleness: z.number(),
      spyAttempts: z.number(),
      spiesCaught: z.number(),
    }),
  ),
});

export type CivilizationKnowledgeDTO = z.infer<typeof civilizationKnowledgeSchema>;
