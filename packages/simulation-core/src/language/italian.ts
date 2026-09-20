/**
 * Minimal Italian grammar for generated text: definite articles, articulated prepositions,
 * verb and adjective agreement, and a controlled template renderer.
 *
 * Every sentence the engine writes about a people, a state or a leader goes through a
 * `NounPhrase` (text + gender + number), so it reads "gli Egizi hanno fondato", "dagli Inca",
 * "il Regno di Naru ha dichiarato", "la tribù Kanar è nata" — never "la tribù Egizi" or
 * "dai Egizi". Pure functions, no randomness.
 */

export type Gender = "m" | "f";
export type GrammaticalNumber = "sg" | "pl";

export interface NounPhrase {
  /** The words after the article: "Egizi del Nord", "Regno di Naru", "tribù Kanar". */
  text: string;
  gender: Gender;
  number: GrammaticalNumber;
}

export const np = (text: string, gender: Gender, number: GrammaticalNumber): NounPhrase => ({
  text,
  gender,
  number,
});

type Article = "il" | "lo" | "l'" | "i" | "gli" | "la" | "le";

/** Words starting with a vowel sound (h is silent in the loanwords and names we generate). */
const VOWEL_START = /^[aeiouàáèéìíòóùúh]/i;
/** "Semivowel" i + vowel takes lo/gli: "lo iato", "gli Iapigi". */
const I_SEMIVOWEL = /^i[aeiouàèéòù]/i;
/** Masculine words taking lo/gli: s + consonant, z, gn, ps, pn, x, y, semivowel i. */
const LO_START = /^(s[^aeiouàèéìòù]|z|gn|ps|pn|x|y|j)/i;

export function definiteArticle(word: string, gender: Gender, number: GrammaticalNumber): Article {
  const w = word.trim();
  if (gender === "m") {
    if (number === "sg") {
      if (I_SEMIVOWEL.test(w) || LO_START.test(w)) return "lo";
      return VOWEL_START.test(w) ? "l'" : "il";
    }
    return VOWEL_START.test(w) || LO_START.test(w) ? "gli" : "i";
  }
  if (number === "sg") return VOWEL_START.test(w) && !I_SEMIVOWEL.test(w) ? "l'" : "la";
  return "le";
}

const CONTRACTED: Record<"di" | "a" | "da" | "in" | "su", Record<Article, string>> = {
  di: { il: "del", lo: "dello", "l'": "dell'", i: "dei", gli: "degli", la: "della", le: "delle" },
  a: { il: "al", lo: "allo", "l'": "all'", i: "ai", gli: "agli", la: "alla", le: "alle" },
  da: { il: "dal", lo: "dallo", "l'": "dall'", i: "dai", gli: "dagli", la: "dalla", le: "dalle" },
  in: { il: "nel", lo: "nello", "l'": "nell'", i: "nei", gli: "negli", la: "nella", le: "nelle" },
  su: { il: "sul", lo: "sullo", "l'": "sull'", i: "sui", gli: "sugli", la: "sulla", le: "sulle" },
};

export type Preposition = keyof typeof CONTRACTED | "con" | "per" | "tra" | "fra";

const join = (head: string, text: string) => (head.endsWith("'") ? `${head}${text}` : `${head} ${text}`);

/** "gli Egizi", "degli Egizi", "con i Romani", "l'Impero", "dell'Impero". */
export function articled(phrase: NounPhrase, preposition?: Preposition | null): string {
  const article = definiteArticle(phrase.text, phrase.gender, phrase.number);
  if (!preposition) return join(article, phrase.text);
  if (preposition in CONTRACTED)
    return join(CONTRACTED[preposition as keyof typeof CONTRACTED][article], phrase.text);
  return join(`${preposition} ${article}`, phrase.text);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Picks the verb (or any word) agreeing in number: `verb(p, "ha fondato", "hanno fondato")`. */
export function verb(phrase: NounPhrase, singular: string, plural: string): string {
  return phrase.number === "sg" ? singular : plural;
}

/** Adjective/participle agreeing in gender and number: `agree(p, "nato", "nata", "nati", "nate")`. */
export function agree(phrase: NounPhrase, ms: string, fs: string, mp: string, fp: string): string {
  if (phrase.gender === "m") return phrase.number === "sg" ? ms : mp;
  return phrase.number === "sg" ? fs : fp;
}

/** Nouns of political forms and their gender, used to article a state's name. */
export const POLITICAL_FORM_GENDER: Readonly<Record<string, Gender>> = {
  Regno: "m",
  Impero: "m",
  Dominio: "m",
  Principato: "m",
  Casato: "m",
  Sultanato: "m",
  Confederazione: "f",
  Lega: "f",
  "Città-stato": "f",
  Repubblica: "f",
  Signoria: "f",
  Federazione: "f",
  Unione: "f",
  Civiltà: "f",
};

/**
 * Noun phrase of a state from its name: the first word decides the gender ("la Lega Romana",
 * "il Regno di Naru"). Unknown shapes are read as a masculine singular proper name.
 */
export function politicalNamePhrase(name: string): NounPhrase {
  const first = name.split(" ")[0] ?? name;
  return np(name, POLITICAL_FORM_GENDER[first] ?? "m", "sg");
}

export type TemplateValue = string | number | NounPhrase;
export type TemplateParams = Record<string, TemplateValue>;

const TOKEN = /\{([A-Za-z]+)(?::([A-Za-z]+))?(?::([^}|]*)\|([^}]*))?\}/g;
const PREPOSITIONS = new Set(["di", "a", "da", "in", "su", "con", "per", "tra", "fra"]);

function isPhrase(value: TemplateValue | undefined): value is NounPhrase {
  return typeof value === "object" && value !== null && "text" in value;
}

/**
 * Controlled templates. Tokens:
 * - `{name}` — the value as is (a noun phrase without article);
 * - `{art:name}` / `{Art:name}` — with its article ("gli Egizi" / "Gli Egizi");
 * - `{di:name}`, `{a:name}`, `{da:name}`, `{in:name}`, `{su:name}`, `{con:name}`… — with the
 *   (articulated) preposition; capitalised prepositions (`{Da:name}`) capitalise the result;
 * - `{v:name:singolare|plurale}` — the form agreeing with `name`'s number.
 * An unknown parameter throws: a typo in a template is a bug, not a silent "{name}".
 */
export function renderTemplate(template: string, params: TemplateParams): string {
  return template.replace(TOKEN, (_match, a: string, b: string | undefined, sg?: string, pl?: string) => {
    if (a === "v" && b !== undefined && sg !== undefined && pl !== undefined) {
      const value = params[b];
      if (!isPhrase(value)) throw new Error(`template: «${b}» non è un sintagma nominale`);
      return verb(value, sg, pl);
    }
    if (b === undefined) {
      const value = params[a];
      if (value === undefined) throw new Error(`template: parametro «${a}» mancante`);
      return isPhrase(value) ? value.text : String(value);
    }
    const value = params[b];
    if (value === undefined) throw new Error(`template: parametro «${b}» mancante`);
    const upper = a.charAt(0) === a.charAt(0).toUpperCase();
    const key = a.toLowerCase();
    if (!isPhrase(value)) return String(value);
    let out: string;
    if (key === "art") out = articled(value);
    else if (PREPOSITIONS.has(key)) out = articled(value, key as Preposition);
    else throw new Error(`template: modificatore «${a}» sconosciuto`);
    return upper ? capitalize(out) : out;
  });
}
