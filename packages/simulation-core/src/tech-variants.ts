import { np } from "./language/italian";
import type { TechEffects } from "./technology";
import type { Cell, Tribe } from "./types";

/**
 * Local variants of a technique.
 *
 * The catalogue says what a technique is; a variant says how one people actually practises it
 * where it lives. Agriculture on a river that floods becomes flood-recession farming; fishing on
 * an open coast becomes deep-water fishing. A variant exists only when the land genuinely calls
 * for it: the rules below read the worked area, never the historical identity, and a people on
 * ordinary land simply practises the ordinary technique.
 *
 * A variant carries a small, environment-coherent effect (never more than one multiplier, never
 * more than +12%), scaled by adoption like every other technological effect.
 */

export interface TechVariant {
  /** Stable key, stored on the tribe; the text is derived from it, so it can be re-worded. */
  key: string;
  techId: string;
  name: string;
  description: string;
  /** Grammar of `name`, so sentences read "della Coltura", "dei Canali", "delle Pellicce". */
  gender: "m" | "f";
  number: "sg" | "pl";
  /** What in the land called for this adaptation, in plain language. */
  cause: string;
  effects: Partial<TechEffects>;
}

interface VariantRule extends TechVariant {
  /** Whether the worked area genuinely calls for this adaptation. */
  applies: (area: readonly Cell[], tribe: Tribe) => boolean;
}

const share = (cells: readonly Cell[], pick: (c: Cell) => boolean) =>
  cells.length === 0 ? 0 : cells.filter(pick).length / cells.length;
const mean = (cells: readonly Cell[], pick: (c: Cell) => number) =>
  cells.length === 0 ? 0 : cells.reduce((acc, c) => acc + pick(c), 0) / cells.length;

/** Ordered: the first rule that applies to a technique wins. */
const RULES: readonly VariantRule[] = [
  {
    key: "agriculture.flood",
    gender: "f",
    number: "sg",
    techId: "agriculture",
    name: "Coltura delle Piene",
    description: "Semina sui limi lasciati dal fiume quando la piena si ritira.",
    cause: "un fiume che esonda e ricopre i campi di limo",
    effects: { farmMultiplier: 1.1 },
    applies: (area) => share(area, (c) => c.river) >= 0.25 && mean(area, (c) => c.baseFertility) >= 0.5,
  },
  {
    key: "agriculture.terraces",
    gender: "f",
    number: "sg",
    techId: "agriculture",
    name: "Coltivazione a terrazze",
    description: "Pendii trasformati in gradini di terra trattenuti da muretti.",
    cause: "colline e montagne dove il suolo scivola a valle",
    effects: { farmMultiplier: 1.06 },
    applies: (area) => share(area, (c) => c.biome === "hills" || c.biome === "mountain") >= 0.4,
  },
  {
    key: "fishing.deep",
    gender: "f",
    number: "sg",
    techId: "fishing",
    name: "Pesca d'altura",
    description: "Scafi più grandi e reti lunghe, lontano dalla riva.",
    cause: "una costa aperta sul mare",
    effects: { fishMultiplier: 1.12 },
    applies: (area) => share(area, (c) => c.coastal) >= 0.3,
  },
  {
    key: "fishing.river",
    gender: "f",
    number: "sg",
    techId: "fishing",
    name: "Pesca di fiume",
    description: "Nasse e sbarramenti lungo la corrente.",
    cause: "un fiume pescoso al posto del mare",
    effects: { fishMultiplier: 1.05 },
    applies: (area) => share(area, (c) => c.river) >= 0.25 && share(area, (c) => c.coastal) < 0.1,
  },
  {
    key: "clothing.furs",
    gender: "f",
    number: "pl",
    techId: "clothing",
    name: "Pellicce d'inverno",
    description: "Strati di pelli cucite contro il gelo.",
    cause: "inverni lunghi e freddi",
    effects: { mortalityMultiplier: 0.95 },
    applies: (area) => mean(area, (c) => c.temperature) <= 0.35,
  },
  {
    key: "irrigation.canals",
    gender: "m",
    number: "pl",
    techId: "irrigation",
    name: "Canali di bonifica",
    description: "Una rete di canali che porta l'acqua del fiume lontano dalle sponde.",
    cause: "un grande fiume in una terra altrimenti asciutta",
    effects: { farmMultiplier: 1.08 },
    applies: (area) => share(area, (c) => c.river) >= 0.2 && mean(area, (c) => c.moisture) <= 0.45,
  },
  {
    key: "pottery.river_clay",
    gender: "f",
    number: "sg",
    techId: "pottery",
    name: "Ceramica d'argilla di fiume",
    description: "Impasti fini presi dalle rive, cotti in forni bassi.",
    cause: "argilla abbondante lungo le sponde",
    effects: { storageMultiplier: 1.06 },
    applies: (area) => area.reduce((acc, c) => acc + c.clay, 0) >= 40 && share(area, (c) => c.river) >= 0.15,
  },
  {
    key: "animal_husbandry.transhumance",
    gender: "f",
    number: "sg",
    techId: "animal_husbandry",
    name: "Transumanza",
    description: "Greggi portate in alto d'estate e a valle d'inverno.",
    cause: "pascoli alti separati da valli riparate",
    effects: { herdMultiplier: 1.08 },
    applies: (area) =>
      share(area, (c) => c.biome === "hills" || c.biome === "mountain") >= 0.3 &&
      share(area, (c) => c.biome === "plains") >= 0.2,
  },
  {
    key: "wheel.steppe",
    gender: "m",
    number: "pl",
    techId: "wheel",
    name: "Carri delle pianure",
    description: "Carri leggeri per distanze lunghe su terreno piatto.",
    cause: "pianure aperte senza ostacoli",
    effects: { tradeMultiplier: 1.08 },
    applies: (area) => share(area, (c) => c.biome === "plains") >= 0.6,
  },
];

const BY_KEY = new Map(RULES.map((r) => [r.key, r]));

/** Every variant the catalogue knows, for documentation and the interface. */
export const TECH_VARIANTS: readonly TechVariant[] = RULES.map(
  ({ applies: _applies, ...variant }) => variant,
);

/**
 * The variant this land calls for, or null when the ordinary technique is what fits. Pure: the
 * same area always gives the same answer, and the historical identity is never read.
 */
export function variantFor(techId: string, area: readonly Cell[], tribe: Tribe): TechVariant | null {
  for (const rule of RULES) {
    if (rule.techId !== techId) continue;
    if (!rule.applies(area, tribe)) continue;
    const { applies: _applies, ...variant } = rule;
    return variant;
  }
  return null;
}

export function variantByKey(key: string | undefined): TechVariant | null {
  if (!key) return null;
  const rule = BY_KEY.get(key);
  if (!rule) return null;
  const { applies: _applies, ...variant } = rule;
  return variant;
}

/** Local name of a technique for one people, or the catalogue name when it has no variant. */
export function localTechName(tribe: Pick<Tribe, "techVariants">, techId: string, fallback: string): string {
  return variantByKey(tribe.techVariants?.[techId])?.name ?? fallback;
}

/** The variant as a noun phrase, so articles and prepositions agree with it. */
export function variantPhrase(variant: Pick<TechVariant, "name" | "gender" | "number">) {
  return np(variant.name, variant.gender, variant.number);
}
