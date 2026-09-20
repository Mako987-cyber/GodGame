/**
 * Strategic notifications: the few events worth interrupting the player for, grouped in
 * categories, deduplicated and linked to the entity (and map cell) they concern.
 */
import type { EventDTO } from "@/lib/dto";
import type { Selection } from "./store";

export type NotificationCategory =
  "founding" | "discovery" | "famine" | "war" | "peace" | "leader" | "unrest" | "epidemic" | "collapse";

export const NOTIFICATION_LABELS: Record<NotificationCategory, string> = {
  founding: "Fondazioni",
  discovery: "Scoperte",
  famine: "Carestie",
  war: "Guerre",
  peace: "Pace",
  leader: "Guide",
  unrest: "Rivolte",
  epidemic: "Epidemie",
  collapse: "Collassi",
};

/** Event type → category. Types missing here (births, trade, growth…) never notify. */
const CATEGORY_BY_TYPE: Record<string, NotificationCategory> = {
  settlement_founded: "founding",
  civilization_founded: "founding",
  civilization_transformed: "founding",
  tech_discovered: "discovery",
  famine: "famine",
  conflict: "war",
  battle: "war",
  conquest: "war",
  occupation: "war",
  vassalage: "peace",
  fusion: "founding",
  peace: "peace",
  alliance: "peace",
  notable_death: "leader",
  leadership: "leader",
  unrest: "unrest",
  epidemic: "epidemic",
  settlement_collapse: "collapse",
  tribe_extinct: "collapse",
};

/** Minimum importance per category: battles and leader changes only when they matter. */
const MIN_IMPORTANCE: Partial<Record<NotificationCategory, number>> = {
  war: 3,
  leader: 3,
  discovery: 2,
  founding: 2,
};

export interface GameNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  year: number;
  tick: number;
  importance: number;
  /** Where the event happened, if it has a place. */
  cell: { x: number; y: number } | null;
  /** Entity to select when the notification is clicked. */
  target: Selection | null;
  /** Identical notifications merged into this one. */
  count: number;
}

export function categoryOf(e: Pick<EventDTO, "type" | "importance">): NotificationCategory | null {
  const category = CATEGORY_BY_TYPE[e.type];
  if (!category) return null;
  if (e.importance < (MIN_IMPORTANCE[category] ?? 2)) return null;
  return category;
}

function targetOf(e: EventDTO): Selection | null {
  const kinds = new Map(e.actors.map((a) => [a.kind, a.id]));
  if (
    e.type === "conflict" ||
    e.type === "battle" ||
    e.type === "peace" ||
    e.type === "conquest" ||
    e.type === "vassalage"
  ) {
    const tribes = e.actors.filter((a) => a.kind === "tribe").map((a) => a.id);
    if (tribes.length >= 2 && tribes[0] && tribes[1]) return { kind: "war", aId: tribes[0], bId: tribes[1] };
  }
  const settlement = kinds.get("settlement");
  if (settlement) return { kind: "settlement", id: settlement };
  const civ = kinds.get("civilization");
  if (civ) return { kind: "civilization", id: civ };
  const person = kinds.get("person");
  if (person && (e.type === "notable_death" || e.type === "leadership"))
    return { kind: "person", id: person };
  const tribe = kinds.get("tribe");
  if (tribe) return { kind: "tribe", id: tribe };
  if (e.x !== null && e.y !== null) return { kind: "cell", x: e.x, y: e.y };
  return null;
}

/**
 * Notifications from events (any order), newest first. Events are deduplicated by id, and events
 * of the same category with the same title in the same year collapse into one with a count.
 */
export function buildNotifications(events: readonly EventDTO[], limit = 40): GameNotification[] {
  const seen = new Set<string>();
  const merged = new Map<string, GameNotification>();
  const sorted = [...events].sort(
    (a, b) => b.tick - a.tick || b.importance - a.importance || a.id.localeCompare(b.id),
  );
  for (const e of sorted) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const category = categoryOf(e);
    if (!category) continue;
    const key = `${category}|${e.year}|${e.title}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    merged.set(key, {
      id: e.id,
      category,
      title: e.title,
      description: e.description,
      year: e.year,
      tick: e.tick,
      importance: e.importance,
      cell: e.x !== null && e.y !== null ? { x: e.x, y: e.y } : null,
      target: targetOf(e),
      count: 1,
    });
  }
  return [...merged.values()].slice(0, limit);
}

export function filterNotifications(
  items: readonly GameNotification[],
  hidden: ReadonlySet<NotificationCategory>,
): GameNotification[] {
  return items.filter((n) => !hidden.has(n.category));
}

/** Notifications newer than the last tick the player has seen. */
export function unreadCount(items: readonly GameNotification[], seenTick: number): number {
  return items.filter((n) => n.tick > seenTick).length;
}
