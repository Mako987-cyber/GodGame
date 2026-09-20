import { describe, expect, it } from "vitest";
import {
  checkIdentityLineage,
  checkInvariants,
  createWorld,
  HISTORICAL_IDENTITIES,
  runSimulation,
  type HistoricalEvent,
  type WorldState,
} from "../../src/index";

/**
 * Stress and balance of historical worlds (run with `npm run test:simulation`).
 * - 20 seeds × 100 ticks with random rosters, integrity checked every 10 ticks;
 * - the whole catalog in one world;
 * - a balance survey across seeds: it looks for deterministic advantages of an identity,
 *   not for equal outcomes (different stories are the point of the game).
 */

const SEEDS = Array.from({ length: 20 }, (_, i) => `stress-identita-${i + 1}`);

function peoplesAlive(state: WorldState, identityId: string): number {
  const ids = new Set(state.tribes.filter((t) => t.identityId === identityId).map((t) => t.id));
  return state.people.filter((p) => ids.has(p.tribeId)).length;
}

/** Every tribe that is not a founder must have been announced by a split or secession event. */
function unannounced(state: WorldState, events: HistoricalEvent[]): string[] {
  const founders = new Set(state.roster?.entries.map((e) => e.tribeId));
  const announced = new Set(
    events
      .filter(
        (e) =>
          (e.type === "migration" && e.subtype === "split") ||
          e.subtype === "secession" ||
          e.type === "fusion",
      )
      .flatMap((e) => e.actors.map((a) => a.id)),
  );
  return state.tribes.filter((t) => !founders.has(t.id) && !announced.has(t.id)).map((t) => t.name);
}

describe("stress delle identità storiche", () => {
  it("20 seed × 100 tick con roster casuali: invarianti, continuità, nomi", () => {
    for (const seed of SEEDS) {
      const state = createWorld({
        seed,
        width: 48,
        height: 48,
        roster: { mode: "random-real", civilizationCount: 6 },
      });
      const events: HistoricalEvent[] = [];
      for (let batch = 0; batch < 10; batch++) {
        events.push(...runSimulation(state, 10, { checkInvariants: true }).events);
        expect(checkInvariants(state), `${seed} tick ${state.tick}`).toEqual([]);
      }
      expect(state.tick).toBe(100);
      expect(checkIdentityLineage(state), seed).toEqual([]);
      expect(unannounced(state, events), seed).toEqual([]);
      const allNames = state.tribes.map((t) => t.name);
      expect(new Set(allNames).size, `${seed}: nomi duplicati`).toBe(allNames.length);
      // No identity outside the founding roster ever shows up (except composites born in-world).
      const rostered = new Set(state.roster!.entries.map((e) => e.identityId));
      const composites = new Set(state.composites.map((c) => c.id));
      expect(
        state.tribes.every(
          (t) => t.identityId !== null && (rostered.has(t.identityId) || composites.has(t.identityId)),
        ),
      ).toBe(true);
    }
  });

  it("tutte le identità nello stesso mondo per 100 tick", () => {
    for (const seed of ["tutte-1", "tutte-2"]) {
      const state = createWorld({ seed, width: 80, height: 80, roster: { mode: "all-real" } });
      expect(state.roster!.entries).toHaveLength(HISTORICAL_IDENTITIES.length);
      const events: HistoricalEvent[] = [];
      for (let batch = 0; batch < 4; batch++)
        events.push(...runSimulation(state, 25, { checkInvariants: true }).events);
      expect(checkInvariants(state)).toEqual([]);
      expect(unannounced(state, events)).toEqual([]);
    }
  });

  it("bilanciamento: nessuna identità domina in modo sistematico", () => {
    interface Row {
      games: number;
      survived: number;
      wins: number;
      share: number;
      techs: number;
    }
    const table = new Map<string, Row>();
    for (const seed of SEEDS) {
      const state = createWorld({
        seed: `bilancio-${seed}`,
        width: 48,
        height: 48,
        roster: { mode: "random-real", civilizationCount: 6 },
      });
      runSimulation(state, 150);
      const entries = state.roster!.entries;
      const pops = entries.map((e) => peoplesAlive(state, e.identityId));
      const total = pops.reduce((a, b) => a + b, 0) || 1;
      const best = Math.max(...pops);
      entries.forEach((e, i) => {
        const row = table.get(e.identityId) ?? { games: 0, survived: 0, wins: 0, share: 0, techs: 0 };
        const tribes = state.tribes.filter((t) => t.identityId === e.identityId && t.status !== "extinct");
        row.games += 1;
        row.survived += (pops[i] ?? 0) > 0 ? 1 : 0;
        row.wins += pops[i] === best && best > 0 ? 1 : 0;
        row.share += (pops[i] ?? 0) / total;
        row.techs += Math.max(0, ...tribes.map((t) => t.techs.length));
        table.set(e.identityId, row);
      });
    }
    const report = [...table.entries()]
      .map(([key, r]) => ({
        identità: key,
        partite: r.games,
        sopravvivenza: Math.round((r.survived / r.games) * 100),
        vittorie: r.wins,
        quotaMedia: Math.round((r.share / r.games) * 1000) / 10,
        tecnologie: Math.round((r.techs / r.games) * 10) / 10,
      }))
      .sort((a, b) => b.quotaMedia - a.quotaMedia);
    console.table(report);
    for (const row of report) {
      // An identity that won every game it played (with enough games) would signal a hidden edge.
      if (row.partite >= 5) expect(row.vittorie, row.identità).toBeLessThan(row.partite);
      // Fair share with 6 peoples is ~16.7%: three times that on average is not luck.
      if (row.partite >= 5) expect(row.quotaMedia, row.identità).toBeLessThan(50);
    }
  });
});
