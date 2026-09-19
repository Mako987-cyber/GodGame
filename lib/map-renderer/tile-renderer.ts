/**
 * One terrain tile: walls, top face, water, territory tint, fields, rivers, roads and decorations
 * (trees, hills, peaks). Used both to bake terrain chunks and to redraw a tile in front of a
 * building, so the two always match pixel for pixel.
 */
import { drawTree } from "./building-renderer";
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
} from "./color-palette";
import { MAP_BASE_LEVEL, drawTileWalls } from "./elevation-renderer";
import { gridToScreen, tileCorners, type IsoProjectionConfig, type Point } from "./projection";
import { hashInts, unitFloat } from "./seeded";
import type { MapCellViewModel, MapLayerVisibility, RegionViewModel } from "./types";
import { ZOOM } from "./visibility";

export interface TerrainContext {
  width: number;
  height: number;
  cells: MapCellViewModel[];
  regions: RegionViewModel[];
  elevation: Int8Array;
  config: IsoProjectionConfig;
  layers: MapLayerVisibility;
  /** Cells cleared for a settlement: no trees are drawn there. */
  cleared: Uint8Array;
  /** Detail scale: the zoom × pixel ratio the tile is rendered for. */
  detail: number;
}

const EARTH = "#5b4a37";

function cellAt(tc: TerrainContext, x: number, y: number): MapCellViewModel | undefined {
  if (x < 0 || y < 0 || x >= tc.width || y >= tc.height) return undefined;
  return tc.cells[y * tc.width + x];
}

function levelAt(tc: TerrainContext, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= tc.width || y >= tc.height) return MAP_BASE_LEVEL;
  return tc.elevation[y * tc.width + x] ?? 0;
}

function isWater(c: MapCellViewModel | undefined): boolean {
  return c?.biome === "ocean";
}

/** Top-face colour of a cell, with a light seeded variation and brighter high ground. */
export function tileTopColor(tc: TerrainContext, c: MapCellViewModel): string {
  if (isWater(c)) {
    if (!tc.layers.water) return "#22343c";
    // Deeper water is darker; shallows near land lean to teal.
    const depth = Math.max(0, Math.min(1, c.altitude / 0.34));
    const nearLand = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx = 0, dy = 0]) => {
      const n = cellAt(tc, c.x + dx, c.y + dy);
      return n !== undefined && !isWater(n);
    });
    const base = mixRgb(hexToRgb(PALETTE.deepWater), hexToRgb(BIOME_TOP.ocean), depth);
    const col = nearLand ? mixRgb(base, hexToRgb(PALETTE.shallowWater), 0.55) : base;
    return rgbToCss(shadeRgb(col, 0.97 + c.noise * 0.06));
  }
  if (!tc.layers.terrain) return shade("#77807a", 0.9 + c.noise * 0.1);
  let col = hexToRgb(BIOME_TOP[c.biome]);
  // Wet plains are greener, dry ones yellower.
  if (c.biome === "plains") col = mixRgb(col, hexToRgb("#a9a95a"), Math.max(0, 0.5 - c.moisture) * 0.6);
  if (c.temperature < 0.2 && c.biome !== "desert" && c.biome !== "tundra") {
    col = mixRgb(col, hexToRgb(PALETTE.snow), 0.3);
  }
  const light = 0.94 + (tc.layers.elevation ? (c.elevation - 1) * 0.025 : 0) + (c.noise - 0.5) * 0.07;
  return rgbToCss(shadeRgb(col, light));
}

function path(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** Linear interpolation inside the tile's top face: (u, v) in 0..1 along grid x and y. */
function onTile(x: number, y: number, e: number, u: number, v: number, config: IsoProjectionConfig): Point {
  return gridToScreen(x + u, y + v, e, config);
}

const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIRS8: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function drawTile(ctx: CanvasRenderingContext2D, tc: TerrainContext, i: number) {
  const c = tc.cells[i];
  if (!c) return;
  const { x, y } = c;
  const { config, layers } = tc;
  const e = tc.elevation[i] ?? 0;
  const top = tileTopColor(tc, c);

  drawTileWalls(
    ctx,
    x,
    y,
    e,
    levelAt(tc, x, y + 1),
    levelAt(tc, x + 1, y),
    top,
    config,
    isWater(c) ? "#10232c" : EARTH,
  );

  const corners = tileCorners(x, y, e, config);
  path(ctx, corners);
  ctx.fillStyle = top;
  ctx.fill();
  // Hairline in the tile's own colour hides anti-aliasing seams between neighbours; at small
  // bitmap scales it must stay about one device pixel wide or the grid shows through.
  ctx.strokeStyle = top;
  ctx.lineWidth = Math.max(0.7, 1.1 / Math.max(tc.detail, 0.05));
  ctx.stroke();

  if (isWater(c)) {
    if (layers.water) drawWaterDetail(ctx, tc, c, e);
  } else {
    if (layers.fertility) {
      path(ctx, corners);
      ctx.fillStyle = withAlpha(fertilityColor(c.fertility), 0.55);
      ctx.fill();
    }
    if (tc.detail >= ZOOM.fields && (c.fields > 0 || c.pastures > 0)) drawFarmland(ctx, c, e, config);
    if (layers.rivers && c.river) drawRiver(ctx, tc, c, e);
    if (layers.roads && c.road && tc.detail >= ZOOM.roads) drawRoad(ctx, tc, c, e);
  }

  if (layers.territories && c.region >= 0) {
    const region = tc.regions[c.region];
    if (region) {
      path(ctx, corners);
      ctx.fillStyle = withAlpha(region.color, isWater(c) ? 0.1 : 0.16);
      ctx.fill();
    }
  }
}

function drawWaterDetail(ctx: CanvasRenderingContext2D, tc: TerrainContext, c: MapCellViewModel, e: number) {
  const { config } = tc;
  // Foam along the edges that touch land.
  ctx.strokeStyle = withAlpha(PALETTE.foam, 0.55);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  const edges: [number, number, [number, number], [number, number]][] = [
    [0, -1, [0, 0], [1, 0]],
    [1, 0, [1, 0], [1, 1]],
    [0, 1, [1, 1], [0, 1]],
    [-1, 0, [0, 1], [0, 0]],
  ];
  for (const [dx, dy, [u0, v0], [u1, v1]] of edges) {
    const n = cellAt(tc, c.x + dx, c.y + dy);
    if (!n || isWater(n)) continue;
    const a = onTile(c.x, c.y, e, u0, v0, config);
    const b = onTile(c.x, c.y, e, u1, v1, config);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // Sparse wave marks: a few tiles only, so open sea stays calm.
  if (tc.detail >= 0.45 && c.noise > 0.72) {
    const p = onTile(c.x, c.y, e, 0.3 + c.noise * 0.3, 0.45, config);
    ctx.strokeStyle = "rgba(210, 235, 240, 0.22)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y);
    ctx.quadraticCurveTo(p.x - 2.5, p.y - 2, p.x, p.y);
    ctx.quadraticCurveTo(p.x + 2.5, p.y + 2, p.x + 5, p.y);
    ctx.stroke();
  }
}

function drawFarmland(
  ctx: CanvasRenderingContext2D,
  c: MapCellViewModel,
  e: number,
  config: IsoProjectionConfig,
) {
  const patches = Math.min(4, c.fields + c.pastures);
  // Up to four quarter patches; fields first, pastures in the remaining quarters.
  const quarters: [number, number][] = [
    [0.08, 0.08],
    [0.54, 0.08],
    [0.08, 0.54],
    [0.54, 0.54],
  ];
  const start = Math.floor(c.noise * 4);
  for (let k = 0; k < patches; k++) {
    const q = quarters[(start + k) % 4];
    if (!q) continue;
    const [u, v] = q;
    const isField = k < c.fields;
    const pts = [
      onTile(c.x, c.y, e, u, v, config),
      onTile(c.x, c.y, e, u + 0.38, v, config),
      onTile(c.x, c.y, e, u + 0.38, v + 0.38, config),
      onTile(c.x, c.y, e, u, v + 0.38, config),
    ];
    path(ctx, pts);
    ctx.fillStyle = isField ? (k % 2 ? PALETTE.fieldAlt : PALETTE.field) : PALETTE.pasture;
    ctx.fill();
    ctx.strokeStyle = isField ? "rgba(110, 86, 40, 0.45)" : "rgba(90, 110, 60, 0.5)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    if (isField) {
      // Furrows.
      for (let r = 1; r < 5; r++) {
        const t = r / 5;
        const a = onTile(c.x, c.y, e, u + 0.38 * t, v, config);
        const b = onTile(c.x, c.y, e, u + 0.38 * t, v + 0.38, config);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    } else {
      // Fence.
      pts.forEach((p, n) => (n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.stroke();
  }
}

/** Half-segments from the tile centre towards each connected neighbour. */
function drawLinks(
  ctx: CanvasRenderingContext2D,
  tc: TerrainContext,
  c: MapCellViewModel,
  e: number,
  links: [number, number][],
  width: number,
  color: string,
  edge: string,
) {
  const { config } = tc;
  // An isolated road or river cell has nothing to connect: a lone dot would read as an object.
  if (!links.length) return;
  const centre = onTile(c.x, c.y, e, 0.5, 0.5, config);
  const ends = links.map(([dx, dy]) => {
    const p = onTile(c.x, c.y, e, 0.5 + dx * 0.5, 0.5 + dy * 0.5, config);
    // Falling towards a lower neighbour in front: continue down the wall (a small waterfall).
    const drop = dx >= 0 && dy >= 0 && dx + dy === 1 ? Math.max(0, e - levelAt(tc, c.x + dx, c.y + dy)) : 0;
    return { p, drop: drop * config.elevationStep };
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
    for (const { p, drop } of ends) {
      ctx.moveTo(centre.x, centre.y);
      ctx.lineTo(p.x, p.y);
      if (drop > 0) ctx.lineTo(p.x, p.y + drop);
    }
    ctx.stroke();
  }
}

function drawRiver(ctx: CanvasRenderingContext2D, tc: TerrainContext, c: MapCellViewModel, e: number) {
  const links: [number, number][] = [];
  for (const [dx, dy] of DIRS4) {
    const n = cellAt(tc, c.x + dx, c.y + dy);
    if (n && (n.river || isWater(n))) links.push([dx, dy]);
  }
  // Rivers only connected diagonally still need to read as continuous.
  if (!links.length) {
    for (const [dx, dy] of DIRS8.slice(4)) {
      const n = cellAt(tc, c.x + dx, c.y + dy);
      if (n?.river) links.push([dx, dy]);
    }
  }
  drawLinks(ctx, tc, c, e, links, 3.4, PALETTE.river, PALETTE.riverEdge);
}

function drawRoad(ctx: CanvasRenderingContext2D, tc: TerrainContext, c: MapCellViewModel, e: number) {
  const links: [number, number][] = [];
  const road = (dx: number, dy: number) => Boolean(cellAt(tc, c.x + dx, c.y + dy)?.road);
  for (const [dx, dy] of DIRS8) {
    if (!road(dx, dy)) continue;
    // Diagonals only when no straight pair already joins the two cells (avoids road triangles).
    if (dx !== 0 && dy !== 0 && (road(dx, 0) || road(0, dy))) continue;
    links.push([dx, dy]);
  }
  drawLinks(ctx, tc, c, e, links, 2.2, PALETTE.road, withAlpha(PALETTE.roadEdge, 0.7));
}

/** Trees, hills, dunes and peaks standing on the tile. */
export function drawTileDecorations(ctx: CanvasRenderingContext2D, tc: TerrainContext, i: number) {
  const c = tc.cells[i];
  if (!c || !tc.layers.terrain || isWater(c)) return;
  const e = tc.elevation[i] ?? 0;
  const { config } = tc;
  const seed = hashInts(c.x, c.y, 7);
  const rnd = (k: number) => unitFloat(hashInts(seed, k));

  if (c.biome === "mountain") {
    drawPeak(
      ctx,
      onTile(c.x, c.y, e, 0.5, 0.55, config),
      1 + rnd(1) * 0.35,
      c.altitude > 0.88 || c.temperature < 0.35,
    );
    if (tc.detail >= 0.5 && rnd(2) > 0.5)
      drawPeak(ctx, onTile(c.x, c.y, e, 0.25 + rnd(3) * 0.1, 0.75, config), 0.6, false);
    return;
  }
  if (c.biome === "hills") {
    // One soft mound, sometimes a second small one: enough to read as hills without a pattern.
    drawHill(ctx, onTile(c.x, c.y, e, 0.35 + rnd(1) * 0.3, 0.35 + rnd(4) * 0.3, config), 0.7 + rnd(5) * 0.35);
    if (tc.detail >= 0.5 && rnd(2) > 0.65)
      drawHill(ctx, onTile(c.x, c.y, e, 0.75, 0.25 + rnd(3) * 0.2, config), 0.5);
    return;
  }
  if (c.biome === "desert" && tc.detail >= 0.4) {
    const p = onTile(c.x, c.y, e, 0.5, 0.5, config);
    ctx.strokeStyle = "rgba(150, 110, 50, 0.45)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(p.x - 10, p.y + 2);
    ctx.quadraticCurveTo(p.x - 3, p.y - 4, p.x + 4, p.y + 1);
    ctx.moveTo(p.x - 2, p.y + 6);
    ctx.quadraticCurveTo(p.x + 5, p.y + 1, p.x + 11, p.y + 5);
    ctx.stroke();
    return;
  }
  if (tc.cleared[i]) return;
  const forest = c.biome === "forest";
  const scattered =
    (c.biome === "plains" && c.wood >= 22 && rnd(9) > 0.55) || (c.biome === "tundra" && rnd(9) > 0.8);
  if (!forest && !scattered) return;
  if (tc.detail < ZOOM.trees) {
    // Far away: a single darker canopy blob per forest tile.
    if (!forest) return;
    const p = onTile(c.x, c.y, e, 0.5, 0.5, config);
    ctx.fillStyle = shade(PALETTE.conifer, 0.95);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 3, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const conifer = c.temperature < 0.45 || c.biome === "tundra";
  const snowy = c.temperature < 0.22;
  const count = forest ? (tc.detail >= 0.6 ? 5 : 3) : 1;
  // Trees are placed back to front so nearer trunks cover further canopies.
  const spots: { u: number; v: number; k: number }[] = [];
  for (let k = 0; k < count; k++)
    spots.push({ u: 0.18 + rnd(k * 2 + 11) * 0.64, v: 0.18 + rnd(k * 2 + 12) * 0.64, k });
  spots.sort((a, b) => a.u + a.v - (b.u + b.v));
  for (const s of spots) {
    const p = onTile(c.x, c.y, e, s.u, s.v, config);
    drawTree(ctx, p.x, p.y, forest ? 1 : 0.85, conifer, rnd(s.k + 40), snowy);
  }
}

export function drawPeak(ctx: CanvasRenderingContext2D, p: Point, scale: number, snow: boolean) {
  const w = 17 * scale;
  const h = 22 * scale;
  const apex = { x: p.x + 1, y: p.y - h };
  ctx.fillStyle = "#8c857a";
  ctx.beginPath();
  ctx.moveTo(p.x - w, p.y + 3);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(p.x + 2, p.y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#645e56";
  ctx.beginPath();
  ctx.moveTo(p.x + 2, p.y + 5);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(p.x + w, p.y + 2);
  ctx.closePath();
  ctx.fill();
  if (snow) {
    ctx.fillStyle = PALETTE.snow;
    ctx.beginPath();
    ctx.moveTo(apex.x - w * 0.32, apex.y + h * 0.34);
    ctx.lineTo(apex.x, apex.y);
    ctx.lineTo(apex.x + w * 0.3, apex.y + h * 0.32);
    ctx.lineTo(apex.x + w * 0.05, apex.y + h * 0.26);
    ctx.lineTo(apex.x - w * 0.1, apex.y + h * 0.38);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawHill(ctx: CanvasRenderingContext2D, p: Point, scale: number) {
  const w = 15 * scale;
  const h = 8 * scale;
  const g = ctx.createLinearGradient(p.x - w, p.y - h, p.x + w, p.y);
  g.addColorStop(0, mix(BIOME_TOP.hills, "#fff3cf", 0.18));
  g.addColorStop(1, shade(BIOME_TOP.hills, 0.68));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x - w, p.y + 2);
  ctx.bezierCurveTo(p.x - w * 0.6, p.y - h, p.x + w * 0.5, p.y - h * 1.1, p.x + w, p.y + 2);
  ctx.closePath();
  ctx.fill();
}

/** True for tiles with decorations tall enough to hide a building behind them. */
export function hasTallDecoration(c: MapCellViewModel): boolean {
  return c.biome === "mountain" || c.biome === "hills" || c.biome === "forest";
}
