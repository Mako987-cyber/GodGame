/**
 * Territory borders.
 *
 * Borders are extracted only where the owner changes between neighbouring cells, then collinear
 * edges of the same region are merged into long runs: a region of hundreds of cells becomes a
 * few dozen strokes instead of one outline per cell.
 */
import { PALETTE, withAlpha } from "./color-palette";
import { gridToScreen, type IsoProjectionConfig } from "./projection";
import type { BorderPolyline } from "./types";

type Direction = 0 | 1 | 2 | 3; // north, east, south, west

export interface BorderGrid {
  width: number;
  height: number;
  /** Owner per cell (row-major), -1 when unclaimed. */
  owner: ArrayLike<number>;
  elevation: ArrayLike<number>;
}

interface RawEdge {
  region: number;
  dir: Direction;
  /** Fixed coordinate of the edge line (y for north/south, x for east/west). */
  line: number;
  /** Running start coordinate along the line. */
  start: number;
  elevation: number;
  contested: boolean;
}

const NEIGHBOURS: [Direction, number, number][] = [
  [0, 0, -1],
  [1, 1, 0],
  [2, 0, 1],
  [3, -1, 0],
];

/**
 * Cell edges where `keep(owner, neighbourOwner)` holds. Edges touching the map border count as
 * facing owner -1.
 */
function rawEdges(
  grid: BorderGrid,
  keep: (region: number, other: number) => boolean,
  isContested: (a: number, b: number) => boolean,
): RawEdge[] {
  const { width, height, owner, elevation } = grid;
  const edges: RawEdge[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = owner[i] ?? -1;
      if (r < 0) continue;
      for (const [dir, dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
        const other = inside ? (owner[ny * width + nx] ?? -1) : -1;
        if (other === r || !keep(r, other)) continue;
        const horizontal = dir === 0 || dir === 2;
        edges.push({
          region: r,
          dir,
          line: horizontal ? y + (dir === 2 ? 1 : 0) : x + (dir === 1 ? 1 : 0),
          start: horizontal ? x : y,
          elevation: elevation[i] ?? 0,
          contested: other >= 0 && isContested(r, other),
        });
      }
    }
  }
  return edges;
}

function mergeEdges(edges: RawEdge[]): BorderPolyline[] {
  edges.sort(
    (a, b) =>
      a.region - b.region ||
      a.dir - b.dir ||
      a.line - b.line ||
      Number(a.contested) - Number(b.contested) ||
      a.elevation - b.elevation ||
      a.start - b.start,
  );
  const out: BorderPolyline[] = [];
  let run: { edge: RawEdge; end: number } | null = null;
  const flush = () => {
    if (!run) return;
    const { edge, end } = run;
    const horizontal = edge.dir === 0 || edge.dir === 2;
    out.push({
      points: horizontal
        ? [
            { x: edge.start, y: edge.line },
            { x: end, y: edge.line },
          ]
        : [
            { x: edge.line, y: edge.start },
            { x: edge.line, y: end },
          ],
      elevation: edge.elevation,
      region: edge.region,
      contested: edge.contested,
      // North and west edges lie on the cell's own row/column: the region is on the positive side.
      side: edge.dir === 0 || edge.dir === 3 ? 1 : -1,
    });
    run = null;
  };
  for (const e of edges) {
    const r: { edge: RawEdge; end: number } | null = run;
    if (
      r &&
      r.edge.region === e.region &&
      r.edge.dir === e.dir &&
      r.edge.line === e.line &&
      r.edge.contested === e.contested &&
      r.edge.elevation === e.elevation &&
      r.end === e.start
    ) {
      r.end = e.start + 1;
      continue;
    }
    flush();
    run = { edge: e, end: e.start + 1 };
  }
  flush();
  return out;
}

/** Number of raw cell edges on region boundaries (before merging); exposed for tests and debug. */
export function countRawBorderEdges(grid: BorderGrid): number {
  return rawEdges(
    grid,
    () => true,
    () => false,
  ).length;
}

/** Border runs per region, merged along straight lines. */
export function computeBorders(
  grid: BorderGrid,
  isContested: (a: number, b: number) => boolean = () => false,
): BorderPolyline[] {
  return mergeEdges(rawEdges(grid, () => true, isContested));
}

/** Edges where owner `a` touches owner `b` (a front line), merged into straight runs on a's side. */
export function sharedEdges(grid: BorderGrid, a: number, b: number): BorderPolyline[] {
  return mergeEdges(
    rawEdges(
      grid,
      (r, other) => r === a && other === b,
      () => true,
    ),
  );
}

export interface BorderStyle {
  color: (region: number) => string;
  zoom: number;
  /** Highlighted region (selected civilization or tribe), drawn stronger; -1 for none. */
  highlight: number;
}

/**
 * Draws border runs in world space. Each run is shifted half a stroke towards its own region, so
 * two neighbours' borders sit side by side instead of overdrawing each other.
 */
export function drawBorders(
  ctx: CanvasRenderingContext2D,
  borders: BorderPolyline[],
  config: IsoProjectionConfig,
  style: BorderStyle,
) {
  const px = 1 / style.zoom;
  // Borders fade in with zoom: at overview the territory fill already carries the information.
  const alpha = Math.max(0.5, Math.min(0.9, 0.4 + style.zoom * 0.5));
  // Screen direction of the grid axes, used to push each run inside its region.
  const axisX = unit(config.tileWidth / 2, config.tileHeight / 2);
  const axisY = unit(-config.tileWidth / 2, config.tileHeight / 2);
  ctx.lineCap = "butt";
  for (const b of borders) {
    const [p0, p1] = b.points;
    if (!p0 || !p1) continue;
    const strong = b.region === style.highlight;
    const width = (b.contested ? 3 : strong ? 2.6 : 1.5) * px;
    const a = gridToScreen(p0.x, p0.y, b.elevation, config);
    const c = gridToScreen(p1.x, p1.y, b.elevation, config);
    const axis = p0.y === p1.y ? axisY : axisX;
    const off = (width / 2) * b.side;
    ctx.strokeStyle = b.contested
      ? withAlpha(PALETTE.war, 0.95)
      : withAlpha(style.color(b.region), strong ? 1 : alpha);
    ctx.lineWidth = width;
    ctx.setLineDash(b.contested ? [6 * px, 4 * px] : []);
    ctx.beginPath();
    ctx.moveTo(a.x + axis.x * off, a.y + axis.y * off);
    ctx.lineTo(c.x + axis.x * off, c.y + axis.y * off);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function unit(x: number, y: number) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}
