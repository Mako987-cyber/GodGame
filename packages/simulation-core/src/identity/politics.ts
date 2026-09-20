import { POLITICAL_FORM_GENDER, capitalize } from "../language/italian";
import type { GovernmentType, Sex } from "../types";
import type { HistoricalIdentityDefinition } from "./definition";

/**
 * Titles and political names derive from the government the simulation actually produced,
 * never from the fame of an identity: Egizi ruled by a council get a council, not a pharaoh.
 */

const TITLES: Record<GovernmentType, { M: string; F: string }> = {
  clan: { M: "guida del clan", F: "guida del clan" },
  elder_council: { M: "primo anziano", F: "prima anziana" },
  chiefdom: { M: "signore della valle", F: "signora della valle" },
  tribal_monarchy: { M: "re", F: "regina" },
  city_state: { M: "custode della città", F: "custode della città" },
  merchant_republic: { M: "console", F: "console" },
};

export function politicalTitle(government: GovernmentType, sex: Sex | null): string {
  const titles = TITLES[government] ?? TITLES.clan;
  return sex === "F" ? titles.F : titles.M;
}

const POLITY_FORMS: Record<GovernmentType, string> = {
  clan: "Confederazione",
  elder_council: "Lega",
  chiefdom: "Dominio",
  tribal_monarchy: "Regno",
  city_state: "Città-stato",
  merchant_republic: "Repubblica",
};

export function polityForm(government: GovernmentType): string {
  return POLITY_FORMS[government] ?? POLITY_FORMS.clan;
}

/**
 * Political name of a state formed by a people with a historical identity: the form follows
 * the government, the stem is a place generated in this world ("Regno di Naru").
 */
export function politicalName(government: GovernmentType, stem: string): string {
  return `${polityForm(government)} di ${stem}`;
}

/** The legacy shape, and the fallback of every pattern: "Regno di Naru". */
export const CAPITAL_PATTERN = "{form} di {capital}";

/**
 * Renders a political name pattern of an identity for the government the simulation produced:
 * `{form}` → "Regno"/"Lega"…, `{capital}` → a place generated in this world, `{adjective}` →
 * the people's adjective agreeing with the form ("Regno Egizio", "Lega Egizia").
 */
export function renderPoliticalName(
  pattern: string,
  government: GovernmentType,
  context: { capital: string; identity?: HistoricalIdentityDefinition | null },
): string {
  const form = polityForm(government);
  const feminine = POLITICAL_FORM_GENDER[form] === "f";
  const language = context.identity?.language;
  const shape = pattern.includes("{adjective}") && !language ? CAPITAL_PATTERN : pattern;
  const raw = language ? (feminine ? language.adjectiveFeminine : language.adjective) : "";
  const adjective = raw
    .split("-")
    .map((part) => capitalize(part))
    .join("-");
  return shape
    .replace("{form}", form)
    .replace("{capital}", context.capital)
    .replace("{adjective}", adjective);
}
