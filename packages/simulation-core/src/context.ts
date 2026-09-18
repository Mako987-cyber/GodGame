import type { Rng } from "./prng";
import type { Cell, HistoricalEvent, Person, Settlement, Stockpile, Tribe, WorldState } from "./types";

/** A group that produces and consumes together: a nomadic band or a settlement. */
export interface Community {
  key: string;
  kind: "band" | "settlement";
  tribe: Tribe;
  settlement: Settlement | null;
  x: number;
  y: number;
  radius: number;
  /** Land cells within `radius`, computed once per tick. */
  area: Cell[];
  members: Person[];
  stock: Stockpile;
  /** Food ratio of the last consumption step (eaten / needed). */
  foodRatio: number;
  threat: number;
}

export interface TickCounters {
  births: number;
  deaths: number;
  starvationDeaths: number;
  conflictDeaths: number;
  battles: number;
  foodProduced: number;
  foodConsumed: number;
}

export interface SimContext {
  state: WorldState;
  rng: Rng;
  events: HistoricalEvent[];
  counters: TickCounters;
  tribes: Map<string, Tribe>;
  settlements: Map<string, Settlement>;
  people: Map<string, Person>;
  communities: Community[];
}

export function emptyCounters(): TickCounters {
  return {
    births: 0,
    deaths: 0,
    starvationDeaths: 0,
    conflictDeaths: 0,
    battles: 0,
    foodProduced: 0,
    foodConsumed: 0,
  };
}

export function nextId(
  state: WorldState,
  kind: keyof WorldState["counters"],
  prefix: string,
): { id: string; seq: number } {
  state.counters[kind] += 1;
  const seq = state.counters[kind];
  return { id: `${prefix}${seq}`, seq };
}

export function buildIndexes(ctx: Pick<SimContext, "state" | "tribes" | "settlements" | "people">) {
  ctx.tribes.clear();
  ctx.settlements.clear();
  ctx.people.clear();
  for (const t of ctx.state.tribes) ctx.tribes.set(t.id, t);
  for (const s of ctx.state.settlements) ctx.settlements.set(s.id, s);
  for (const p of ctx.state.people) ctx.people.set(p.id, p);
}

export function livingMembers(state: WorldState, tribeId: string): Person[] {
  return state.people.filter((p) => p.alive && p.tribeId === tribeId);
}

export function emptyStock(): Stockpile {
  return { food: 0, wood: 0, stone: 0, copper: 0 };
}
