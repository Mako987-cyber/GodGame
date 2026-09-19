/**
 * Hexagonal geometry for the map view.
 *
 * Convention (single source of truth, see docs in README "Mappa esagonale"):
 * - **Pointy-top** hexagons, rows are horizontal.
 * - The simulation keeps its square grid: a cell `(x, y)` is the hex at offset
 *   `(col = x, row = y)` in the **odd-r** layout (odd rows are pushed right by half a hex).
 * - Rendering, distance, neighbours and picking work in **axial** coordinates `(q, r)`;
 *   cube coordinates `(x, y, z)` with `x + y + z = 0` are used for rounding and distance.
 * - World space: pixels at zoom 1, hex centre `(q, r)` at
 *   `x = size·√3·(q + r/2)`, `y = size·3/2·r`; `size` is the circumradius.
 * - Map edges are not wrapped: cells outside `0..width-1 × 0..height-1` do not exist.
 *
 * Nothing here knows about Canvas, React or the simulation.
 */

export type HexOrientation = "pointy" | "flat";
export type OffsetLayout = "even-q" | "odd-q" | "even-r" | "odd-r";

export interface AxialCoord {
  q: number;
  r: number;
}

export interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

export interface OffsetCoord {
  col: number;
  row: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Layout used by the map: the legacy grid (x, y) is (col, row) of an odd-r pointy-top map. */
export const MAP_OFFSET_LAYOUT: OffsetLayout = "odd-r";
export const MAP_ORIENTATION: HexOrientation = "pointy";
/** Circumradius of a hex in world pixels (≈ 62 px wide, like the 64 px isometric tiles). */
export const HEX_SIZE = 36;

const SQRT3 = Math.sqrt(3);

// `x & 1` is 1 for odd numbers, including negatives in two's complement.
const parity = (n: number) => n & 1;

export function offsetToAxial(col: number, row: number, layout: OffsetLayout): AxialCoord {
  switch (layout) {
    case "odd-r":
      return { q: col - (row - parity(row)) / 2, r: row };
    case "even-r":
      return { q: col - (row + parity(row)) / 2, r: row };
    case "odd-q":
      return { q: col, r: row - (col - parity(col)) / 2 };
    case "even-q":
      return { q: col, r: row - (col + parity(col)) / 2 };
  }
}

export function axialToOffset(coord: AxialCoord, layout: OffsetLayout): OffsetCoord {
  const { q, r } = coord;
  switch (layout) {
    case "odd-r":
      return { col: q + (r - parity(r)) / 2, row: r };
    case "even-r":
      return { col: q + (r + parity(r)) / 2, row: r };
    case "odd-q":
      return { col: q, row: r + (q - parity(q)) / 2 };
    case "even-q":
      return { col: q, row: r + (q + parity(q)) / 2 };
  }
}

export function axialToCube({ q, r }: AxialCoord): CubeCoord {
  return { x: q, y: -q - r, z: r };
}

export function cubeToAxial({ x, z }: CubeCoord): AxialCoord {
  return { q: x, r: z };
}

/** Nearest hex to fractional axial coordinates (cube rounding). */
export function axialRound(q: number, r: number): AxialCoord {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // Normalise -0 so results compare equal with toEqual.
  return { q: rx + 0, r: rz + 0 };
}

export function axialToWorld(coord: AxialCoord, tileSize: number, orientation: HexOrientation): Point {
  const { q, r } = coord;
  if (orientation === "pointy") return { x: tileSize * SQRT3 * (q + r / 2), y: tileSize * 1.5 * r };
  return { x: tileSize * 1.5 * q, y: tileSize * SQRT3 * (r + q / 2) };
}

/** World point to the hex containing it. */
export function worldToAxial(
  x: number,
  y: number,
  tileSize: number,
  orientation: HexOrientation,
): AxialCoord {
  if (orientation === "pointy") {
    const q = ((SQRT3 / 3) * x - y / 3) / tileSize;
    const r = ((2 / 3) * y) / tileSize;
    return axialRound(q, r);
  }
  const q = ((2 / 3) * x) / tileSize;
  const r = (-x / 3 + (SQRT3 / 3) * y) / tileSize;
  return axialRound(q, r);
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Axial directions in the order of the pointy-top edges: E, SE, SW, W, NW, NE.
 * Edge `d` of a hex joins corners `d` and `d + 1` (see `hexCorners`) and faces neighbour `d`.
 */
export const AXIAL_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export const DIRECTION_NAMES = ["E", "SE", "SW", "W", "NW", "NE"] as const;

export function axialNeighbors(coord: AxialCoord): AxialCoord[] {
  return AXIAL_DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/** Corners of a pointy-top hex centred at `center`: corner i at angle 60°·i − 30° (y grows down). */
export function hexCorners(center: Point, size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    out.push({ x: center.x + size * Math.cos(a), y: center.y + size * Math.sin(a) });
  }
  return out;
}

/** Corner offsets from the centre, computed once per size. */
export function cornerOffsets(size: number): Point[] {
  return hexCorners({ x: 0, y: 0 }, size);
}

/**
 * The map's hex grid: converts between the legacy (x, y) cells and world space, and answers
 * adjacency on the hex topology. One instance per map size.
 */
export class HexGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** Horizontal distance between neighbouring centres in a row. */
  readonly colStep: number;
  /** Vertical distance between rows. */
  readonly rowStep: number;
  /** World-space margin so every hex (including the shifted odd rows) sits at x, y ≥ 0. */
  readonly originX: number;
  readonly originY: number;
  readonly corners: Point[];

  constructor(width: number, height: number, size = HEX_SIZE) {
    this.width = width;
    this.height = height;
    this.size = size;
    this.colStep = SQRT3 * size;
    this.rowStep = 1.5 * size;
    this.originX = this.colStep / 2;
    this.originY = size;
    this.corners = cornerOffsets(size);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** World centre of legacy cell (x, y). */
  center(x: number, y: number): Point {
    return {
      x: this.originX + this.colStep * (x + 0.5 * parity(y)),
      y: this.originY + this.rowStep * y,
    };
  }

  /**
   * World position of a continuous grid point, interpolating between cell centres.
   * `(x + 0.5, y + 0.5)` is the centre of cell (x, y); used for cluster centroids and markers.
   */
  gridPoint(gx: number, gy: number): Point {
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const c = this.center(cx, cy);
    return { x: c.x + (gx - cx - 0.5) * this.colStep, y: c.y + (gy - cy - 0.5) * this.rowStep };
  }

  /** Legacy cell under a world point, or null outside the map. */
  cellAt(wx: number, wy: number): { x: number; y: number } | null {
    const axial = worldToAxial(wx - this.originX, wy - this.originY, this.size, "pointy");
    const { col, row } = axialToOffset(axial, MAP_OFFSET_LAYOUT);
    return this.inBounds(col, row) ? { x: col, y: row } : null;
  }

  toAxial(x: number, y: number): AxialCoord {
    return offsetToAxial(x, y, MAP_OFFSET_LAYOUT);
  }

  fromAxial(a: AxialCoord): { x: number; y: number } {
    const { col, row } = axialToOffset(a, MAP_OFFSET_LAYOUT);
    return { x: col, y: row };
  }

  /** Neighbour of (x, y) in direction d (0..5, see AXIAL_DIRECTIONS); may be outside the map. */
  neighbor(x: number, y: number, d: number): { x: number; y: number } {
    const a = this.toAxial(x, y);
    const dir = AXIAL_DIRECTIONS[((d % 6) + 6) % 6] ?? AXIAL_DIRECTIONS[0]!;
    return this.fromAxial({ q: a.q + dir.q, r: a.r + dir.r });
  }

  /** In-bounds neighbours with their direction. */
  neighbors(x: number, y: number): { x: number; y: number; d: number }[] {
    const out: { x: number; y: number; d: number }[] = [];
    for (let d = 0; d < 6; d++) {
      const n = this.neighbor(x, y, d);
      if (this.inBounds(n.x, n.y)) out.push({ ...n, d });
    }
    return out;
  }

  distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return hexDistance(this.toAxial(a.x, a.y), this.toAxial(b.x, b.y));
  }

  /** In-bounds cells within `radius` steps of (x, y), the centre included. */
  range(x: number, y: number, radius: number): { x: number; y: number }[] {
    const c = this.toAxial(x, y);
    const out: { x: number; y: number }[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const p = this.fromAxial({ q: c.q + dq, r: c.r + dr });
        if (this.inBounds(p.x, p.y)) out.push(p);
      }
    }
    return out;
  }

  /** World corners of cell (x, y). */
  cellCorners(x: number, y: number): Point[] {
    const c = this.center(x, y);
    return this.corners.map((k) => ({ x: c.x + k.x, y: c.y + k.y }));
  }

  /** World endpoints of edge d of cell (x, y) (the edge facing neighbour d). */
  edge(x: number, y: number, d: number): [Point, Point] {
    const c = this.center(x, y);
    const a = this.corners[d % 6] ?? { x: 0, y: 0 };
    const b = this.corners[(d + 1) % 6] ?? { x: 0, y: 0 };
    return [
      { x: c.x + a.x, y: c.y + a.y },
      { x: c.x + b.x, y: c.y + b.y },
    ];
  }

  /** Point-in-hexagon test (world space) for cell (x, y). */
  contains(wx: number, wy: number, x: number, y: number): boolean {
    const c = this.center(x, y);
    const dx = Math.abs(wx - c.x);
    const dy = Math.abs(wy - c.y);
    const h = this.colStep / 2;
    if (dx > h || dy > this.size) return false;
    // Slanted edges: the hexagon is the intersection of |x| ≤ h and |x|/√3 + |y| ≤ size.
    return dx / SQRT3 + dy <= this.size + 1e-9;
  }

  /** World-space bounds of the whole map. */
  bounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: 0,
      y: 0,
      width: this.originX * 2 + this.colStep * (this.width - 1) + this.colStep / 2,
      height: this.originY * 2 + this.rowStep * (this.height - 1),
    };
  }
}
