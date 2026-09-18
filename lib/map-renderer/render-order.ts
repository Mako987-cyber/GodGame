/**
 * Render order.
 *
 * Passes are drawn in the order below; inside the depth-sorted passes, items further back
 * (smaller gridX + gridY) are drawn first, so something in front always covers what is behind.
 */
export const RENDER_PASSES = [
  "background",
  "deepWater",
  "terrain",
  "elevation",
  "rivers",
  "roads",
  "territory",
  "resources",
  "buildings",
  "settlements",
  "units",
  "tradeRoutes",
  "selection",
  "overlay",
] as const;

export type RenderPass = (typeof RENDER_PASSES)[number];

export function passIndex(pass: RenderPass): number {
  return RENDER_PASSES.indexOf(pass);
}

/**
 * Sprites that share the depth-sorted entity pass. Within the same depth, ground-level things
 * go first so a building standing on a redrawn tile is not hidden by that tile.
 */
export const SPRITE_KIND_ORDER = {
  tile: 0,
  ground: 1,
  wall: 2,
  object: 3,
  marker: 4,
} as const;

export type SpriteKind = keyof typeof SPRITE_KIND_ORDER;

export interface DepthSortable {
  /** Continuous grid coordinates of the sprite's ground anchor (front-most footprint point). */
  gx: number;
  gy: number;
  kind: SpriteKind;
  /** Final tie-breaker so sorting is stable across runs. */
  order: number;
}

/** Isometric depth of a grid position: larger means closer to the viewer. */
export function isoDepth(gx: number, gy: number): number {
  return gx + gy;
}

/**
 * Sprites are ordered by the cell they stand on first, then by kind, then by exact depth.
 * Ordering by cell keeps a redrawn terrain tile ("tile" kind) behind everything standing on it
 * and in front of everything standing on the cells behind it.
 */
export function compareDepth(a: DepthSortable, b: DepthSortable): number {
  const ca = Math.floor(a.gx) + Math.floor(a.gy);
  const cb = Math.floor(b.gx) + Math.floor(b.gy);
  if (ca !== cb) return ca - cb;
  const ka = SPRITE_KIND_ORDER[a.kind];
  const kb = SPRITE_KIND_ORDER[b.kind];
  if (ka !== kb) return ka - kb;
  const da = isoDepth(a.gx, a.gy);
  const db = isoDepth(b.gx, b.gy);
  if (Math.abs(da - db) > 1e-9) return da - db;
  // Same depth: the order along the diagonal is arbitrary but must be stable.
  if (Math.abs(a.gx - b.gx) > 1e-9) return a.gx - b.gx;
  return a.order - b.order;
}

export function sortByDepth<T extends DepthSortable>(items: T[]): T[] {
  return items.sort(compareDepth);
}

/** Cell indices of a width × height grid in back-to-front drawing order. */
export function tileDrawOrder(width: number, height: number): number[] {
  const out: number[] = [];
  for (let d = 0; d <= width + height - 2; d++) {
    for (let x = Math.max(0, d - height + 1); x <= Math.min(d, width - 1); x++) {
      out.push((d - x) * width + x);
    }
  }
  return out;
}
