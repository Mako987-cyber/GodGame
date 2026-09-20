/**
 * How the engine names peoples, states, leaders and places in generated text.
 *
 * - A people with a historical (or composite) identity is a plural noun: "gli Egizi",
 *   "gli Egizi del Nord", "i Romano-Celti" — never "la tribù Egizi".
 * - A procedural or legacy people keeps its invented name as the name of a tribe:
 *   "la tribù Kanar" (feminine singular: "la tribù Kanar è nata", "della tribù Kanar").
 * - A state is named by its political name, whose first word gives the gender:
 *   "il Regno di Naru", "la Lega Romana", "la Confederazione Egizio-Celtica".
 * - A leader is named with the title of the government the simulation produced.
 */
import { SETTLEMENT_TIER_LABELS } from "../constants";
import { DEFAULT_LEADER_TITLE_PATTERNS, getIdentity } from "../identity/catalog";
import type { HistoricalIdentityDefinition } from "../identity/definition";
import { politicalTitle } from "../identity/politics";
import type { Civilization, GovernmentType, Settlement, SettlementTier, Sex, Tribe } from "../types";
import {
  articled,
  capitalize,
  np,
  politicalNamePhrase,
  renderTemplate,
  type NounPhrase,
  type Preposition,
  type TemplateParams,
} from "./italian";

export interface PhraseOptions {
  preposition?: Preposition | null;
  capitalized?: boolean;
}

function finish(text: string, options: PhraseOptions): string {
  return options.capitalized ? capitalize(text) : text;
}

type PeopleLike = Pick<Tribe, "name" | "identityType" | "identityId">;

/** The people as a noun phrase (see the rules above). */
export function peoplePhrase(tribe: PeopleLike): NounPhrase {
  if (
    tribe.identityType === "historical" ||
    tribe.identityType === "composite" ||
    getIdentity(tribe.identityId)
  )
    return np(tribe.name, "m", "pl");
  return np(`tribù ${tribe.name}`, "f", "sg");
}

/** Display name of a people or a state, without article: "Egizi", "Regno di Naru", "Kanar". */
export function formatCivilizationName(entity: PeopleLike | Pick<Civilization, "name">): string {
  return entity.name;
}

/** The people as the subject or object of a sentence: "gli Egizi", "Dalla tribù Kanar". */
export function formatCivilizationSubject(tribe: PeopleLike, options: PhraseOptions = {}): string {
  return finish(articled(peoplePhrase(tribe), options.preposition), options);
}

/** A state with its article: "il Regno di Naru", "della Lega Romana". */
export function formatPoliticalEntityName(
  entity: Pick<Civilization, "name">,
  options: PhraseOptions = {},
): string {
  return finish(articled(politicalNamePhrase(entity.name), options.preposition), options);
}

export function statePhrase(entity: Pick<Civilization, "name">): NounPhrase {
  return politicalNamePhrase(entity.name);
}

/**
 * Who acts in diplomacy and war: the state when the people has formed one ("il Regno di Naru
 * ha dichiarato guerra alla Lega Romana"), otherwise the people itself.
 */
export function polityPhrase(
  tribe: PeopleLike & Pick<Tribe, "civilizationId">,
  civilizations: readonly Pick<Civilization, "id" | "name" | "status">[],
): NounPhrase {
  const civ = tribe.civilizationId
    ? civilizations.find((c) => c.id === tribe.civilizationId && c.status === "active")
    : undefined;
  return civ ? statePhrase(civ) : peoplePhrase(tribe);
}

const DESCRIPTIVE_TITLE = / (del|della|dello|dei|degli|delle)\b/;

/**
 * "re Menka", "console Iria", "Menka, guida del clan": the title comes from the government
 * the simulation produced; the identity only chooses the shape of the phrase.
 */
export function formatLeaderTitle(
  leader: { name: string; sex: Sex | null },
  government: GovernmentType,
  identity?: HistoricalIdentityDefinition | null,
): string {
  const title = politicalTitle(government, leader.sex);
  const patterns = identity?.language.leaderTitlePatterns ?? DEFAULT_LEADER_TITLE_PATTERNS;
  const pattern = DESCRIPTIVE_TITLE.test(title) ? (patterns[1] ?? patterns[0]) : patterns[0];
  return (pattern ?? "{title} {name}").replace("{title}", title).replace("{name}", leader.name);
}

/**
 * The leader as a noun phrase when the title is a short noun ("il re Menka", "la regina Iria");
 * descriptive titles become an apposition that needs no article ("Menka, guida del clan,").
 */
export function leaderPhrase(
  leader: { name: string; sex: Sex | null },
  government: GovernmentType,
  identity?: HistoricalIdentityDefinition | null,
): NounPhrase | string {
  const text = formatLeaderTitle(leader, government, identity);
  if (text.startsWith(`${leader.name},`)) return text;
  return np(text, leader.sex === "F" ? "f" : "m", "sg");
}

const TIER_GENDER: Record<SettlementTier, "m" | "f"> = {
  camp: "m",
  village: "m",
  town: "f",
  city_state: "f",
  capital: "f",
};

/** "il villaggio di Naru", "la città di Naru", "l'accampamento di Naru". */
export function settlementPhrase(settlement: Pick<Settlement, "name" | "tier">): NounPhrase {
  return np(
    `${SETTLEMENT_TIER_LABELS[settlement.tier]} di ${settlement.name}`,
    TIER_GENDER[settlement.tier],
    "sg",
  );
}

export function formatSettlement(
  settlement: Pick<Settlement, "name" | "tier">,
  options: PhraseOptions = {},
): string {
  return finish(articled(settlementPhrase(settlement), options.preposition), options);
}

/**
 * Renders an event text from a controlled template (see `renderTemplate`): every people,
 * state or leader is passed as a noun phrase, so articles, prepositions and verbs agree.
 *
 *   formatEventDescription("{Art:people} {v:people:ha fondato|hanno fondato} {art:place}.", {
 *     people: peoplePhrase(tribe), place: settlementPhrase(s) })
 */
export function formatEventDescription(template: string, params: TemplateParams): string {
  return renderTemplate(template, params);
}
