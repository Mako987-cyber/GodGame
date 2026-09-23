import { hashWorld, serializeWorld, deserializeState, STATE_VERSION } from "./serialization";
import { runSimulation } from "./simulation-engine";
import type { HistoricalEvent, WorldState } from "./types";

/**
 * Replay: re-running history from a snapshot and checking that it comes out the same.
 *
 * The engine is deterministic and carries its PRNG inside the state, so a snapshot taken at tick
 * N and re-run for M ticks must reproduce, event by event, what the original run produced between
 * N and N+M. That is what makes the chronicle trustworthy: the events are not decoration over a
 * lost computation, they can be derived again from the state that produced them.
 *
 * This is verification, not a second engine: nothing here simulates anything of its own.
 */

export interface ReplayDivergence {
  /** Where the two runs stopped agreeing, in the replayed sequence. */
  index: number;
  tick: number;
  original: string;
  replayed: string;
}

export interface ReplayResult {
  fromTick: number;
  ticks: number;
  /** True when state and chronicle came out identical. */
  identical: boolean;
  originalHash: string;
  replayedHash: string;
  originalEvents: number;
  replayedEvents: number;
  /** The first event that differed, if any. */
  divergence: ReplayDivergence | null;
}

/** One event as a comparable line: what it is, when, to whom, and what it says. */
export function eventSignature(event: HistoricalEvent): string {
  return [
    event.tick,
    event.type,
    event.subtype ?? "",
    event.actors.map((a) => a.id).join("+"),
    event.title,
  ].join("|");
}

/**
 * Re-runs `ticks` years from a snapshot and compares the result with the original run.
 *
 * `snapshot` is the serialized state as `world_snapshots` stores it; `original` is the world as
 * it was after those years, and `originalEvents` the chronicle it produced in them.
 */
export function replayFromSnapshot(
  snapshot: string,
  ticks: number,
  original: { state: WorldState; events: readonly HistoricalEvent[] },
): ReplayResult {
  const parsed = JSON.parse(snapshot) as { version?: number; state: unknown };
  const restored = deserializeState({
    version: parsed.version ?? STATE_VERSION,
    state: (parsed.state ?? parsed) as WorldState,
  } as never);
  const fromTick = restored.tick;
  const result = runSimulation(restored, ticks);

  const originalHash = hashWorld(original.state);
  const replayedHash = hashWorld(restored);
  const before = original.events.filter((e) => e.tick > fromTick).map(eventSignature);
  const after = result.events.map(eventSignature);

  let divergence: ReplayDivergence | null = null;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] === after[i]) continue;
    divergence = {
      index: i,
      tick: result.events[i]?.tick ?? fromTick + ticks,
      original: before[i] ?? "(niente)",
      replayed: after[i] ?? "(niente)",
    };
    break;
  }
  return {
    fromTick,
    ticks,
    identical: originalHash === replayedHash && divergence === null,
    originalHash,
    replayedHash,
    originalEvents: before.length,
    replayedEvents: after.length,
    divergence,
  };
}

/**
 * Runs a world, taking a snapshot partway, then replays the rest from it. Used by the replay
 * script and by the tests: it is the whole promise of determinism in one call.
 */
export function verifyReplay(
  build: () => WorldState,
  untilSnapshot: number,
  thenTicks: number,
): ReplayResult {
  const state = build();
  runSimulation(state, untilSnapshot);
  const snapshot = serializeWorld(state);
  const result = runSimulation(state, thenTicks);
  return replayFromSnapshot(snapshot, thenTicks, { state, events: result.events });
}
