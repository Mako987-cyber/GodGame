/**
 * Hex territory borders.
 *
 * For every owned hex, each of its six edges is kept only when the neighbour across it has a
 * different owner (or lies outside the map). Kept edges are oriented clockwise around their own
 * hex, so consecutive edges of the same boundary chain end-to-start and can be merged into long
 * polylines: a region of hundreds of hexes becomes a handful of strokes.
 */
import type { HexGrid, Point } from "./geometry";

export interface HexBorderRun {
  /** Owner on the inner side of the run. */
  region: number;
  /** Owner on the outer side (-1 for unclaimed land or the map edge). */
  other: number;
  /** Border with a region the owner is at war with. */
  contested: boolean;
  /** World-space points, clockwise around the owner: the owner lies on the right-hand side. */
  points: Point[];
  closed: boolean;
}

interface Edge {
  region: number;
  other: number;
  contested: boolean;
  a: Point;
  b: Point;
  used: boolean;
}

const key = (p: Point) => `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;

/**
 * Boundary edges of `owner` (row-major, -1 = unclaimed) where `keep(region, other)` holds.
 * `contested(region, other)` flags edges shared with an enemy.
 */
export function hexBoundaryEdges(
  grid: HexGrid,
  owner: ArrayLike<number>,
  keep: (region: number, other: number) => boolean = (r, o) => r !== o,
  contested: (region: number, other: number) => boolean = () => false,
): Omit<Edge, "used">[] {
  const edges: Omit<Edge, "used">[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const region = owner[grid.index(x, y)] ?? -1;
      if (region < 0) continue;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(x, y, d);
        const other = grid.inBounds(n.x, n.y) ? (owner[grid.index(n.x, n.y)] ?? -1) : -1;
        if (other === region || !keep(region, other)) continue;
        const [a, b] = grid.edge(x, y, d);
        edges.push({ region, other, contested: other >= 0 && contested(region, other), a, b });
      }
    }
  }
  return edges;
}

/** Chains edges with the same region and contested flag into polylines. */
export function mergeHexEdges(raw: Omit<Edge, "used">[]): HexBorderRun[] {
  const edges: Edge[] = raw.map((e) => ({ ...e, used: false }));
  const byStart = new Map<string, Edge[]>();
  const byEnd = new Map<string, Edge[]>();
  for (const e of edges) {
    const s = `${e.region}|${e.contested ? 1 : 0}|${key(e.a)}`;
    const t = `${e.region}|${e.contested ? 1 : 0}|${key(e.b)}`;
    (byStart.get(s) ?? byStart.set(s, []).get(s)!).push(e);
    (byEnd.get(t) ?? byEnd.set(t, []).get(t)!).push(e);
  }
  const group = (e: Edge) => `${e.region}|${e.contested ? 1 : 0}|`;
  const nextOf = (e: Edge) => byStart.get(group(e) + key(e.b))?.find((n) => !n.used) ?? null;
  const prevOf = (e: Edge) => byEnd.get(group(e) + key(e.a))?.find((p) => !p.used) ?? null;

  const runs: HexBorderRun[] = [];
  for (const seed of edges) {
    if (seed.used) continue;
    seed.used = true;
    // Walk back to the start of an open chain, then forward to its end.
    let first = seed;
    const back: Edge[] = [];
    for (let p = prevOf(first); p; p = prevOf(first)) {
      p.used = true;
      back.push(p);
      first = p;
    }
    const chain: Edge[] = [...back.reverse(), seed];
    let last = seed;
    for (let n = nextOf(last); n; n = nextOf(last)) {
      n.used = true;
      chain.push(n);
      last = n;
    }
    const points = [chain[0]!.a, ...chain.map((e) => e.b)];
    const closed = key(points[0]!) === key(points[points.length - 1]!);
    if (closed) points.pop();
    runs.push({
      region: seed.region,
      // A merged run can face several neighbours; the most common one is kept for styling.
      other: mostCommon(chain.map((e) => e.other)),
      contested: seed.contested,
      points,
      closed,
    });
  }
  return runs;
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0] ?? -1;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function computeHexBorders(
  grid: HexGrid,
  owner: ArrayLike<number>,
  isContested: (a: number, b: number) => boolean = () => false,
): HexBorderRun[] {
  return mergeHexEdges(hexBoundaryEdges(grid, owner, (r, o) => r !== o, isContested));
}

/** Edges where owner `a` touches owner `b` (a war front), merged into runs. */
export function hexSharedEdges(
  grid: HexGrid,
  owner: ArrayLike<number>,
  a: number,
  b: number,
): HexBorderRun[] {
  return mergeHexEdges(hexBoundaryEdges(grid, owner, (r, o) => r === a && o === b));
}

/**
 * Polyline shifted by `distance` towards the right-hand side (the owner's interior for runs built
 * here). Joins use the averaged normal, which is exact enough for the 120° corners of hexagons.
 */
export function insetPolyline(points: Point[], closed: boolean, distance: number): Point[] {
  const n = points.length;
  if (n < 2 || distance === 0) return points;
  const normal = (p: Point, q: Point) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand normal in a y-down space.
    return { x: -dy / len, y: dx / len };
  };
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const prev = i > 0 ? points[i - 1] : closed ? points[n - 1] : undefined;
    const next = i < n - 1 ? points[i + 1] : closed ? points[0] : undefined;
    const n1 = prev ? normal(prev, p) : null;
    const n2 = next ? normal(p, next) : null;
    let nx = (n1?.x ?? 0) + (n2?.x ?? 0);
    let ny = (n1?.y ?? 0) + (n2?.y ?? 0);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // Miter length so both segments stay `distance` away (bounded for very sharp turns).
    const cos = n1 && n2 ? Math.max(0.5, n1.x * nx + n1.y * ny) : 1;
    out.push({ x: p.x + (nx * distance) / cos, y: p.y + (ny * distance) / cos });
  }
  return out;
}
