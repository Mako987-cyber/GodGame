import { describe, expect, it } from "vitest";
import {
  checkIdentityLineage,
  checkInvariants,
  checkPoliticalInvariants,
  createWorld,
  HISTORICAL_IDENTITIES,
  runSimulation,
  type HistoricalEvent,
  type WorldState,
} from "../../src/index";

/**
 * Stress matrix (run with `npm run test:simulation`): historical and legacy/procedural worlds,
 * small, medium and large maps, 100–250 ticks, invariants every 25 ticks, event texts checked.
 */

const HISTORICAL_NAMES = HISTORICAL_IDENTITIES.map((i) => i.displayName);

function checkTexts(events: HistoricalEvent[], label: string) {
  for (const e of events) {
    for (const text of [e.title, e.description]) {
      expect(text, `${label}: ${text}`).not.toMatch(/[{}]|undefined|NaN/);
      for (const name of HISTORICAL_NAMES)
        expect(text, `${label}: ${text}`).not.toMatch(new RegExp(`tribù ${name}\\b`));
    }
  }
}

function run(state: WorldState, ticks: number, label: string) {
  const events: HistoricalEvent[] = [];
  for (let done = 0; done < ticks; done += 25) {
    events.push(...runSimulation(state, Math.min(25, ticks - done)).events);
    expect(checkInvariants(state), `${label} tick ${state.tick}`).toEqual([]);
  }
  expect(checkPoliticalInvariants(state), label).toEqual([]);
  expect(checkIdentityLineage(state), label).toEqual([]);
  checkTexts(events, label);
  return events;
}

describe("matrice di stress", () => {
  it("20 seed su mappe piccole (24×24), 150 tick", () => {
    for (let i = 1; i <= 20; i++) {
      const state = createWorld({
        seed: `matrice-piccola-${i}`,
        width: 24,
        height: 24,
        roster: { mode: "random-real", civilizationCount: 4 },
      });
      run(state, 150, state.seed);
      expect(state.roster!.placement!.band.mapSize).toBe("small");
    }
  });

  it("20 seed su mappe medie (48×48), 200 tick, identità moderne incluse", () => {
    for (let i = 1; i <= 20; i++) {
      const state = createWorld({
        seed: `matrice-media-${i}`,
        width: 48,
        height: 48,
        roster: { mode: "custom", identityKeys: ["italian", "ottoman"], civilizationCount: 6 },
      });
      const events = run(state, 200, state.seed);
      expect(events.length).toBeGreaterThan(0);
    }
  });

  it("mappe grandi (96×96), 250 tick", () => {
    for (let i = 1; i <= 3; i++) {
      const state = createWorld({
        seed: `matrice-grande-${i}`,
        width: 96,
        height: 96,
        roster: { mode: "random-real", civilizationCount: 10 },
      });
      run(state, 250, state.seed);
      expect(state.roster!.placement!.tier).toBe("preferred");
    }
  });

  it("mondi procedurali/legacy (senza roster), 200 tick", () => {
    for (let i = 1; i <= 8; i++) {
      const state = createWorld({ seed: `matrice-legacy-${i}` });
      expect(state.roster).toBeNull();
      run(state, 200, state.seed);
      expect(
        state.tribes.every((t) => t.identityType === "procedural" || t.identityType === "composite"),
      ).toBe(true);
    }
  });
});
