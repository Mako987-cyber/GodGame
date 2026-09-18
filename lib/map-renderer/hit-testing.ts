/**
 * Hit testing.
 *
 * Tiles are picked geometrically (elevation-aware: a raised tile in front covers the one behind).
 * Everything else registers a screen-space hit region while it is drawn; the pick returns the
 * region with the best priority, then the one in front.
 */
import {
  MAX_ELEVATION,
  gridToScreen,
  pointInTile,
  worldToGrid,
  type IsoProjectionConfig,
  type Point,
} from "./projection";
import type { ResourceKind } from "./resource-renderer";

export type HitTarget =
  | { type: "building"; settlementId: string; label: string }
  | { type: "resource"; kind: ResourceKind; count: number; x: number; y: number }
  | { type: "settlement"; id: string }
  | { type: "nomad"; id: string }
  | { type: "conflict"; id: string }
  | { type: "trade"; id: string }
  | { type: "cell"; x: number; y: number };

/** Lower wins: buildings and points of interest, then settlements, then units/conflicts, then cells. */
export const HIT_PRIORITY: Record<HitTarget["type"], number> = {
  building: 1,
  resource: 1,
  settlement: 2,
  nomad: 3,
  conflict: 3,
  trade: 4,
  cell: 5,
};

export interface HitRegion {
  /** Screen-space rectangle (CSS pixels). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional circle test inside the rectangle (icons). */
  circle?: boolean;
  /** Draw depth: larger is in front. */
  depth: number;
  target: HitTarget;
}

export function targetKey(t: HitTarget | null | undefined): string {
  if (!t) return "";
  switch (t.type) {
    case "cell":
      return `cell:${t.x}:${t.y}`;
    case "resource":
      return `resource:${t.kind}:${t.x}:${t.y}`;
    case "building":
      return `building:${t.settlementId}:${t.label}`;
    default:
      return `${t.type}:${t.id}`;
  }
}

function contains(r: HitRegion, x: number, y: number): boolean {
  if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return false;
  if (!r.circle) return true;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = r.width / 2;
  const ry = r.height / 2;
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

/** Best region under the point: lowest priority value, then front-most, then last drawn. */
export function pickRegion(regions: readonly HitRegion[], x: number, y: number): HitRegion | null {
  let best: HitRegion | null = null;
  let bestIndex = -1;
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k];
    if (!r || !contains(r, x, y)) continue;
    if (!best) {
      best = r;
      bestIndex = k;
      continue;
    }
    const pr = HIT_PRIORITY[r.target.type];
    const pb = HIT_PRIORITY[best.target.type];
    if (pr < pb || (pr === pb && (r.depth > best.depth || (r.depth === best.depth && k > bestIndex)))) {
      best = r;
      bestIndex = k;
    }
  }
  return best;
}

/**
 * Cell under a world-space point, taking elevation into account: candidates are the ground-plane
 * cell and the cells in front of it that could be raised over the point; the front-most whose top
 * face contains the point wins. Falls back to the ground-plane cell (e.g. on a wall).
 */
export function pickCell(
  world: Point,
  width: number,
  height: number,
  elevationAt: (x: number, y: number) => number,
  config: IsoProjectionConfig,
): { x: number; y: number } | null {
  const ground = worldToGrid(world.x, world.y, config);
  const gx = Math.floor(ground.x);
  const gy = Math.floor(ground.y);
  // A raised tile shifts up by e*step; it can cover cells up to this many diagonal steps behind.
  const reach = Math.ceil((MAX_ELEVATION * config.elevationStep) / config.tileHeight) + 1;
  let best: { x: number; y: number; depth: number } | null = null;
  for (let k = 0; k <= reach; k++) {
    for (const [ox, oy] of [
      [k, k],
      [k + 1, k],
      [k, k + 1],
    ] as const) {
      const x = gx + ox;
      const y = gy + oy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!pointInTile(world.x, world.y, x, y, elevationAt(x, y), config)) continue;
      const depth = x + y;
      if (!best || depth > best.depth) best = { x, y, depth };
    }
  }
  if (best) return { x: best.x, y: best.y };
  // A point on a wall: the wall belongs to the tile above it; walk forward to find it.
  for (let k = 1; k <= reach; k++) {
    for (const [x, y] of [
      [gx + k, gy + k - 1],
      [gx + k - 1, gy + k],
    ] as const) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const e = elevationAt(x, y);
      const top = gridToScreen(x + 0.5, y + 0.5, e, config);
      const base = gridToScreen(x + 0.5, y + 0.5, 0, config);
      if (
        Math.abs(world.x - top.x) <= config.tileWidth / 2 &&
        world.y >= top.y &&
        world.y <= base.y + config.tileHeight / 2
      ) {
        return { x, y };
      }
    }
  }
  if (gx < 0 || gy < 0 || gx >= width || gy >= height) return null;
  return { x: gx, y: gy };
}
