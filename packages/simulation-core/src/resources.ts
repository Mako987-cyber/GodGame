import { ECONOMY } from "./constants";
import type { SimContext } from "./context";
import { cellsInRadius, clamp, distance } from "./grid";
import { computeHabitability } from "./terrain";
import type { Cell, WorldState } from "./types";

/** Step 1: annual climate. A smooth multi-cycle oscillation plus rare seeded regional droughts. */
export function updateClimate(ctx: SimContext) {
  const { state, rng } = ctx;
  const t = state.tick;
  const cycle = Math.sin((2 * Math.PI * t) / 37) * 0.07 + Math.sin((2 * Math.PI * t) / 11) * 0.04;
  state.climate.modifier = Math.round((1 + cycle + rng.range(-0.05, 0.05)) * 1000) / 1000;
  state.climate.droughts = state.climate.droughts.filter((d) => d.untilYear >= state.year);
  if (rng.chance(0.025)) {
    state.climate.droughts.push({
      x: rng.int(0, state.width - 1),
      y: rng.int(0, state.height - 1),
      radius: rng.int(6, 14),
      severity: Math.round(rng.range(0.25, 0.5) * 100) / 100,
      untilYear: state.year + rng.int(2, 5),
    });
  }
}

export function climateAt(state: WorldState, x: number, y: number): number {
  let modifier = state.climate.modifier;
  for (const d of state.climate.droughts) {
    if (distance(d.x, d.y, x, y) <= d.radius) modifier *= 1 - d.severity;
  }
  return modifier;
}

/**
 * Step 2: logistic regeneration. Growth is proportional to the remaining stock, so
 * an overharvested cell (fauna close to zero) recovers very slowly: overuse matters.
 */
export function regenerateResources(state: WorldState) {
  for (const cell of state.cells) {
    if (cell.biome === "ocean") continue;
    if (cell.maxFauna > 0) {
      const growth = ECONOMY.faunaRegenRate * cell.fauna * (1 - cell.fauna / cell.maxFauna) + 0.15;
      cell.fauna = Math.min(cell.maxFauna, cell.fauna + growth);
    }
    if (cell.maxWood > 0) {
      const growth = ECONOMY.woodRegenRate * cell.wood * (1 - cell.wood / cell.maxWood) + 0.1;
      cell.wood = Math.min(cell.maxWood, cell.wood + growth);
    }
    if (cell.fields === 0 && cell.fertility < cell.baseFertility) {
      cell.fertility = Math.min(
        cell.baseFertility,
        cell.fertility + ECONOMY.fertilityRecovery * (cell.baseFertility - cell.fertility + 0.05),
      );
    }
    cell.fauna = round2(cell.fauna);
    cell.wood = round2(cell.wood);
    cell.fertility = Math.round(cell.fertility * 10000) / 10000;
    cell.habitability = Math.round(computeHabitability(cell) * 10000) / 10000;
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function workArea(state: WorldState, x: number, y: number, radius: number): Cell[] {
  return cellsInRadius(state, x, y, radius).filter((c) => c.biome !== "ocean");
}

/**
 * Takes up to `demand` units of natural food from the area, proportionally to what each
 * cell holds. Returns the amount obtained (scarcity lowers yields automatically).
 */
export function extractNaturalFood(area: Cell[], demand: number): number {
  if (demand <= 0) return 0;
  let available = 0;
  for (const c of area) available += c.fauna * ECONOMY.harvestFraction;
  if (available <= 0) return 0;
  const taken = Math.min(demand, available);
  const share = taken / available;
  for (const c of area) c.fauna = round2(Math.max(0, c.fauna - c.fauna * ECONOMY.harvestFraction * share));
  return taken;
}

export function extractWood(area: Cell[], demand: number): number {
  let available = 0;
  for (const c of area) available += c.wood * 0.3;
  if (available <= 0 || demand <= 0) return 0;
  const taken = Math.min(demand, available);
  const share = taken / available;
  for (const c of area) c.wood = round2(Math.max(0, c.wood - c.wood * 0.3 * share));
  return taken;
}

/** Stone is abundant and not depleted meaningfully at MVP scale; copper deposits are finite. */
export function extractStone(area: Cell[], demand: number): number {
  const best = area.reduce((acc, c) => Math.max(acc, c.stone), 0);
  return Math.min(demand, best * 0.4);
}

export function extractCopper(area: Cell[], demand: number): number {
  let taken = 0;
  for (const c of area) {
    if (taken >= demand) break;
    if (c.copper <= 0) continue;
    const amount = Math.min(c.copper, demand - taken, 3);
    c.copper = round2(c.copper - amount);
    taken += amount;
  }
  return taken;
}

export function areaQuality(area: Cell[]): number {
  if (area.length === 0) return 0;
  let fauna = 0;
  let max = 0;
  for (const c of area) {
    fauna += c.fauna;
    max += c.maxFauna;
  }
  return max > 0 ? clamp(fauna / max) : 0;
}
