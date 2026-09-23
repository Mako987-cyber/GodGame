import { describe, expect, it } from "vitest";
import {
  buildScenario,
  createWorld,
  deserializeWorld,
  hashWorld,
  eventSignature,
  replayFromSnapshot,
  runSimulation,
  serializeWorld,
  verifyReplay,
} from "../src/index";

describe("replay da snapshot", () => {
  it("rigioca la storia e ottiene lo stesso stato e la stessa cronaca", () => {
    const result = verifyReplay(() => createWorld({ seed: "replay", width: 48, height: 48 }), 100, 60);
    expect(result.identical).toBe(true);
    expect(result.divergence).toBeNull();
    expect(result.originalHash).toBe(result.replayedHash);
    expect(result.replayedEvents).toBe(result.originalEvents);
    expect(result.originalEvents).toBeGreaterThan(0);
    expect(result.fromTick).toBe(100);
  });

  it("vale anche per uno scenario rimodellato", () => {
    expect(verifyReplay(() => buildScenario("fertile-valley", "replay-valle", 48), 80, 40).identical).toBe(
      true,
    );
  });

  it("accorgersi di una divergenza: uno stato manomesso non rigioca uguale", () => {
    const state = createWorld({ seed: "replay-manomesso", width: 48, height: 48 });
    runSimulation(state, 80);
    const snapshot = serializeWorld(state);
    const result = runSimulation(state, 40);

    // Same snapshot, but the world it is compared against has been altered after the fact.
    const tampered = { ...state, people: state.people.slice(0, Math.max(1, state.people.length - 5)) };
    const check = replayFromSnapshot(snapshot, 40, { state: tampered, events: result.events });
    expect(check.identical).toBe(false);
    expect(check.originalHash).not.toBe(check.replayedHash);
  });

  it("lo stato restituito da un batch è già nell'ordine canonico di un ricaricamento", () => {
    // Regression: lists are sorted at the start of each tick, so anything appended during the
    // last one used to sit out of place until the next batch, and an in-memory world stopped
    // matching the same world saved and read back.
    for (const ticks of [1, 7, 60, 61]) {
      const state = createWorld({ seed: "batch", width: 48, height: 48 });
      runSimulation(state, ticks);
      state.archive = { people: [], households: [] };
      const reloaded = deserializeWorld(serializeWorld(state));
      expect(hashWorld(reloaded), `${ticks} tick`).toBe(hashWorld(state));
      expect(reloaded.relationships.map((r) => r.id)).toEqual(state.relationships.map((r) => r.id));
    }
  });

  it("la firma di un evento distingue tick, tipo, protagonisti e titolo", () => {
    const state = createWorld({ seed: "firme", width: 48, height: 48 });
    const events = runSimulation(state, 60).events;
    expect(events.length).toBeGreaterThan(0);
    const first = events[0]!;
    expect(eventSignature(first)).toContain(first.type);
    expect(eventSignature(first)).toContain(String(first.tick));
    expect(eventSignature({ ...first, title: "altro titolo" })).not.toBe(eventSignature(first));
  });
});
