import { ECONOMY } from "./constants";
import { cellsInRadius, clamp, round } from "./grid";
import { computeHabitability } from "./terrain";
import type { Cell, WorldState } from "./types";

/**
 * Natural resources: regeneration and extraction.
 * Climate now lives in `climate.ts`; this module only deals with what the land holds.
 */

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
    if (cell.fields === 0 && cell.pastures === 0 && cell.fertility < cell.baseFertility) {
      cell.fertility = Math.min(
        cell.baseFertility,
        cell.fertility + ECONOMY.fertilityRecovery * (cell.baseFertility - cell.fertility + 0.05),
      );
    }
    cell.fauna = round(cell.fauna, 2);
    cell.wood = round(cell.wood, 2);
    cell.fertility = round(cell.fertility, 4);
    cell.habitability = round(computeHabitability(cell), 4);
  }
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
  for (const c of area) c.fauna = round(Math.max(0, c.fauna - c.fauna * ECONOMY.harvestFraction * share), 2);
  return taken;
}

export function extractWood(area: Cell[], demand: number): number {
  let available = 0;
  for (const c of area) available += c.wood * 0.3;
  if (available <= 0 || demand <= 0) return 0;
  const taken = Math.min(demand, available);
  const share = taken / available;
  for (const c of area) c.wood = round(Math.max(0, c.wood - c.wood * 0.3 * share), 2);
  return taken;
}

/** Stone is abundant and not depleted meaningfully at MVP scale; ore deposits are finite. */
export function extractStone(area: Cell[], demand: number): number {
  const best = area.reduce((acc, c) => Math.max(acc, c.stone), 0);
  return Math.min(demand, best * 0.4);
}

export function extractCopper(area: Cell[], demand: number): number {
  return extractOre(area, "copper", demand);
}

/**
 * Finite deposits: every unit taken is gone for good, which is what makes a mine run dry
 * and turns a copper-rich valley into something worth fighting over.
 */
export function extractOre(
  area: Cell[],
  kind: "copper" | "tin" | "iron" | "coal" | "clay",
  demand: number,
): number {
  if (demand <= 0) return 0;
  let taken = 0;
  for (const c of area) {
    if (taken >= demand) break;
    const available = c[kind];
    if (available <= 0) continue;
    const amount = Math.min(available, demand - taken, 3);
    c[kind] = round(available - amount, 2);
    taken += amount;
  }
  return taken;
}

/** Deposits still left in an area: used by diplomacy (contested resources) and by the UI. */
export function areaDeposits(area: Cell[]): Record<"copper" | "tin" | "iron" | "coal" | "clay", number> {
  const out = { copper: 0, tin: 0, iron: 0, coal: 0, clay: 0 };
  for (const c of area) {
    out.copper += c.copper;
    out.tin += c.tin;
    out.iron += c.iron;
    out.coal += c.coal;
    out.clay += c.clay;
  }
  return out;
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
