import {
  IDENTITY_ERA_GROUPS,
  MAX_ROSTER_SIZE,
  maxRosterSize,
  type IdentityEraGroup,
} from "@genesis/simulation-core";
import type { IdentitySummaryDTO } from "@/lib/dto";

export { maxRosterSize };

/** Labels and copy of the historical-identity UI. Kept apart from the engine: pure presentation. */

export const IDENTITY_DISCLAIMER =
  "Le identità storiche sono utilizzate come ispirazione culturale e visuale. Gli eventi, i leader e i percorsi di sviluppo sono generati dalla simulazione e non rappresentano la storia reale.";

export const ALTERNATE_HISTORY_NOTICE =
  "Le civiltà usano identità reali, ma la storia generata è completamente alternativa.";

export const CATEGORY_LABELS: Record<string, string> = {
  ancient: "Antichità",
  classical: "Età classica",
  medieval: "Medioevo",
  early_modern: "Età moderna",
  modern: "Età contemporanea",
  indigenous: "Popoli indigeni",
  regional: "Regionali",
};

/** Era filters of the catalog: "Moderne" covers the early modern and the contemporary age. */
export const ERA_FILTERS: readonly { key: IdentityEraGroup | ""; label: string }[] = [
  { key: "", label: "Tutte" },
  { key: "ancient", label: "Antiche" },
  { key: "classical", label: "Classiche" },
  { key: "medieval", label: "Medievali" },
  { key: "modern", label: "Moderne" },
  { key: "indigenous", label: "Indigene" },
  { key: "regional", label: "Regionali" },
];

export function eraOf(category: string): IdentityEraGroup | null {
  for (const [era, categories] of Object.entries(IDENTITY_ERA_GROUPS))
    if ((categories as readonly string[]).includes(category)) return era as IdentityEraGroup;
  return null;
}

/** Identities of the modern age are cultural starting points, never states already formed. */
export const MODERN_IDENTITY_NOTICE =
  "Identità dell'età moderna: ispirazione culturale e visiva, non uno stato moderno già formato. Parte con utensili di pietra, un accampamento e un clan, come tutte.";

export const CONTINENT_LABELS: Record<string, string> = {
  africa: "Africa",
  asia: "Asia",
  europe: "Europa",
  americas: "Americhe",
  oceania: "Oceania",
};

export const ROSTER_MODE_LABELS: Record<string, { label: string; hint: string }> = {
  "random-real": { label: "Casuale", hint: "Il seed sceglie le identità: stesso seed, stesso roster." },
  selected: { label: "Selezionate", hint: "Esattamente le identità che scegli." },
  custom: { label: "Personalizzato", hint: "Le tue scelte, completate a caso fino al numero indicato." },
  "all-real": { label: "Tutte", hint: "Tutte le identità del catalogo (serve una mappa grande)." },
  procedural: { label: "Classico", hint: "Tribù dai nomi inventati, senza identità storiche." },
};

export const IDENTITY_TYPE_LABELS: Record<string, string> = {
  historical: "Identità storica",
  procedural: "Popolo inventato",
  legacy: "Popolo inventato (mondo precedente)",
  composite: "Identità composita",
};

export const PLACEMENT_SIZE_LABELS: Record<string, string> = {
  small: "piccola",
  medium: "media",
  large: "grande",
};

export const PLACEMENT_TIER_LABELS: Record<string, string> = {
  preferred: "fascia preferita",
  fallback: "fascia allargata (ripiego)",
  unbalanced: "senza bilanciamento",
};

export const CIV_STATUS_LABELS: Record<string, string> = {
  active: "Attiva",
  successor: "Stato successore",
  vassal: "Stato vassallo",
  occupied: "Occupata",
  absorbed: "Assorbita",
  merged: "Confluita in un'identità composita",
  dissolved: "Dissolta",
};

export const TRAIT_LABELS: Record<string, string> = {
  cooperation: "cooperazione",
  militarism: "militarismo",
  tradeOpenness: "apertura al commercio",
  innovation: "innovazione",
  centralization: "centralizzazione",
  expansionism: "espansionismo",
};

export const TECH_METHOD_LABELS: Record<string, string> = {
  starting: "dotazione iniziale comune",
  invention: "invenzione",
  diffusion: "diffusione",
  migration: "migrazione",
  conquest: "conquista",
  inherited: "ereditata",
};

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Client-side filter of the (small) catalog already loaded by the picker. */
export function filterIdentities(
  items: readonly IdentitySummaryDTO[],
  filters: { search: string; category: string; continent: string; era?: string },
): IdentitySummaryDTO[] {
  const term = fold(filters.search.trim());
  return items.filter(
    (i) =>
      (!filters.category || i.broadCategory === filters.category) &&
      (!filters.era || eraOf(i.broadCategory) === filters.era) &&
      (!filters.continent || i.continent === filters.continent) &&
      (!term ||
        [i.displayName, i.key, ...i.aliases, ...i.geographicAssociations].some((v) =>
          fold(v).includes(term),
        )),
  );
}

export type RosterModeKey = "random-real" | "selected" | "custom" | "all-real" | "procedural";

/** Form state of the roster section; converted to the API payload by `toRosterInput`. */
export interface RosterFormState {
  mode: RosterModeKey;
  identityKeys: string[];
  civilizationCount: number;
  equalStartingLevel: boolean;
  enableIdentityModifiers: boolean;
  balancedPlacement: boolean;
}

export const DEFAULT_ROSTER_FORM: RosterFormState = {
  mode: "random-real",
  identityKeys: [],
  civilizationCount: 6,
  equalStartingLevel: true,
  enableIdentityModifiers: true,
  balancedPlacement: true,
};

/** Competitive preset: no identity leanings, balanced starts, same headcount. */
export function competitivePreset(state: RosterFormState): RosterFormState {
  return { ...state, enableIdentityModifiers: false, balancedPlacement: true, equalStartingLevel: true };
}

export const ROSTER_LIMITS = { min: 2, max: MAX_ROSTER_SIZE } as const;

/** Message explaining why the roster cannot be submitted yet, or null when it is valid. */
export function rosterProblem(state: RosterFormState, mapSize?: number): string | null {
  if (mapSize !== undefined) {
    const size =
      state.mode === "procedural"
        ? 0
        : state.mode === "selected"
          ? state.identityKeys.length
          : state.mode === "all-real"
            ? ROSTER_LIMITS.max
            : state.civilizationCount;
    const max = maxRosterSize(mapSize, mapSize);
    if (size > max) return `Una mappa ${mapSize} × ${mapSize} ospita al massimo ${max} civiltà.`;
  }
  if (state.mode === "selected" && state.identityKeys.length < ROSTER_LIMITS.min)
    return `Seleziona almeno ${ROSTER_LIMITS.min} identità.`;
  if (state.mode === "custom" && state.identityKeys.length > state.civilizationCount)
    return "Hai scelto più identità del numero di civiltà.";
  if (
    (state.mode === "random-real" || state.mode === "custom") &&
    (state.civilizationCount < ROSTER_LIMITS.min || state.civilizationCount > ROSTER_LIMITS.max)
  )
    return `Il numero di civiltà va da ${ROSTER_LIMITS.min} a ${ROSTER_LIMITS.max}.`;
  return null;
}

export function toRosterInput(state: RosterFormState) {
  const needsKeys = state.mode === "selected" || state.mode === "custom";
  return {
    mode: state.mode,
    identityKeys: needsKeys ? state.identityKeys : [],
    civilizationCount: state.civilizationCount,
    equalStartingLevel: state.equalStartingLevel,
    enableIdentityModifiers: state.enableIdentityModifiers,
    balancedPlacement: state.balancedPlacement,
  };
}
