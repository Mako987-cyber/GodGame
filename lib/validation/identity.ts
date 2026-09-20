import { z } from "zod";
import {
  EMBLEM_KEYS,
  IDENTITY_ERA_GROUPS,
  IDENTITY_CATEGORIES,
  IDENTITY_CONTINENTS,
  IDENTITY_TYPES,
  MODIFIABLE_TRAITS,
  civilizationRosterConfigSchema,
} from "@genesis/simulation-core";

/** Roster sent with `POST /api/worlds`: the core schema, so client and engine can never disagree. */
export const rosterInputSchema = civilizationRosterConfigSchema;

// --- Catalog --------------------------------------------------------------

export const identityListQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  category: z.enum(IDENTITY_CATEGORIES).optional(),
  /** Era group: ancient, classical, medieval, modern (early modern + contemporary), indigenous, regional. */
  era: z.enum(Object.keys(IDENTITY_ERA_GROUPS) as [keyof typeof IDENTITY_ERA_GROUPS]).optional(),
  continent: z.enum(IDENTITY_CONTINENTS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
});
export type IdentityListQuery = z.infer<typeof identityListQuerySchema>;

export const identityKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z_]{1,30}$/, "Identità non valida");

export const identitySummarySchema = z.object({
  key: z.string(),
  displayName: z.string(),
  aliases: z.array(z.string()),
  broadCategory: z.enum(IDENTITY_CATEGORIES),
  continent: z.enum(IDENTITY_CONTINENTS),
  periodLabel: z.string(),
  geographicAssociations: z.array(z.string()),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  emblemKey: z.enum(EMBLEM_KEYS),
  culturalTags: z.array(z.string()),
  description: z.string(),
});
export type IdentitySummaryDTO = z.infer<typeof identitySummarySchema>;

export const identityDetailSchema = identitySummarySchema.extend({
  shortName: z.string(),
  architecture: z.string(),
  modifiers: z.array(
    z.object({ id: z.string(), trait: z.enum(MODIFIABLE_TRAITS), value: z.number(), tradeoff: z.string() }),
  ),
  representationNotes: z.string(),
  sources: z.array(z.object({ work: z.string(), entry: z.string() })),
  dataVersion: z.string(),
  /** Always the same for every identity: the start never depends on the name. */
  startingState: z.object({
    technologies: z.array(z.string()),
    government: z.string(),
    buildings: z.array(z.string()),
  }),
});
export type IdentityDetailDTO = z.infer<typeof identityDetailSchema>;

export const identityPageSchema = z.object({
  items: z.array(identitySummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  catalogVersion: z.string(),
});
export type IdentityPageDTO = z.infer<typeof identityPageSchema>;

// --- Civilizations of a world ----------------------------------------------

/** Political instances are tribes: ids like `t12`. */
export const civilizationIdSchema = z
  .string()
  .trim()
  .regex(/^t\d+$/, "Civiltà non valida");

/**
 * Continuity of a political instance, derived from the world:
 * - active: independent and alive; successor: born from a split/secession of another one;
 * - vassal: bound to an overlord (vassal_relationships); occupied: all its settlements occupied;
 * - absorbed: ended by joining/being annexed into another people (identity lives on in it);
 * - merged: ended in a fusion that produced a composite identity (fusion.ts);
 * - dissolved: died out.
 */
export const CIVILIZATION_STATUSES = [
  "active",
  "successor",
  "vassal",
  "occupied",
  "absorbed",
  "merged",
  "dissolved",
] as const;

export const worldCivilizationSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  color: z.string(),
  identityId: z.string().nullable(),
  identityType: z.enum(IDENTITY_TYPES),
  emblemKey: z.string().nullable(),
  status: z.enum(CIVILIZATION_STATUSES),
  lifecycle: z.enum(["nomadic", "settled", "extinct"]),
  foundedYear: z.number(),
  endedYear: z.number().nullable(),
  government: z.string(),
  population: z.number(),
  technologies: z.array(z.string()),
  leader: z.object({ id: z.string(), name: z.string(), age: z.number(), title: z.string() }).nullable(),
  state: z
    .object({ id: z.string(), name: z.string(), status: z.string(), formerNames: z.array(z.string()) })
    .nullable(),
  predecessorIds: z.array(z.string()),
  successorIds: z.array(z.string()),
  absorbedIdentityIds: z.array(z.string()),
  absorbedByTribeId: z.string().nullable(),
  foundingMember: z.boolean(),
});
export type WorldCivilizationDTO = z.infer<typeof worldCivilizationSchema>;

export const worldCivilizationListSchema = z.object({
  worldId: z.string(),
  historical: z.boolean(),
  items: z.array(worldCivilizationSchema),
});
export type WorldCivilizationListDTO = z.infer<typeof worldCivilizationListSchema>;

export const worldCivilizationDetailSchema = worldCivilizationSchema.extend({
  identity: identitySummarySchema.nullable(),
  founding: z
    .object({
      tick: z.number(),
      initialLeaderName: z.string().nullable(),
      startingTechnologies: z.array(z.string()),
      homeName: z.string(),
      startQuality: z.number(),
      startWater: z.boolean(),
      /** Null for worlds created before the placement audit. */
      placementFallback: z.boolean().nullable(),
      fertility: z.number().nullable(),
      resources: z.number().nullable(),
      climatePenalty: z.number().nullable(),
    })
    .nullable(),
  firstSettlement: z.object({ name: z.string(), year: z.number() }).nullable(),
  /** Explicit flags shown by the UI: the identity is flavour, the history is generated. */
  realHistoryApplied: z.literal(false),
  identityUsedAsFlavour: z.boolean(),
});
export type WorldCivilizationDetailDTO = z.infer<typeof worldCivilizationDetailSchema>;

export const civilizationHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const civilizationHistorySchema = z.object({
  civilizationId: z.string(),
  discoveries: z.array(z.object({ techId: z.string(), year: z.number(), method: z.string() })),
  leadership: z.array(
    z.object({ id: z.string(), year: z.number(), title: z.string(), subtype: z.string().nullable() }),
  ),
  events: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
