import type { SimContext } from "./context";
import { nextId } from "./context";
import { tryCellAt } from "./grid";
import type {
  Civilization,
  EventActor,
  EventType,
  HistoricalEvent,
  JsonValue,
  Person,
  Settlement,
  Tribe,
  WorldState,
} from "./types";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  agreement: "Accordi",
  belief: "Credenze",
  birth: "Nascita",
  notable_death: "Morte illustre",
  famine: "Carestia",
  migration: "Migrazione",
  settlement_founded: "Fondazione",
  construction: "Costruzione",
  tech_discovered: "Scoperta",
  trade: "Commercio",
  conflict: "Conflitto",
  battle: "Battaglia",
  peace: "Pace",
  settlement_collapse: "Collasso",
  population_growth: "Crescita",
  civilization_founded: "Nuova civiltà",
  alliance: "Alleanza",
  tribe_extinct: "Estinzione",
  conquest: "Conquista",
  climate: "Clima",
  epidemic: "Epidemia",
  leadership: "Guida",
  unrest: "Tensioni interne",
  culture: "Cultura",
  settlement_growth: "Crescita urbana",
  civilization_transformed: "Trasformazione politica",
  vassalage: "Vassallaggio",
  occupation: "Occupazione",
  fusion: "Fusione di popoli",
};

export const IMPORTANCE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "micro-evento",
  2: "evento locale",
  3: "evento importante",
  4: "evento regionale",
  5: "svolta storica",
};

export const actor = {
  tribe: (t: Tribe): EventActor => ({ kind: "tribe", id: t.id, name: t.name }),
  settlement: (s: Settlement): EventActor => ({ kind: "settlement", id: s.id, name: s.name }),
  civilization: (c: Civilization): EventActor => ({ kind: "civilization", id: c.id, name: c.name }),
  person: (p: Person): EventActor => ({ kind: "person", id: p.id, name: p.name }),
  dynasty: (d: { id: string; name: string }): EventActor => ({ kind: "dynasty", id: d.id, name: d.name }),
};

export interface EventInput {
  type: EventType;
  /** Discriminator inside the type; drives the deduplication key and the UI filters. */
  subtype?: string | null;
  importance: HistoricalEvent["importance"];
  actors: EventActor[];
  x: number | null;
  y: number | null;
  title: string;
  description: string;
  metadata?: Record<string, JsonValue>;
  /** Events that directly caused this one. */
  causeEventIds?: string[];
}

/**
 * Emits a historical event.
 *
 * Two guards keep the chronicle readable: events below the configured importance are
 * dropped, and an identical (type, subtype, actors) event already emitted in the same year
 * is merged instead of repeated.
 */
export function emitEvent(ctx: SimContext, rawInput: EventInput): HistoricalEvent {
  const input = withItalianArticles(rawInput);
  const subtype = input.subtype ?? null;
  if (input.importance < ctx.state.config.observability.minEventImportance) {
    // Below the configured threshold the event is not part of the chronicle at all: it gets
    // no id, so nothing can end up referencing an event that was never stored.
    return suppressedEvent(ctx, input, subtype);
  }
  const key = `${ctx.state.year}|${input.type}|${subtype ?? ""}|${input.actors.map((a) => a.id).join(",")}`;
  const existing = ctx.emitted.get(key);
  if (existing) {
    // Same story, same year, same actors: keep the most important version.
    if (input.importance > existing.importance) {
      existing.importance = input.importance;
      existing.title = input.title;
      existing.description = `Anno ${formatYear(ctx.state.year)} — ${input.description}`;
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
    }
    existing.metadata.occurrences = Number(existing.metadata.occurrences ?? 1) + 1;
    return existing;
  }
  const { id, seq } = nextId(ctx.state, "event", "e");
  const event: HistoricalEvent = {
    id,
    seq,
    tick: ctx.state.tick,
    year: ctx.state.year,
    type: input.type,
    subtype,
    importance: input.importance,
    actors: input.actors,
    x: input.x,
    y: input.y,
    title: input.title,
    description: `Anno ${formatYear(ctx.state.year)} — ${input.description}`,
    metadata: input.metadata ?? {},
    // A cause that was itself suppressed carries no id: it must not leave a dangling reference.
    causeEventIds: (input.causeEventIds ?? []).filter((id) => id.length > 0),
  };
  ctx.events.push(event);
  ctx.emitted.set(key, event);
  return event;
}

/** Placeholder returned for events below the importance threshold: empty id, never stored. */
function suppressedEvent(ctx: SimContext, input: EventInput, subtype: string | null): HistoricalEvent {
  return {
    id: "",
    seq: 0,
    tick: ctx.state.tick,
    year: ctx.state.year,
    type: input.type,
    subtype,
    importance: input.importance,
    actors: input.actors,
    x: input.x,
    y: input.y,
    title: input.title,
    description: input.description,
    metadata: input.metadata ?? {},
    causeEventIds: [],
  };
}

export function formatYear(year: number): string {
  const abs = Math.abs(year).toLocaleString("it-IT");
  return year < 0 ? `-${abs}` : abs;
}

function direction(state: WorldState, x: number, y: number): string {
  const cx = (state.width - 1) / 2;
  const cy = (state.height - 1) / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) < state.width / 6 && Math.abs(dy) < state.height / 6) return "centrali";
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "dell'est" : "dell'ovest";
  return dy > 0 ? "del sud" : "del nord";
}

const BIOME_PHRASE: Record<string, string> = {
  coast: "le coste",
  plains: "le pianure",
  forest: "le foreste",
  hills: "le colline",
  mountain: "i monti",
  desert: "le terre aride",
  tundra: "le distese gelide",
  ocean: "le acque",
};

/** Human-readable geographic reference used by the event templates. */
export function describePlace(state: WorldState, x: number, y: number): string {
  for (let r = 0; r <= 1; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = tryCellAt(state, x + dx, y + dy);
        if (c?.river && c.riverName) return `la valle del fiume ${c.riverName}`;
      }
    }
  }
  const cell = tryCellAt(state, x, y);
  const phrase = cell ? (BIOME_PHRASE[cell.biome] ?? "le terre") : "le terre";
  return `${phrase} ${direction(state, x, y)}`;
}

export function pluralPeople(n: number): string {
  return n === 1 ? "1 persona" : `${n} persone`;
}

/** Plural articles and articulated prepositions, with their form before vowels and s+consonant. */
const ARTICLES: Record<string, string> = {
  i: "gli",
  dei: "degli",
  ai: "agli",
  nei: "negli",
  sui: "sugli",
  dai: "dagli",
  coi: "con gli",
};

/** Italian plurals take "gli" before a vowel, s+consonant, z, gn, ps, x, y ("gli Egizi", "degli Inca"). */
function needsGli(name: string): boolean {
  return /^([aeiouàèéìòù]|s[^aeiouàèéìòù]|z|gn|ps|x|y)/i.test(name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Event templates were written for invented names ("i Kaname"); real peoples need the right
 * article ("gli Egizi", "degli Assiri"). Only tribe names are touched, and only where needed.
 */
export function fixArticles(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names) {
    if (!needsGli(name)) continue;
    const pattern = new RegExp(
      `\\b(I|i|[Dd]ei|[Aa]i|[Nn]ei|[Ss]ui|[Dd]ai|[Cc]oi) (${escapeRegExp(name)})`,
      "g",
    );
    out = out.replace(pattern, (_match, article: string, found: string) => {
      const replacement = ARTICLES[article.toLowerCase()] ?? article;
      const cased =
        article[0] === article[0]?.toUpperCase()
          ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
          : replacement;
      return `${cased} ${found}`;
    });
  }
  return out;
}

function withItalianArticles(input: EventInput): EventInput {
  const names = input.actors.filter((a) => a.kind === "tribe").map((a) => a.name);
  if (!names.some(needsGli)) return input;
  return {
    ...input,
    title: fixArticles(input.title, names),
    description: fixArticles(input.description, names),
  };
}
