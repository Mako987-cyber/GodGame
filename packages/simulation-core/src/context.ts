import type { Rng } from "./prng";
import { emptyStock, type Stockpile } from "./stock";
import type { Cell, HistoricalEvent, Person, Settlement, Tribe, WorldState } from "./types";

export { emptyStock };

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
  epidemicDeaths: number;
  battles: number;
  foodProduced: number;
  foodConsumed: number;
  goodsProduced: number;
  tradeVolume: number;
  migrations: number;
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
  /** Deduplication index of the events emitted during the current tick. */
  emitted: Map<string, HistoricalEvent>;
  /**
   * Per-phase timing, only when a caller asked for it (`RunOptions.profile`). Absent in normal
   * runs, so measuring costs nothing unless it is wanted — and it never touches the simulation.
   */
  profile?: { now: () => number; last: number; phases: Record<string, number> };
}

/** Closes the current phase of the tick under `name`. A no-op unless profiling is on. */
export function mark(ctx: SimContext, name: string) {
  const profile = ctx.profile;
  if (!profile) return;
  const at = profile.now();
  profile.phases[name] = (profile.phases[name] ?? 0) + (at - profile.last);
  profile.last = at;
}

export function emptyCounters(): TickCounters {
  return {
    births: 0,
    deaths: 0,
    starvationDeaths: 0,
    conflictDeaths: 0,
    epidemicDeaths: 0,
    battles: 0,
    foodProduced: 0,
    foodConsumed: 0,
    goodsProduced: 0,
    tradeVolume: 0,
    migrations: 0,
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
