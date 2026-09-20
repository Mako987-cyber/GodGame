import { z } from "zod";

/**
 * Historical identities.
 *
 * An identity is the *starting point* of a people inside a world: a name, a palette, an
 * emblem, a way of naming people and places and, at most, a few light cultural leanings.
 * It never carries a timeline, historical rulers, cities, territories or technologies:
 * everything a people becomes inside a world is produced by the simulation.
 *
 * Three layers are kept apart on purpose:
 * - `HistoricalIdentityDefinition` (this file + `catalog.ts`): static, versioned metadata;
 * - the political instance inside a world (`Tribe`, with `identityId`), which can split,
 *   be absorbed or die out;
 * - the generated history (events, stats, dynasties) written by the engine.
 */

/** Bumped whenever an identity is added or its metadata changes. */
export const IDENTITY_CATALOG_VERSION = "2026.09-2";

/**
 * The start every identity declares — and the only one it may declare. It is not a property of
 * the people but of the game: prehistoric Egizi and "modern" Italiani alike begin as a band
 * with stone tools, a camp and a clan. The schema below only accepts exactly these values.
 */
export const UNIFORM_START = {
  defaultGovernment: "clan",
  startingTechnologies: ["stone_tools"],
  startingInfrastructure: ["camp"],
  /** Band size range of `DEFAULT_SETTINGS` (minTribeSize..maxTribeSize). */
  startingPopulationRange: [15, 40],
} as const;

export const uniformStartSchema = z.object({
  defaultGovernment: z.literal(UNIFORM_START.defaultGovernment),
  startingTechnologies: z.tuple([z.literal("stone_tools")]),
  startingInfrastructure: z.tuple([z.literal("camp")]),
  startingPopulationRange: z.tuple([z.literal(15), z.literal(40)]),
});
export type UniformStart = z.infer<typeof uniformStartSchema>;

/**
 * Grammar of an identity in Italian, so generated sentences read "gli Egizi hanno fondato…" and
 * "il Regno Egizio…", never "la tribù Egizi". Patterns use `{tokens}`:
 * - political names: `{form}` (Regno, Lega… from the government), `{capital}`, `{adjective}`
 *   (agreed with the form: "Regno Egizio", "Lega Egizia");
 * - leader phrases: `{title}`, `{name}`;
 * - settlement names: `{stem}` (derived from the naming profile's prefixes/suffixes).
 */
export const identityLanguageProfileSchema = z.object({
  /** One member of the people, capitalised as a proper noun: "Egizio". */
  singularNoun: z.string().min(2).max(40),
  /** The people: equal to `displayName` ("Egizi"). */
  pluralNoun: z.string().min(2).max(40),
  /** Masculine / feminine singular adjective, lower case: "egizio" / "egizia". */
  adjective: z.string().min(2).max(40),
  adjectiveFeminine: z.string().min(2).max(40),
  /** Plural noun with its article: "gli Egizi", "i Romani". */
  collectiveName: z.string().min(3).max(45),
  articleGender: z.enum(["masculine", "feminine", "neutral"]),
  politicalNamePatterns: z.array(z.string().includes("{form}")).min(1).max(6),
  leaderTitlePatterns: z.array(z.string().includes("{name}")).min(1).max(4),
  settlementNamePatterns: z.array(z.string().includes("{stem}")).min(1).max(8),
});
export type IdentityLanguageProfile = z.infer<typeof identityLanguageProfileSchema>;

/**
 * Largest absolute culture offset (on the 0..100 trait scale) one identity modifier may apply.
 * Starting cultures are drawn with a ±30 spread, so ±5 is a nudge, not a destiny.
 */
export const MAX_IDENTITY_MODIFIER = 5;

/** The offsets of an identity must cancel out: no identity gets a net head start. */
export const MAX_IDENTITY_MODIFIER_SUM = 1;

export const IDENTITY_CATEGORIES = [
  "ancient",
  "classical",
  "medieval",
  "early_modern",
  "modern",
  "indigenous",
  "regional",
] as const;
export type IdentityCategory = (typeof IDENTITY_CATEGORIES)[number];

export const IDENTITY_CONTINENTS = ["africa", "asia", "europe", "americas", "oceania"] as const;
export type IdentityContinent = (typeof IDENTITY_CONTINENTS)[number];

/** Culture traits an identity may nudge. Kept to the behavioural ones listed in the design. */
export const MODIFIABLE_TRAITS = [
  "cooperation",
  "militarism",
  "tradeOpenness",
  "innovation",
  "centralization",
  "expansionism",
] as const;
export type ModifiableTrait = (typeof MODIFIABLE_TRAITS)[number];

/** Emblems are abstract glyphs drawn by the UI, never real flags or coats of arms. */
export const EMBLEM_KEYS = [
  "sun",
  "moon",
  "star",
  "wave",
  "mountain",
  "tree",
  "wheat",
  "bird",
  "serpent",
  "landmark",
  "ship",
  "tower",
  "flame",
  "eye",
  "spiral",
  "feather",
  "shield",
  "crown",
  "leaf",
  "anchor",
] as const;
export type EmblemKey = (typeof EMBLEM_KEYS)[number];

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/, "colore esadecimale #rrggbb minuscolo");
const syllable = z
  .string()
  .regex(/^[a-zà-ÿ'-]+$/, "sillaba in minuscolo")
  .min(1)
  .max(6);
const nameList = z.array(syllable).min(3);

export const namingProfileSchema = z.object({
  /** Syllables a personal name starts with. */
  starts: nameList,
  /** Optional inner syllables. */
  middles: z.array(syllable).min(2),
  /** Probability (0..1) that a name gets an inner syllable. */
  middleChance: z.number().min(0).max(1),
  /** Endings of names; `feminineEnds` are used for women when present. */
  ends: z
    .array(
      z
        .string()
        .regex(/^[a-zà-ÿ'-]*$/)
        .max(5),
    )
    .min(3),
  feminineEnds: z.array(
    z
      .string()
      .regex(/^[a-zà-ÿ'-]*$/)
      .max(5),
  ),
  /** Place-name endings; the stem reuses `starts`. */
  placeEnds: z
    .array(
      z
        .string()
        .regex(/^[a-zà-ÿ'-]*$/)
        .max(6),
    )
    .min(3),
  /** Optional words joined to a place stem ("Per-", "-polis"...). Pure phonetics, no real city names. */
  placePrefixes: z.array(z.string().max(8)),
  placeSuffixes: z.array(z.string().max(8)),
  /**
   * Real historical figures and places a generated name must never coincide with (compared
   * case-insensitively). The generator rerolls instead of producing one of these.
   */
  reservedNames: z.array(z.string().min(2)),
});
export type NamingProfile = z.infer<typeof namingProfileSchema>;

export const visualProfileSchema = z.object({
  primaryColor: hexColor,
  secondaryColor: hexColor,
  emblemKey: z.enum(EMBLEM_KEYS),
  /** Free-text inspiration for renderers (building silhouettes, ornaments). */
  architecture: z.string().min(3).max(120),
});
export type VisualProfile = z.infer<typeof visualProfileSchema>;

export const identityModifierSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  trait: z.enum(MODIFIABLE_TRAITS),
  /** Offset applied once to the starting culture, then culture drifts freely. */
  value: z
    .number()
    .int()
    .min(-MAX_IDENTITY_MODIFIER)
    .max(MAX_IDENTITY_MODIFIER)
    .refine((v) => v !== 0, "un modificatore nullo è inutile"),
  /** What the leaning costs: every identity pays for its nudges. */
  tradeoff: z.string().min(3).max(160),
});
export type IdentityModifier = z.infer<typeof identityModifierSchema>;

export const historicalSourceSchema = z.object({
  /** Reference work (general encyclopedias only: descriptions stay at a high level). */
  work: z.string().min(3),
  entry: z.string().min(2),
});
export type HistoricalSourceReference = z.infer<typeof historicalSourceSchema>;

export const historicalIdentitySchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z_]{1,30}$/),
    /** Plural Italian name used as the people's name in the world ("Egizi"). */
    displayName: z.string().min(2).max(40),
    shortName: z.string().min(2).max(20),
    aliases: z.array(z.string().min(2).max(60)).min(1),
    broadCategory: z.enum(IDENTITY_CATEGORIES),
    continent: z.enum(IDENTITY_CONTINENTS),
    /** Descriptive period label for the catalog only; the engine never reads it. */
    periodLabel: z.string().min(3).max(60),
    geographicAssociations: z.array(z.string().min(2)).min(1),
    visualProfile: visualProfileSchema,
    namingProfile: namingProfileSchema,
    culturalTags: z
      .array(z.string().regex(/^[a-z_]+$/))
      .min(1)
      .max(6),
    behavioralModifiers: z.array(identityModifierSchema).max(3),
    description: z.string().min(40).max(600),
    representationNotes: z.string().min(20).max(400),
    sources: z.array(historicalSourceSchema).min(1),
    dataVersion: z.string().min(1),
    language: identityLanguageProfileSchema,
    uniformStart: uniformStartSchema,
  })
  .superRefine((identity, ctx) => {
    const mods = identity.behavioralModifiers;
    const sum = mods.reduce((acc, m) => acc + m.value, 0);
    if (Math.abs(sum) > MAX_IDENTITY_MODIFIER_SUM)
      ctx.addIssue({ code: "custom", message: `modificatori non bilanciati (somma ${sum})` });
    if (mods.some((m) => m.value > 0) && !mods.some((m) => m.value < 0))
      ctx.addIssue({ code: "custom", message: "ogni vantaggio richiede un compromesso negativo" });
    const traits = mods.map((m) => m.trait);
    if (new Set(traits).size !== traits.length)
      ctx.addIssue({ code: "custom", message: "tratto modificato due volte" });
    if (identity.visualProfile.primaryColor === identity.visualProfile.secondaryColor)
      ctx.addIssue({ code: "custom", message: "colori primario e secondario identici" });
    if (identity.language.pluralNoun !== identity.displayName)
      ctx.addIssue({
        code: "custom",
        message: "il plurale del profilo linguistico deve essere il nome del popolo",
      });
    if (
      !identity.language.collectiveName.endsWith(` ${identity.displayName}`) &&
      !identity.language.collectiveName.endsWith(`'${identity.displayName}`)
    )
      ctx.addIssue({
        code: "custom",
        message: "il nome collettivo deve essere «articolo + nome del popolo»",
      });
  });

export type HistoricalIdentityDefinition = z.infer<typeof historicalIdentitySchema>;

/**
 * How a political instance relates to the catalog.
 * - `historical`: carries an identity from the catalog;
 * - `procedural`: invented name, created by a new world in procedural mode;
 * - `legacy`: created before identities existed (never renamed, never reassigned);
 * - `composite`: born from the merger of different identities (reserved for future mergers).
 */
export const IDENTITY_TYPES = ["historical", "procedural", "legacy", "composite"] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];
