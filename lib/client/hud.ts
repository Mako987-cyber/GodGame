/**
 * Figures shown in the strategic HUD, derived from the world payload only (no extra queries).
 * Pure functions: the HUD component just formats them.
 */
import type { WorldDetail } from "@/lib/dto";

export interface HudStats {
  tick: number;
  population: number;
  /** Food in stores (settlements and tribes). */
  food: number;
  wood: number;
  stone: number;
  copper: number;
  /** Average water availability of inhabited land, 0..100. */
  water: number;
  /** Population-weighted stability, 0..100 (100 = no unrest). */
  stability: number;
  technologies: number;
  wars: number;
  crises: number;
}

export type HudKey = Exclude<keyof HudStats, "tick">;

export function computeHudStats(detail: WorldDetail): HudStats {
  let food = 0;
  let wood = 0;
  let stone = 0;
  let copper = 0;
  for (const t of detail.tribes) {
    if (t.status === "extinct") continue;
    food += t.stock.food;
    wood += t.stock.wood;
    stone += t.stock.stone;
    copper += t.stock.copper;
  }
  let weighted = 0;
  let weight = 0;
  for (const s of detail.settlements) {
    if (s.status !== "active") continue;
    food += s.stock.food;
    wood += s.stock.wood;
    stone += s.stock.stone;
    copper += s.stock.copper;
    const w = Math.max(1, s.population);
    weighted += (1 - Math.max(0, Math.min(1, s.unrest))) * w;
    weight += w;
  }
  if (weight === 0) {
    // No settlements yet: fall back to the tribes' revolt risk.
    for (const t of detail.tribes) {
      if (t.status === "extinct") continue;
      const w = Math.max(1, t.population);
      weighted += (1 - Math.max(0, Math.min(1, t.stability.revoltRisk))) * w;
      weight += w;
    }
  }

  // Water: mean availability over owned cells (or all land when nobody owns any yet).
  const m = detail.map;
  let waterSum = 0;
  let waterCells = 0;
  const anyOwned = m.owner.some((o) => o >= 0);
  for (let i = 0; i < m.water.length; i++) {
    if (anyOwned ? (m.owner[i] ?? -1) < 0 : m.biome[i] === 0) continue;
    waterSum += m.water[i] ?? 0;
    waterCells++;
  }

  return {
    tick: detail.world.currentTick,
    population: detail.world.summary.population,
    food,
    wood,
    stone,
    copper,
    water: waterCells ? Math.round((waterSum / waterCells) * 100) : 0,
    stability: weight ? Math.round((weighted / weight) * 100) : 0,
    technologies: detail.world.summary.technologies,
    wars: detail.relationships.filter((r) => r.atWar).length,
    crises: detail.crises.length,
  };
}

/** Change of each figure since the previous tick shown, or null when there is nothing to compare. */
export function hudDeltas(current: HudStats, previous: HudStats | null): Partial<Record<HudKey, number>> {
  if (!previous || previous.tick === current.tick) return {};
  const out: Partial<Record<HudKey, number>> = {};
  for (const key of Object.keys(current) as (keyof HudStats)[]) {
    if (key === "tick") continue;
    const d = current[key] - previous[key];
    if (Math.abs(d) >= 0.5) out[key] = d;
  }
  return out;
}

export type Trend = "surplus" | "deficit" | "steady";

/** For stocks a fall is a deficit; for wars and crises a rise is the bad direction. */
export function trendOf(key: HudKey, delta: number | undefined): Trend {
  if (delta === undefined || delta === 0) return "steady";
  const badWhenUp = key === "wars" || key === "crises";
  return delta > 0 !== badWhenUp ? "surplus" : "deficit";
}

export function fmtSigned(n: number, format: (v: number) => string): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${format(Math.abs(n))}`;
}
