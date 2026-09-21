import type { HistoricalEvent, Tribe } from "./types";

/**
 * Causal anchors: the last event of a few kinds that shaped a people, kept so that what comes
 * later can name it as a cause.
 *
 * Why this exists: a peace is signed years after the war it ends, often in a later batch whose
 * events are no longer in memory, so the peace used to be recorded with no cause at all. Only 9%
 * of the important chronicle carried its causes when this was measured.
 *
 * Deliberately small: a handful of keys per people (`war:<other>`, `famine`, `collapse`,
 * `leader_death`, `revolt`), each with one event id and its year, pruned by age. It is a pointer
 * into the chronicle, not a second chronicle.
 */

export interface CausalAnchor {
  eventId: string;
  year: number;
}

/** Oldest anchor worth citing at all. */
export const ANCHOR_MAX_AGE = 150;
/** Above this many keys a people's anchors are pruned by age. */
export const MAX_ANCHORS = 24;

/** Remembers `event` under `key`. Suppressed events carry no id and are not remembered. */
export function anchor(tribe: Tribe, key: string, event: Pick<HistoricalEvent, "id" | "year">) {
  if (!event.id) return;
  tribe.causalAnchors ??= {};
  tribe.causalAnchors[key] = { eventId: event.id, year: event.year };
  const keys = Object.keys(tribe.causalAnchors);
  if (keys.length <= MAX_ANCHORS) return;
  // Oldest first; ties broken by key so the result never depends on insertion order.
  keys.sort((a, b) => {
    const x = tribe.causalAnchors[a]!;
    const y = tribe.causalAnchors[b]!;
    return x.year - y.year || (a < b ? -1 : a > b ? 1 : 0);
  });
  for (const stale of keys.slice(0, keys.length - MAX_ANCHORS)) delete tribe.causalAnchors[stale];
}

/** The event remembered under `key`, if it is recent enough to be a plausible cause. */
export function anchored(tribe: Tribe, key: string, year: number, maxAge = ANCHOR_MAX_AGE): string | null {
  const found = tribe.causalAnchors?.[key];
  if (!found) return null;
  return year - found.year <= maxAge ? found.eventId : null;
}

export function releaseAnchor(tribe: Tribe, key: string) {
  if (tribe.causalAnchors) delete tribe.causalAnchors[key];
}

/**
 * Causes for a new event, from the given anchors of one or more peoples, in the order asked,
 * without duplicates. Each entry is `[tribe, key, maxAge]`.
 */
export function causesFrom(
  year: number,
  entries: readonly (readonly [Tribe | undefined, string, number?])[],
): string[] {
  const out: string[] = [];
  for (const [tribe, key, maxAge] of entries) {
    if (!tribe) continue;
    const id = anchored(tribe, key, year, maxAge);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export const warKey = (otherId: string) => `war:${otherId}`;
