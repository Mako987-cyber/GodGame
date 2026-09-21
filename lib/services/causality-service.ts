import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { getWorldRow } from "@/lib/db/queries";
import type { EventDTO } from "@/lib/dto";
import { notFound } from "@/lib/utils/errors";
import { toEventDTO } from "./world-service";

/**
 * Why something happened, and what it led to.
 *
 * Every event already carries `causeEventIds`. The timeline used to resolve them only against
 * the page it was showing, so a cause fifty years earlier — on another page — simply vanished.
 * This walks the chain in the database instead: backwards through causes, level by level, and
 * one step forwards to the events that name this one as their cause.
 *
 * Bounded on purpose: `MAX_DEPTH` levels back and `MAX_NODES` events in total, with one query
 * per level (never one per event).
 */

export const MAX_DEPTH = 4;
export const MAX_NODES = 40;
export const MAX_CONSEQUENCES = 20;

export interface CausalNode {
  event: EventDTO;
  /** 1 = direct cause, 2 = cause of a cause, and so on. */
  depth: number;
}

export interface CausalityDTO {
  worldId: string;
  event: EventDTO;
  /** Causes, nearest first. */
  causes: CausalNode[];
  /** Events that name this one as a direct cause, oldest first. */
  consequences: EventDTO[];
  /** True when the chain was cut by `MAX_DEPTH` or `MAX_NODES`. */
  truncated: boolean;
}

export async function getEventCausalityService(
  worldId: string,
  eventId: string,
  deps?: { db: Database },
): Promise<CausalityDTO> {
  const db = deps?.db ?? (await getDb());
  const world = await getWorldRow(db, worldId);
  if (!world) throw notFound("Mondo");
  const [root] = await db
    .select()
    .from(s.historicalEvents)
    .where(and(eq(s.historicalEvents.worldId, worldId), eq(s.historicalEvents.id, eventId)))
    .limit(1);
  if (!root) throw notFound("Evento");

  const seen = new Set<string>([root.id]);
  const causes: CausalNode[] = [];
  let frontier = (root.causeEventIds ?? []).filter((id) => !seen.has(id));
  let truncated = false;
  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const room = MAX_NODES - causes.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    const wanted = frontier.slice(0, room);
    if (wanted.length < frontier.length) truncated = true;
    for (const id of wanted) seen.add(id);
    // One query per level, however many causes the level has.
    const rows = await db
      .select()
      .from(s.historicalEvents)
      .where(and(eq(s.historicalEvents.worldId, worldId), inArray(s.historicalEvents.id, wanted)));
    rows.sort((a, b) => b.seq - a.seq);
    for (const row of rows) causes.push({ event: toEventDTO(row), depth });
    frontier = rows.flatMap((r) => r.causeEventIds ?? []).filter((id) => !seen.has(id));
    if (depth === MAX_DEPTH && frontier.length > 0) truncated = true;
  }

  // Forward: events whose cause list contains this one. JSONB containment on the world's events.
  const consequences = await db
    .select()
    .from(s.historicalEvents)
    .where(
      and(
        eq(s.historicalEvents.worldId, worldId),
        sql`${s.historicalEvents.causeEventIds} @> ${JSON.stringify([eventId])}::jsonb`,
      ),
    )
    .orderBy(s.historicalEvents.seq)
    .limit(MAX_CONSEQUENCES);

  return {
    worldId,
    event: toEventDTO(root),
    causes,
    consequences: consequences.map(toEventDTO),
    truncated,
  };
}
