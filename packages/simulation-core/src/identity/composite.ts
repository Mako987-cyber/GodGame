/**
 * Composite identities: identities the engine creates when peoples of different identities fuse.
 *
 * They are generated, never historical: "Romano-Celti" or "Lega Egizio-Greca" are names built
 * from the grammar of the source identities, recorded as `identityType: "composite"`, and never
 * presented as real civilizations. Every source stays referenced (`sourceIdentityIds`,
 * `sourceCivilizationIds`); nothing of the sources is erased.
 *
 * Inside the engine a composite behaves like any identity (naming, political names, successor
 * names): `identityOf(state, id)` resolves catalog keys and composite ids alike.
 */
import { articled, capitalize, np } from "../language/italian";
import type { CompositeIdentity, CultureTraits, WorldState } from "../types";
import { DEFAULT_LEADER_TITLE_PATTERNS, getIdentity, settlementPatternsOf } from "./catalog";
import {
  IDENTITY_CATALOG_VERSION,
  UNIFORM_START,
  type HistoricalIdentityDefinition,
  type NamingProfile,
  type VisualProfile,
} from "./definition";

/** Composite states are named after the new people: "Lega Romano-Celtica". */
export const COMPOSITE_POLITICAL_PATTERNS = ["{form} {adjective}"] as const;

const definitions = new WeakMap<CompositeIdentity, HistoricalIdentityDefinition>();

/** Hyphen-aware capitalisation: "romano-celtica" → "Romano-Celtica". */
export function capitalizeCompound(text: string): string {
  return text
    .split("-")
    .map((part) => capitalize(part))
    .join("-");
}

/** The engine-facing view of a composite, shaped like a catalog identity (not part of the catalog). */
export function compositeDefinition(c: CompositeIdentity): HistoricalIdentityDefinition {
  const cached = definitions.get(c);
  if (cached) return cached;
  const definition: HistoricalIdentityDefinition = {
    key: c.id,
    displayName: c.displayName,
    shortName: c.displayName,
    aliases: [c.displayName],
    broadCategory: "regional",
    continent: "europe",
    periodLabel: "Identità composita generata dalla simulazione",
    geographicAssociations: [],
    visualProfile: c.visualProfile,
    namingProfile: c.namingProfile,
    culturalTags: c.culturalProfile.tags.length ? c.culturalProfile.tags : ["composite"],
    behavioralModifiers: [],
    description: `Popolo nato in questo mondo dalla fusione di ${c.sourceIdentityIds.join(" e ")}.`,
    representationNotes: "Identità composita generata dalla simulazione: non è una civiltà storica reale.",
    sources: [],
    dataVersion: IDENTITY_CATALOG_VERSION,
    language: {
      singularNoun: c.singularNoun,
      pluralNoun: c.displayName,
      adjective: c.adjective,
      adjectiveFeminine: c.adjectiveFeminine,
      collectiveName: c.collectiveName,
      articleGender: "masculine",
      politicalNamePatterns: [...COMPOSITE_POLITICAL_PATTERNS],
      leaderTitlePatterns: [...DEFAULT_LEADER_TITLE_PATTERNS],
      settlementNamePatterns: settlementPatternsOf(c.namingProfile),
    },
    uniformStart: {
      defaultGovernment: UNIFORM_START.defaultGovernment,
      startingTechnologies: [...UNIFORM_START.startingTechnologies],
      startingInfrastructure: [...UNIFORM_START.startingInfrastructure],
      startingPopulationRange: [...UNIFORM_START.startingPopulationRange],
    },
  };
  definitions.set(c, definition);
  return definition;
}

/** Catalog identity or composite of this world, by key/id. */
export function identityOf(
  state: Pick<WorldState, "composites">,
  id: string | null | undefined,
): HistoricalIdentityDefinition | undefined {
  if (!id) return undefined;
  const catalog = getIdentity(id);
  if (catalog) return catalog;
  const composite = state.composites?.find((c) => c.id === id);
  return composite ? compositeDefinition(composite) : undefined;
}

/** The catalog identities a key stands for: itself, or the (flattened) sources of a composite. */
export function catalogMembers(state: Pick<WorldState, "composites">, id: string): string[] {
  const composite = state.composites.find((c) => c.id === id);
  if (!composite) return [id];
  return composite.sourceIdentityIds.flatMap((source) => catalogMembers(state, source));
}

/** Canonical key of a set of identities (order-free, composites flattened). */
export function memberKeyOf(state: Pick<WorldState, "composites">, ids: string[]): string {
  return [...new Set(ids.flatMap((id) => catalogMembers(state, id)))].sort().join("+");
}

interface Grammar {
  singularNoun: string;
  pluralNoun: string;
  adjective: string;
  adjectiveFeminine: string;
}

/**
 * Italian compound ethnonym: the first people as an adjective in -o/-e, the second as a noun.
 * Romani + Celti → "Romano-Celti", "romano-celtico/a", "i Romano-Celti".
 */
export function compositeGrammar(first: Grammar, second: Grammar) {
  const head = capitalizeCompound(first.adjective);
  const pluralNoun = `${head}-${second.pluralNoun}`;
  return {
    displayName: pluralNoun,
    singularNoun: `${head}-${second.singularNoun}`,
    adjective: `${first.adjective}-${second.adjective}`,
    adjectiveFeminine: `${first.adjective}-${second.adjectiveFeminine}`,
    collectiveName: articled(np(pluralNoun, "m", "pl")),
  };
}

const unique = <T>(values: T[]) => [...new Set(values)];

/** Both phonetic stocks, interleaved: names of the new people sound like both sources. */
export function mergeNaming(a: NamingProfile, b: NamingProfile): NamingProfile {
  const interleave = (x: string[], y: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] !== undefined) out.push(x[i]!);
      if (y[i] !== undefined) out.push(y[i]!);
    }
    return unique(out);
  };
  return {
    starts: interleave(a.starts, b.starts),
    middles: interleave(a.middles, b.middles),
    middleChance: Math.round(((a.middleChance + b.middleChance) / 2) * 100) / 100,
    ends: interleave(a.ends, b.ends),
    feminineEnds: interleave(a.feminineEnds, b.feminineEnds),
    placeEnds: interleave(a.placeEnds, b.placeEnds),
    placePrefixes: unique([...a.placePrefixes, ...b.placePrefixes]),
    placeSuffixes: unique([...a.placeSuffixes, ...b.placeSuffixes]),
    reservedNames: unique([...a.reservedNames, ...b.reservedNames]),
  };
}

function mixHex(a: string, b: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) => Math.round((channel(a, i) + channel(b, i)) / 2));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Blended palette, the emblem of the larger people, both architectures. */
export function mergeVisual(a: VisualProfile, b: VisualProfile): VisualProfile {
  const primary = mixHex(a.primaryColor, b.primaryColor);
  const secondary = b.primaryColor !== primary ? b.primaryColor : a.secondaryColor;
  return {
    primaryColor: primary,
    secondaryColor: secondary,
    emblemKey: a.emblemKey,
    architecture: `${a.architecture}; ${b.architecture}`.slice(0, 120),
  };
}

/** Population-weighted culture and the union of both peoples' tags. */
export function mergeCulture(
  a: { culture: CultureTraits; population: number; tags: string[] },
  b: { culture: CultureTraits; population: number; tags: string[] },
): { traits: CultureTraits; tags: string[] } {
  const total = Math.max(1, a.population + b.population);
  const traits = Object.fromEntries(
    (Object.keys(a.culture) as (keyof CultureTraits)[]).map((k) => [
      k,
      Math.round((a.culture[k] * a.population + b.culture[k] * b.population) / total),
    ]),
  ) as unknown as CultureTraits;
  return { traits, tags: unique([...a.tags, ...b.tags]).slice(0, 6) };
}
