/**
 * Starting positions of a historical world: explicit, deterministic, observable.
 *
 * Every map size has a quality band. The engine first tries the *preferred* band (high floor,
 * narrow spread, fresh water for everyone); only if the map cannot host the roster that way does
 * it widen to the *fallback* band, and as a last resort it drops the balance altogether. Small
 * maps get a wider band on purpose — fewer cells, fewer good spots — and the tier actually used,
 * together with per-start metrics, is recorded in the world's roster so the UI can warn about a
 * start placed in a fallback cell. Nothing is ever moved or compensated after creation.
 *
 * Placement draws from its own stream (`deriveRng(seed, "placement")`): the number of attempts
 * never shifts the simulation RNG, and the chosen cells are returned in a seeded order, so the
 * first slot of the roster is not systematically the best spot.
 */
import { cellsInRadius, distance } from "./grid";
import { deriveRng } from "./prng";
import type { Cell, WorldState } from "./types";

export type MapSizeClass = "small" | "medium" | "large";

/**
 * Quality band of a map size. Quality is `startingAreaQuality` (0..1).
 * - `preferredMin` / `fallbackMin`: quality floor of a start in that tier;
 * - `preferredMax` / `fallbackMax`: widest spread (best − worst start) allowed in that tier;
 * - `warningThreshold`: a start below this quality is flagged to the player.
 */
export interface PlacementQualityBand {
  mapSize: MapSizeClass;
  preferredMin: number;
  preferredMax: number;
  fallbackMin: number;
  fallbackMax: number;
  warningThreshold: number;
}

export const PLACEMENT_BANDS: Readonly<Record<MapSizeClass, PlacementQualityBand>> = {
  large: {
    mapSize: "large",
    preferredMin: 0.55,
    preferredMax: 0.05,
    fallbackMin: 0.45,
    fallbackMax: 0.12,
    warningThreshold: 0.5,
  },
  medium: {
    mapSize: "medium",
    preferredMin: 0.5,
    preferredMax: 0.08,
    fallbackMin: 0.42,
    fallbackMax: 0.18,
    warningThreshold: 0.47,
  },
  small: {
    mapSize: "small",
    preferredMin: 0.45,
    preferredMax: 0.12,
    fallbackMin: 0.4,
    fallbackMax: 0.25,
    warningThreshold: 0.44,
  },
};

/** Area thresholds: < 40×40 small, ≥ 72×72 large (the default 48×48 map is medium). */
export function mapSizeClass(width: number, height: number): MapSizeClass {
  const area = width * height;
  if (area < 40 * 40) return "small";
  if (area >= 72 * 72) return "large";
  return "medium";
}

export function placementBandFor(width: number, height: number): PlacementQualityBand {
  return PLACEMENT_BANDS[mapSizeClass(width, height)];
}

/** Can a band live here at all? Never ocean or mountain, never a barely habitable cell. */
export function isHabitableStart(cell: Cell): boolean {
  return cell.biome !== "ocean" && cell.biome !== "mountain" && cell.habitability >= 0.45;
}

/** Land quality of the area a band works (radius 2), as used since the first engine version. */
export function startingAreaScore(state: WorldState, cell: Cell): number {
  const area = cellsInRadius(state, cell.x, cell.y, 2);
  const land = area.filter((c) => c.biome !== "ocean");
  const avg = land.reduce((acc, c) => acc + c.habitability, 0) / Math.max(1, area.length);
  return cell.habitability * 0.5 + avg * 0.5;
}

/** Fresh water within one cell: a river, the coast or a well-watered cell. */
export function waterAccess(state: WorldState, cell: Cell): boolean {
  return cellsInRadius(state, cell.x, cell.y, 1).some(
    (c) => c.biome !== "ocean" && (c.river || c.coastal || c.water >= 0.5),
  );
}

export interface StartMetrics {
  quality: number;
  water: boolean;
  /** Mean base fertility of the land within reach (0..1). */
  fertility: number;
  /** Mean of wood, game and stone within reach, each normalised to its usual maximum (0..1). */
  resources: number;
  /** Harshness of the climate within reach: cold, heat or drought (0 = mild). */
  climatePenalty: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function startMetrics(state: WorldState, cell: Cell): StartMetrics {
  const land = cellsInRadius(state, cell.x, cell.y, 2).filter((c) => c.biome !== "ocean");
  const n = Math.max(1, land.length);
  const mean = (f: (c: Cell) => number) => land.reduce((acc, c) => acc + f(c), 0) / n;
  return {
    quality: round3(startingAreaScore(state, cell)),
    water: waterAccess(state, cell),
    fertility: round3(mean((c) => Math.min(1, c.baseFertility))),
    resources: round3(
      mean(
        (c) => (Math.min(1, c.maxWood / 60) + Math.min(1, c.maxFauna / 26) + Math.min(1, c.stone / 40)) / 3,
      ),
    ),
    climatePenalty: round3(
      mean((c) => Math.max(0, Math.abs(c.temperature - 0.6) - 0.2) + Math.max(0, 0.3 - c.moisture)),
    ),
  };
}

export type PlacementTier = "preferred" | "fallback" | "unbalanced";

export interface PlacementReport {
  band: PlacementQualityBand;
  /** Tier that produced the starts (the whole roster is placed in one pass). */
  tier: PlacementTier;
  /** Starts flagged as fallback: in a fallback/unbalanced pass, below the warning threshold, or without water. */
  fallbackCount: number;
  /** Smallest distance between two starts, and the spacing the pass required. */
  minDistance: number;
  requiredDistance: number;
  minQuality: number;
  maxQuality: number;
  /** Seeded offset of the slot rotation (auditable). */
  rotation: number;
}

export interface PlacedStart {
  cell: Cell;
  metrics: StartMetrics;
  /** True when this start was not placed within the preferred band. */
  fallback: boolean;
  nearestStartDistance: number;
}

export interface PlacementResult {
  starts: PlacedStart[];
  report: PlacementReport;
}

interface Candidate {
  cell: Cell;
  score: number;
  water: boolean;
}

/** Greedy spaced pick over a seeded shuffle of the pool. */
function spacedPick(
  pool: Candidate[],
  count: number,
  minDistance: number,
  rng: ReturnType<typeof deriveRng>,
): Cell[] | null {
  const chosen: Cell[] = [];
  for (const pick of rng.shuffle([...pool])) {
    if (chosen.every((c) => distance(c.x, c.y, pick.cell.x, pick.cell.y) >= minDistance))
      chosen.push(pick.cell);
    if (chosen.length === count) return chosen;
  }
  return null;
}

/** Tries every anchor (best quality first) and spacing for one tier; null when the map cannot host it. */
function tryTier(
  candidates: Candidate[],
  count: number,
  floor: number,
  maxSpread: number,
  distances: number[],
  rng: ReturnType<typeof deriveRng>,
): { cells: Cell[]; distance: number } | null {
  const eligible = candidates.filter((c) => c.score >= floor).sort((a, b) => b.score - a.score);
  if (eligible.length < count) return null;
  const steps = [maxSpread / 2, maxSpread].filter((v, i, a) => a.indexOf(v) === i);
  for (const minDistance of distances) {
    for (const spread of steps) {
      for (let q = 0; q < 10; q++) {
        const anchor = eligible[Math.floor((eligible.length * q) / 10)];
        if (!anchor) break;
        const pool = eligible.filter((c) => c.score <= anchor.score && c.score >= anchor.score - spread);
        if (pool.length < count) continue;
        const cells = spacedPick(pool, count, minDistance, rng);
        if (cells) return { cells, distance: minDistance };
      }
    }
  }
  return null;
}

/**
 * Places `count` starts. Deterministic for (seed, map, count). Throws only if the map has fewer
 * habitable, spaced cells than peoples even with no balance at all.
 */
export function placeStarts(
  state: WorldState,
  count: number,
  options: { balanced: boolean },
): PlacementResult {
  const band = placementBandFor(state.width, state.height);
  const rng = deriveRng(state.seed, "placement");
  const candidates: Candidate[] = state.cells
    .filter(isHabitableStart)
    .map((cell) => ({ cell, score: startingAreaScore(state, cell), water: waterAccess(state, cell) }))
    .filter((c) => c.score >= 0.4);
  const spacing = Math.max(7, Math.floor(Math.min(state.width, state.height) / 4));
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, from - to + 1) }, (_, i) => from - i);

  let tier: PlacementTier = "unbalanced";
  let picked: { cells: Cell[]; distance: number } | null = null;
  if (options.balanced) {
    // Preferred: fresh water for everyone, high floor, narrow spread, generous spacing.
    picked = tryTier(
      candidates.filter((c) => c.water),
      count,
      band.preferredMin,
      band.preferredMax,
      range(spacing, 5),
      rng,
    );
    if (picked) tier = "preferred";
    else {
      // Fallback: wider band and spacing, water still preferred.
      picked =
        tryTier(
          candidates.filter((c) => c.water),
          count,
          band.fallbackMin,
          band.fallbackMax,
          range(spacing, 3),
          rng,
        ) ?? tryTier(candidates, count, band.fallbackMin, band.fallbackMax, range(spacing, 3), rng);
      if (picked) tier = "fallback";
    }
  }
  if (!picked) {
    // No balance possible (or not requested): the best-weighted spaced habitable cells.
    for (const minDistance of range(spacing, 3)) {
      const chosen: Cell[] = [];
      const pool = [...candidates];
      while (chosen.length < count && pool.length > 0) {
        const idx = rng.weightedIndex(pool.map((c) => c.score ** 3));
        const [pick] = pool.splice(idx, 1);
        if (!pick) break;
        if (chosen.every((c) => distance(c.x, c.y, pick.cell.x, pick.cell.y) >= minDistance))
          chosen.push(pick.cell);
      }
      if (chosen.length === count) {
        picked = { cells: chosen, distance: minDistance };
        break;
      }
    }
  }
  if (!picked) throw new Error("La mappa generata non ha abbastanza celle abitabili per le civiltà iniziali");

  // Seeded rotation of the slots: whoever comes first in the roster gets an arbitrary spot.
  const rotation = picked.cells.length > 0 ? rng.int(0, picked.cells.length - 1) : 0;
  const cells = [...picked.cells.slice(rotation), ...picked.cells.slice(0, rotation)];
  const starts: PlacedStart[] = cells.map((cell) => {
    const metrics = startMetrics(state, cell);
    const others = cells.filter((c) => c !== cell).map((c) => distance(c.x, c.y, cell.x, cell.y));
    return {
      cell,
      metrics,
      fallback: tier !== "preferred" || metrics.quality < band.warningThreshold || !metrics.water,
      nearestStartDistance: others.length ? Math.min(...others) : 0,
    };
  });
  const qualities = starts.map((s) => s.metrics.quality);
  return {
    starts,
    report: {
      band,
      tier,
      fallbackCount: starts.filter((s) => s.fallback).length,
      minDistance: starts.length > 1 ? Math.min(...starts.map((s) => s.nearestStartDistance)) : 0,
      requiredDistance: picked.distance,
      minQuality: Math.min(...qualities),
      maxQuality: Math.max(...qualities),
      rotation,
    },
  };
}
