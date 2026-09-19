/**
 * Hex terrain: one hexagon per simulation cell, baked into chunk bitmaps.
 *
 * A tile is its biome colour with a light seeded variation, a relief bevel (light from the
 * north-west on edges above lower ground, shade on the opposite side), coast foam, farmland,
 * rivers and roads linking hex centres, a light territory tint and standing decorations (trees,
 * hills, peaks, dunes). The grid outline is not baked: it is drawn per frame and only when zoomed in.
 */
import { drawTree } from "../building-renderer";
import {
  BIOME_TOP,
  PALETTE,
  fertilityColor,
  hexToRgb,
  mix,
  mixRgb,
  rgbToCss,
  shade,
  shadeRgb,
  withAlpha,
} from "../color-palette";
import type { Rect } from "../projection";
import { hashInts, unitFloat } from "../seeded";
import type { ChunkInfo } from "../terrain-renderer";
import { drawHill, drawPeak } from "../tile-renderer";
import type { MapCellViewModel, MapLayerVisibility, RegionViewModel } from "../types";
import { ZOOM } from "../visibility";
import type { HexGrid, Point } from "./geometry";
import { linkDirections } from "./hex-links";

export interface HexTerrainContext {
  grid: HexGrid;
  cells: MapCellViewModel[];
  regions: RegionViewModel[];
  layers: MapLayerVisibility;
  /** Relief level actually drawn per cell (flat when the relief layer is off). */
  elevation: Int8Array;
  /** Cells taken by a settlement: no trees there. */
  cleared: Uint8Array;
  /** Edge masks of river and road links (see hex-links.ts). */
  rivers: Uint8Array;
  roads: Uint8Array;
  /** Detail scale (zoom × pixel ratio the bitmap is drawn for). */
  detail: number;
}

export const HEX_CHUNK_SIZE = 16;
/** Headroom above a row for peaks and tree canopies (world pixels). */
export const HEX_DECORATION_HEADROOM = 34;

/** Chunk grid over the hex map, ordered top to bottom so lower decorations overlap upper tiles. */
export function hexChunkGrid(grid: HexGrid): ChunkInfo[] {
  const out: ChunkInfo[] = [];
  const cols = Math.ceil(grid.width / HEX_CHUNK_SIZE);
  const rows = Math.ceil(grid.height / HEX_CHUNK_SIZE);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * HEX_CHUNK_SIZE;
      const y0 = cy * HEX_CHUNK_SIZE;
      const x1 = Math.min(grid.width, x0 + HEX_CHUNK_SIZE);
      const y1 = Math.min(grid.height, y0 + HEX_CHUNK_SIZE);
      const left = grid.center(x0, 0).x - grid.colStep / 2 - 2;
      const right = grid.center(x1 - 1, 1).x + grid.colStep / 2 + 2;
      const top = grid.center(0, y0).y - grid.size - HEX_DECORATION_HEADROOM;
      const bottom = grid.center(0, y1 - 1).y + grid.size + 4;
      out.push({
        cx,
        cy,
        x0,
        y0,
        x1,
        y1,
        rect: { x: left, y: top, width: right - left, height: bottom - top },
      });
    }
  }
  return out;
}

/** Signature of everything a chunk's bitmap depends on (cells plus a one-cell ring around it). */
export function hexChunkSignature(chunk: ChunkInfo, tc: HexTerrainContext, layerKey: number): number {
  let h = layerKey >>> 0;
  const { grid } = tc;
  for (let y = chunk.y0 - 1; y <= chunk.y1; y++) {
    for (let x = chunk.x0 - 1; x <= chunk.x1; x++) {
      if (!grid.inBounds(x, y)) continue;
      const i = grid.index(x, y);
      const c = tc.cells[i];
      if (!c) continue;
      h = hashInts(
        h,
        c.region,
        (tc.elevation[i] ?? 0) |
          ((tc.rivers[i] ?? 0) << 4) |
          ((tc.roads[i] ?? 0) << 10) |
          ((tc.cleared[i] ?? 0) << 16),
        c.fields * 8 + c.pastures,
        Math.round(c.fertility * 16) * 32 + Math.round(c.temperature * 16),
        c.biome.charCodeAt(0) + c.biome.charCodeAt(2),
      );
    }
  }
  return h;
}

const isWater = (c: MapCellViewModel | undefined) => c?.biome === "ocean";

function neighbour(tc: HexTerrainContext, c: MapCellViewModel, d: number): MapCellViewModel | undefined {
  const n = tc.grid.neighbor(c.x, c.y, d);
  return tc.grid.inBounds(n.x, n.y) ? tc.cells[tc.grid.index(n.x, n.y)] : undefined;
}

/** Temperature ramp for the climate lens: cold blue → temperate → hot orange. */
export function climateColor(t: number): string {
  return t < 0.5 ? mix("#4f86c6", "#e8e2b0", t * 2) : mix("#e8e2b0", "#d9622b", (t - 0.5) * 2);
}

/** Fill colour of a hex. */
export function hexTileColor(tc: HexTerrainContext, c: MapCellViewModel): string {
  if (isWater(c)) {
    if (!tc.layers.water) return "#22343c";
    const depth = Math.max(0, Math.min(1, c.altitude / 0.34));
    let nearLand = false;
    for (let d = 0; d < 6 && !nearLand; d++) {
      const n = neighbour(tc, c, d);
      nearLand = n !== undefined && !isWater(n);
    }
    const base = mixRgb(hexToRgb(PALETTE.deepWater), hexToRgb(BIOME_TOP.ocean), depth);
    const col = nearLand ? mixRgb(base, hexToRgb(PALETTE.shallowWater), 0.5) : base;
    return rgbToCss(shadeRgb(col, 0.97 + c.noise * 0.06));
  }
  if (!tc.layers.terrain) return shade("#77807a", 0.9 + c.noise * 0.1);
  let col = hexToRgb(BIOME_TOP[c.biome]);
  if (c.biome === "plains") col = mixRgb(col, hexToRgb("#a9a95a"), Math.max(0, 0.5 - c.moisture) * 0.6);
  if (c.temperature < 0.2 && c.biome !== "desert" && c.biome !== "tundra") {
    col = mixRgb(col, hexToRgb(PALETTE.snow), 0.3);
  }
  const e = tc.elevation[c.index] ?? 1;
  const light = 0.93 + (tc.layers.elevation ? (e - 1) * 0.028 : 0) + (c.noise - 0.5) * 0.07;
  return rgbToCss(shadeRgb(col, light));
}

function hexPath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** Point inside the hex: `(u, v)` in -1..1 relative to the half width and half height. */
function inHex(tc: HexTerrainContext, center: Point, u: number, v: number): Point {
  return { x: center.x + (u * tc.grid.colStep) / 2, y: center.y + v * tc.grid.size * 0.75 };
}

/** Edges facing the light (W, NW, NE) and away from it (E, SE, SW). */
const LIT_EDGES = new Set([3, 4, 5]);

export function drawHexTile(ctx: CanvasRenderingContext2D, tc: HexTerrainContext, i: number) {
  const c = tc.cells[i];
  if (!c) return;
  const { grid, layers } = tc;
  const center = grid.center(c.x, c.y);
  const corners = grid.cellCorners(c.x, c.y);
  const fill = hexTileColor(tc, c);

  hexPath(ctx, corners);
  ctx.fillStyle = fill;
  ctx.fill();
  // A hairline in the tile's own colour hides anti-aliasing seams between neighbours.
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(0.8, 1.2 / Math.max(tc.detail, 0.05));
  ctx.stroke();

  if (layers.climate) {
    hexPath(ctx, corners);
    ctx.fillStyle = withAlpha(climateColor(c.temperature), 0.5);
    ctx.fill();
  }

  if (isWater(c)) {
    if (layers.water) drawWaterDetail(ctx, tc, c, center);
  } else {
    if (layers.elevation) drawRelief(ctx, tc, c, center);
    if (layers.fertility) {
      hexPath(ctx, corners);
      ctx.fillStyle = withAlpha(fertilityColor(c.fertility), 0.55);
      ctx.fill();
    }
    if (tc.detail >= ZOOM.fields && (c.fields > 0 || c.pastures > 0)) drawFarmland(ctx, tc, c, center);
    if (layers.rivers && c.river) drawRiver(ctx, tc, c, center);
    if (layers.roads && c.road && tc.detail >= ZOOM.roads) drawRoad(ctx, tc, c, center);
  }

  if (layers.territories && c.region >= 0) {
    const region = tc.regions[c.region];
    if (region) {
      hexPath(ctx, corners);
      ctx.fillStyle = withAlpha(region.color, isWater(c) ? 0.1 : 0.17);
      ctx.fill();
    }
  }
}

/** Bevel along edges above lower ground: a light rim facing the sun, a shade on the far side. */
function drawRelief(
  ctx: CanvasRenderingContext2D,
  tc: HexTerrainContext,
  c: MapCellViewModel,
  center: Point,
) {
  const e = tc.elevation[c.index] ?? 1;
  for (let d = 0; d < 6; d++) {
    const n = neighbour(tc, c, d);
    const ne = n ? (tc.elevation[n.index] ?? 0) : 0;
    const diff = e - ne;
    if (diff <= 0) continue;
    const [a, b] = tc.grid.edge(c.x, c.y, d);
    const k = Math.min(0.26, 0.1 + diff * 0.04);
    const a2 = { x: a.x + (center.x - a.x) * k, y: a.y + (center.y - a.y) * k };
    const b2 = { x: b.x + (center.x - b.x) * k, y: b.y + (center.y - b.y) * k };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fillStyle = LIT_EDGES.has(d)
      ? `rgba(255, 244, 214, ${Math.min(0.22, 0.07 + diff * 0.03)})`
      : `rgba(12, 16, 12, ${Math.min(0.32, 0.1 + diff * 0.05)})`;
    ctx.fill();
  }
}

function drawWaterDetail(
  ctx: CanvasRenderingContext2D,
  tc: HexTerrainContext,
  c: MapCellViewModel,
  center: Point,
) {
  ctx.strokeStyle = withAlpha(PALETTE.foam, 0.5);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let d = 0; d < 6; d++) {
    const n = neighbour(tc, c, d);
    if (!n || isWater(n)) continue;
    const [a, b] = tc.grid.edge(c.x, c.y, d);
    // Foam sits a little inside the water hex.
    const k = 0.08;
    ctx.moveTo(a.x + (center.x - a.x) * k, a.y + (center.y - a.y) * k);
    ctx.lineTo(b.x + (center.x - b.x) * k, b.y + (center.y - b.y) * k);
  }
  ctx.stroke();
  if (tc.detail >= 0.45 && c.noise > 0.72) {
    const p = inHex(tc, center, -0.2 + c.noise * 0.3, 0);
    ctx.strokeStyle = "rgba(210, 235, 240, 0.22)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y);
    ctx.quadraticCurveTo(p.x - 3, p.y - 2.5, p.x, p.y);
    ctx.quadraticCurveTo(p.x + 3, p.y + 2.5, p.x + 6, p.y);
    ctx.stroke();
  }
}

/** Small rhomb patches (fields with furrows, fenced pastures) around the hex centre. */
function drawFarmland(
  ctx: CanvasRenderingContext2D,
  tc: HexTerrainContext,
  c: MapCellViewModel,
  center: Point,
) {
  const patches = Math.min(4, c.fields + c.pastures);
  const spots: [number, number][] = [
    [-0.42, -0.35],
    [0.42, -0.35],
    [-0.42, 0.4],
    [0.42, 0.4],
  ];
  const start = Math.floor(c.noise * 4);
  const hx = tc.grid.colStep * 0.17;
  const hy = hx * 0.5;
  for (let k = 0; k < patches; k++) {
    const [u, v] = spots[(start + k) % 4] ?? [0, 0];
    const p = inHex(tc, center, u, v);
    const isField = k < c.fields;
    const pts = [
      { x: p.x, y: p.y - hy },
      { x: p.x + hx, y: p.y },
      { x: p.x, y: p.y + hy },
      { x: p.x - hx, y: p.y },
    ];
    hexPath(ctx, pts);
    ctx.fillStyle = isField ? (k % 2 ? PALETTE.fieldAlt : PALETTE.field) : PALETTE.pasture;
    ctx.fill();
    ctx.strokeStyle = isField ? "rgba(110, 86, 40, 0.45)" : "rgba(90, 110, 60, 0.5)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    if (isField) {
      for (let r = 1; r < 4; r++) {
        const t = r / 4;
        ctx.moveTo(p.x - hx + hx * t, p.y - hy * t);
        ctx.lineTo(p.x + hx * t, p.y + hy - hy * t);
      }
    } else {
      pts.forEach((q, n) => (n === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
    }
    ctx.stroke();
  }
}

/** Curves from the hex centre to the midpoints of the linked edges. */
function drawLinks(
  ctx: CanvasRenderingContext2D,
  tc: HexTerrainContext,
  c: MapCellViewModel,
  center: Point,
  links: number[],
  width: number,
  color: string,
  edge: string,
) {
  if (!links.length) return;
  const ends = links.map((d) => {
    const [a, b] = tc.grid.edge(c.x, c.y, d);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
  for (const [w, col] of [
    [width + 1.2, edge],
    [width, color],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (ends.length === 2) {
      // A pass-through reads better as one smooth curve bending around the centre.
      const [p, q] = ends as [Point, Point];
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(center.x, center.y, q.x, q.y);
    } else {
      for (const p of ends) {
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }
}

function drawRiver(ctx: CanvasRenderingContext2D, tc: HexTerrainContext, c: MapCellViewModel, center: Point) {
  drawLinks(
    ctx,
    tc,
    c,
    center,
    linkDirections(tc.rivers[c.index] ?? 0),
    3.4,
    PALETTE.river,
    PALETTE.riverEdge,
  );
}

function drawRoad(ctx: CanvasRenderingContext2D, tc: HexTerrainContext, c: MapCellViewModel, center: Point) {
  drawLinks(
    ctx,
    tc,
    c,
    center,
    linkDirections(tc.roads[c.index] ?? 0),
    2.2,
    PALETTE.road,
    withAlpha(PALETTE.roadEdge, 0.7),
  );
}

/** True for hexes whose decorations are tall enough to stand in front of a building. */
export function hexHasTallDecoration(c: MapCellViewModel, cleared: boolean): boolean {
  return c.biome === "mountain" || c.biome === "hills" || (c.biome === "forest" && !cleared);
}

/** Trees, hills, dunes and peaks standing on the hex. */
export function drawHexDecorations(ctx: CanvasRenderingContext2D, tc: HexTerrainContext, i: number) {
  const c = tc.cells[i];
  if (!c || !tc.layers.terrain || isWater(c)) return;
  const center = tc.grid.center(c.x, c.y);
  const seed = hashInts(c.x, c.y, 7);
  const rnd = (k: number) => unitFloat(hashInts(seed, k));

  if (c.biome === "mountain") {
    drawPeak(
      ctx,
      inHex(tc, center, -0.05, 0.35),
      1.05 + rnd(1) * 0.3,
      c.altitude > 0.88 || c.temperature < 0.35,
    );
    if (tc.detail >= 0.5 && rnd(2) > 0.4) drawPeak(ctx, inHex(tc, center, 0.45, 0.6), 0.62, false);
    if (tc.detail >= 0.5 && rnd(3) > 0.6) drawPeak(ctx, inHex(tc, center, -0.5, 0.65), 0.55, false);
    return;
  }
  if (c.biome === "hills") {
    drawHill(ctx, inHex(tc, center, -0.25 + rnd(1) * 0.2, 0.1 + rnd(4) * 0.3), 0.75 + rnd(5) * 0.35);
    if (tc.detail >= 0.5 && rnd(2) > 0.5) drawHill(ctx, inHex(tc, center, 0.4, 0.55), 0.5);
    return;
  }
  if (c.biome === "desert" && tc.detail >= 0.4) {
    const p = center;
    ctx.strokeStyle = "rgba(150, 110, 50, 0.45)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x - 12, p.y + 2);
    ctx.quadraticCurveTo(p.x - 4, p.y - 5, p.x + 5, p.y + 1);
    ctx.moveTo(p.x - 3, p.y + 8);
    ctx.quadraticCurveTo(p.x + 6, p.y + 2, p.x + 13, p.y + 6);
    ctx.stroke();
    return;
  }
  if (tc.cleared[i]) return;
  const forest = c.biome === "forest";
  const scattered =
    (c.biome === "plains" && c.wood >= 22 && rnd(9) > 0.55) || (c.biome === "tundra" && rnd(9) > 0.8);
  if (!forest && !scattered) return;
  if (tc.detail < ZOOM.trees) {
    if (!forest) return;
    ctx.fillStyle = shade(PALETTE.conifer, 0.95);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y - 2, tc.grid.colStep * 0.32, tc.grid.size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const conifer = c.temperature < 0.45 || c.biome === "tundra";
  const snowy = c.temperature < 0.22;
  const count = forest ? (tc.detail >= 0.6 ? 6 : 4) : 1;
  const spots: { u: number; v: number; k: number }[] = [];
  for (let k = 0; k < count; k++)
    spots.push({ u: -0.6 + rnd(k * 2 + 11) * 1.2, v: -0.5 + rnd(k * 2 + 12) * 1.15, k });
  // Back to front: trees further up are drawn first.
  spots.sort((a, b) => a.v - b.v);
  for (const s of spots) {
    const p = inHex(tc, center, s.u, s.v);
    drawTree(ctx, p.x, p.y, forest ? 1 : 0.85, conifer, rnd(s.k + 40), snowy);
  }
}

/**
 * Tiles of a chunk, row by row (top to bottom), then their decorations in the same order.
 * A one-cell apron around the chunk is drawn too: the neighbours' tiles and decorations are the
 * same pixels the neighbouring chunk draws, so each bitmap is opaque up to its edge and no seam
 * of anti-aliased edges can show between two chunk bitmaps.
 */
export function drawHexChunk(ctx: CanvasRenderingContext2D, chunk: ChunkInfo, tc: HexTerrainContext) {
  const { grid } = tc;
  for (let y = chunk.y0 - 1; y <= chunk.y1; y++) {
    for (let x = chunk.x0 - 1; x <= chunk.x1; x++)
      if (grid.inBounds(x, y)) drawHexTile(ctx, tc, grid.index(x, y));
  }
  for (let y = chunk.y0 - 1; y <= chunk.y1; y++) {
    for (let x = chunk.x0 - 1; x <= chunk.x1; x++)
      if (grid.inBounds(x, y)) drawHexDecorations(ctx, tc, grid.index(x, y));
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
