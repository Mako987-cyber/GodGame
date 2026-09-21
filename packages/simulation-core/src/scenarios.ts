import { BIOME_PROFILES } from "./constants";
import { clamp, distance, round } from "./grid";
import { riverName } from "./names";
import { deriveRng } from "./prng";
import { computeHabitability } from "./terrain";
import type { Cell, Tribe, WorldState } from "./types";
import { createWorld, type CreateWorldOptions } from "./world-generator";

/**
 * Reproducible test scenarios.
 *
 * Each scenario starts from an ordinary generated world and reshapes it — terrain, deposits,
 * starting positions, starting cultures — so that one question can be asked of the engine: does
 * a fertile valley develop differently from a desert, does an island stay behind, does a trade
 * corridor spread technology faster?
 *
 * Deterministic: every change is drawn from a stream derived from the seed and the scenario
 * name, never from the world's own RNG, so the simulation itself starts from the same state it
 * would have for that terrain.
 */

export const SCENARIO_NAMES = [
  "baseline",
  "fertile-valley",
  "desert",
  "island",
  "trade-corridor",
  "rival-powers",
  "mining-region",
  "overpopulated-city",
  "fragmented",
  "modern-identities",
  "fusion-prone",
  "tech-diffusion",
  "isolated",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface ScenarioDefinition {
  name: ScenarioName;
  /** What the scenario is meant to exercise, in plain language. */
  purpose: string;
  build: (seed: string, size?: number) => WorldState;
}

const land = (c: Cell) => c.biome !== "ocean";

/** Re-derives what depends on a cell's biome and water after an edit. */
function settle(cell: Cell) {
  const profile = BIOME_PROFILES[cell.biome];
  cell.maxFauna = profile.maxFauna;
  cell.fauna = Math.min(cell.fauna, cell.maxFauna);
  cell.maxWood = profile.maxWood;
  cell.wood = Math.min(cell.wood, cell.maxWood);
  cell.fertility = cell.baseFertility;
  cell.habitability = computeHabitability(cell);
}

/** Coastal flags follow the ocean: land touching the ocean is coast. */
function recomputeCoast(state: WorldState) {
  for (const cell of state.cells) {
    if (!land(cell)) {
      cell.coastal = false;
      continue;
    }
    let coastal = false;
    for (let dy = -1; dy <= 1 && !coastal; dy++) {
      for (let dx = -1; dx <= 1 && !coastal; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
        if (state.cells[y * state.width + x]?.biome === "ocean") coastal = true;
      }
    }
    cell.coastal = coastal;
  }
}

/** Moves a band and every one of its members to a cell. */
export function relocateTribe(state: WorldState, tribe: Tribe, cell: Cell) {
  tribe.x = cell.x;
  tribe.y = cell.y;
  for (const person of state.people) {
    if (person.tribeId !== tribe.id) continue;
    person.x = cell.x;
    person.y = cell.y;
  }
}

/** Spreads the tribes over the given cells, as far from each other as the cells allow. */
function spreadTribes(state: WorldState, cells: Cell[]) {
  const usable = cells.filter((c) => land(c) && c.habitability >= 0.3);
  if (usable.length === 0) return;
  const chosen: Cell[] = [];
  for (const tribe of state.tribes) {
    const next = usable.reduce((best, c) => {
      const score =
        chosen.length === 0 ? c.habitability : Math.min(...chosen.map((o) => distance(o.x, o.y, c.x, c.y)));
      const bestScore =
        chosen.length === 0
          ? best.habitability
          : Math.min(...chosen.map((o) => distance(o.x, o.y, best.x, best.y)));
      return score > bestScore ? c : best;
    }, usable[0] as Cell);
    chosen.push(next);
    relocateTribe(state, tribe, next);
  }
}

function base(seed: string, size: number, options: Partial<CreateWorldOptions> = {}): WorldState {
  return createWorld({ seed, width: size, height: size, ...options });
}

function withCulture(state: WorldState, patch: (t: Tribe) => Partial<Tribe["culture"]>) {
  for (const tribe of state.tribes) tribe.culture = { ...tribe.culture, ...patch(tribe) };
}

export const SCENARIOS: Record<ScenarioName, ScenarioDefinition> = {
  baseline: {
    name: "baseline",
    purpose: "Mondo generato senza modifiche: il termine di paragone.",
    build: (seed, size = 64) => base(seed, size),
  },
  "fertile-valley": {
    name: "fertile-valley",
    purpose: "Un fiume in una valle fertile: l'agricoltura dovrebbe arrivare presto.",
    build: (seed, size = 64) => {
      const state = base(seed, size);
      const rng = deriveRng(seed, "scenario:fertile-valley");
      const name = riverName(rng);
      const mid = Math.floor(state.height / 2);
      for (const cell of state.cells) {
        const band = Math.abs(cell.y - mid);
        if (band > 5) continue;
        if (!land(cell)) cell.biome = "plains";
        if (cell.biome === "mountain" || cell.biome === "desert" || cell.biome === "tundra")
          cell.biome = "plains";
        cell.baseFertility = round(clamp(0.9 - band * 0.05), 3);
        cell.water = round(clamp(0.9 - band * 0.05), 3);
        cell.temperature = 0.6;
        if (band === 0) {
          cell.river = true;
          cell.riverName = name;
        }
        settle(cell);
      }
      recomputeCoast(state);
      spreadTribes(
        state,
        state.cells.filter((c) => Math.abs(c.y - mid) <= 3),
      );
      return state;
    },
  },
  desert: {
    name: "desert",
    purpose: "Terra arida con poche oasi: sopravvivenza difficile, tecniche dell'acqua preziose.",
    build: (seed, size = 64) => {
      const state = base(seed, size);
      const rng = deriveRng(seed, "scenario:desert");
      const oases = Array.from({ length: Math.max(3, state.tribes.length) }, () => ({
        x: rng.int(4, state.width - 5),
        y: rng.int(4, state.height - 5),
      }));
      for (const cell of state.cells) {
        if (!land(cell)) continue;
        const near = Math.min(...oases.map((o) => distance(o.x, o.y, cell.x, cell.y)));
        if (near <= 2) {
          cell.biome = "plains";
          cell.baseFertility = 0.6;
          cell.water = 0.8;
        } else {
          cell.biome = "desert";
          cell.baseFertility = 0.08;
          cell.water = 0.1;
          cell.river = false;
          cell.riverName = null;
        }
        cell.temperature = 0.85;
        settle(cell);
      }
      recomputeCoast(state);
      spreadTribes(
        state,
        state.cells.filter((c) => oases.some((o) => distance(o.x, o.y, c.x, c.y) <= 1)),
      );
      return state;
    },
  },
  island: {
    name: "island",
    purpose: "Un'isola in mezzo al mare: pesca e isolamento.",
    build: (seed, size = 64) => {
      const state = base(seed, size);
      const cx = state.width / 2;
      const cy = state.height / 2;
      const radius = Math.min(state.width, state.height) * 0.3;
      for (const cell of state.cells) {
        const d = Math.hypot(cell.x - cx, cell.y - cy);
        if (d > radius) {
          cell.biome = "ocean";
          cell.river = false;
          cell.riverName = null;
          cell.baseFertility = 0;
          cell.water = 1;
        } else if (!land(cell)) {
          cell.biome = "plains";
          cell.baseFertility = 0.6;
        }
        settle(cell);
      }
      recomputeCoast(state);
      spreadTribes(state, state.cells.filter(land));
      return state;
    },
  },
  "trade-corridor": {
    name: "trade-corridor",
    purpose: "Popoli in fila lungo un fiume navigabile: il commercio dovrebbe diffondere le tecniche.",
    build: (seed, size = 64) => {
      const state = base(seed, size);
      const rng = deriveRng(seed, "scenario:trade-corridor");
      const name = riverName(rng);
      const mid = Math.floor(state.height / 2);
      for (const cell of state.cells) {
        if (Math.abs(cell.y - mid) > 2) continue;
        cell.biome = "plains";
        cell.baseFertility = 0.65;
        cell.water = 0.8;
        cell.river = cell.y === mid;
        cell.riverName = cell.river ? name : null;
        settle(cell);
      }
      recomputeCoast(state);
      // Evenly along the river, close enough to be neighbours.
      const step = Math.max(4, Math.floor(state.width / (state.tribes.length + 1)));
      state.tribes.forEach((tribe, i) => {
        const cell = state.cells[mid * state.width + Math.min(state.width - 2, step * (i + 1))];
        if (cell) relocateTribe(state, tribe, cell);
      });
      withCulture(state, () => ({ tradeOpenness: 70 }));
      return state;
    },
  },
  "rival-powers": {
    name: "rival-powers",
    purpose: "Due popoli grandi, vicini e bellicosi: guerre, occupazioni, vassallaggi.",
    build: (seed, size = 48) => {
      const state = base(seed, size, {
        settings: { minTribes: 2, maxTribes: 2, minTribeSize: 60, maxTribeSize: 70 },
      });
      const usable = state.cells.filter((c) => land(c) && c.habitability >= 0.45);
      const centre = usable.reduce((best, c) =>
        distance(c.x, c.y, state.width / 2, state.height / 2) <
        distance(best.x, best.y, state.width / 2, state.height / 2)
          ? c
          : best,
      );
      const near = usable
        .filter(
          (c) => distance(c.x, c.y, centre.x, centre.y) >= 6 && distance(c.x, c.y, centre.x, centre.y) <= 8,
        )
        .sort((a, b) => b.habitability - a.habitability || a.y - b.y || a.x - b.x)[0];
      const [a, b] = state.tribes;
      if (a) relocateTribe(state, a, centre);
      if (b && near) relocateTribe(state, b, near);
      withCulture(state, () => ({ militarism: 80, expansionism: 75, cooperation: 30 }));
      return state;
    },
  },
  "mining-region": {
    name: "mining-region",
    purpose: "Colline ricche di rame, stagno e ferro: la metallurgia dovrebbe arrivare prima.",
    build: (seed, size = 64) => {
      const state = base(seed, size);
      for (const tribe of state.tribes) {
        for (const cell of state.cells) {
          if (!land(cell) || distance(cell.x, cell.y, tribe.x, tribe.y) > 3) continue;
          cell.copper = Math.max(cell.copper, 6);
          cell.tin = Math.max(cell.tin, 3);
          cell.iron = Math.max(cell.iron, 6);
          cell.coal = Math.max(cell.coal, 4);
          cell.stone = Math.max(cell.stone, 60);
        }
      }
      return state;
    },
  },
  "overpopulated-city": {
    name: "overpopulated-city",
    purpose: "Un popolo molto più numeroso degli altri su poca terra: carestie, epidemie, colonie.",
    build: (seed, size = 48) => {
      const state = base(seed, size, { settings: { minTribeSize: 20, maxTribeSize: 30 } });
      const big = state.tribes[0];
      if (!big) return state;
      const members = state.people.filter((p) => p.tribeId === big.id);
      let seq = state.counters.person;
      for (let copy = 0; copy < 5; copy++) {
        for (const person of members) {
          seq += 1;
          state.people.push({
            ...structuredClone(person),
            id: `p${seq}`,
            seq,
            householdId: null,
            notable: false,
            title: null,
          });
        }
      }
      state.counters.person = seq;
      return state;
    },
  },
  fragmented: {
    name: "fragmented",
    purpose: "Molti popoli piccoli: assorbimenti, fusioni, poche civiltà durature.",
    build: (seed, size = 64) =>
      base(seed, size, { settings: { minTribes: 12, maxTribes: 12, minTribeSize: 10, maxTribeSize: 16 } }),
  },
  "modern-identities": {
    name: "modern-identities",
    purpose: "Solo identità dell'età moderna: partenza uniforme, nessun vantaggio dal nome.",
    build: (seed, size = 64) =>
      base(seed, size, {
        roster: {
          mode: "selected",
          identityKeys: ["french", "english", "spanish", "german", "russian", "american"],
        },
      }),
  },
  "fusion-prone": {
    name: "fusion-prone",
    purpose: "Popoli vicini, cooperativi e aperti: le condizioni più favorevoli alle fusioni.",
    build: (seed, size = 40) => {
      const state = base(seed, size, { settings: { minTribes: 6, maxTribes: 6 } });
      withCulture(state, () => ({ cooperation: 85, tradeOpenness: 80, militarism: 15, tolerance: 80 }));
      return state;
    },
  },
  "tech-diffusion": {
    name: "tech-diffusion",
    purpose: "Molti popoli vicini e aperti: la diffusione dovrebbe dominare la scoperta autonoma.",
    build: (seed, size = 40) => {
      const state = base(seed, size, { settings: { minTribes: 10, maxTribes: 10 } });
      withCulture(state, () => ({ tradeOpenness: 85, tolerance: 75, exploration: 70 }));
      return state;
    },
  },
  isolated: {
    name: "isolated",
    purpose: "Pochi popoli molto lontani e chiusi: ognuno scopre da sé, e i percorsi divergono.",
    build: (seed, size = 96) => {
      const state = base(seed, size, { settings: { minTribes: 4, maxTribes: 4 } });
      const corners = [
        [0.15, 0.15],
        [0.85, 0.15],
        [0.15, 0.85],
        [0.85, 0.85],
      ] as const;
      state.tribes.forEach((tribe, i) => {
        const [fx, fy] = corners[i % corners.length]!;
        const target = { x: Math.floor(state.width * fx), y: Math.floor(state.height * fy) };
        const cell = state.cells
          .filter((c) => land(c) && c.habitability >= 0.35)
          .reduce<Cell | null>(
            (best, c) =>
              !best || distance(c.x, c.y, target.x, target.y) < distance(best.x, best.y, target.x, target.y)
                ? c
                : best,
            null,
          );
        if (cell) relocateTribe(state, tribe, cell);
      });
      withCulture(state, () => ({ tradeOpenness: 15, exploration: 10 }));
      return state;
    },
  },
};

export function buildScenario(name: ScenarioName, seed: string, size?: number): WorldState {
  return SCENARIOS[name].build(seed, size);
}

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIO_NAMES as readonly string[]).includes(value);
}
