/**
 * Procedural building primitives (Canvas 2D).
 *
 * Every function draws in world pixels around a ground anchor (x, y) = the projected centre of the
 * footprint, with `s` the half-extent of the footprint in grid units. They know nothing about the
 * simulation or the database, draw deterministically from their inputs and share the projection
 * of the terrain, so a building always stands on the tile below it.
 */
import { PALETTE, mix, shade } from "./color-palette";
import { TILE_HEIGHT, TILE_WIDTH } from "./projection";
import type { BuildingKind } from "./settlement-layout";

export interface BuildingStyle {
  /** Owner colour: roofs, banners and awnings lean towards it. */
  owner: string;
  roof: string;
  wall: string;
  /** 0..1 deterministic variation. */
  variant: number;
}

type P = { x: number; y: number };

const HX = TILE_WIDTH / 2;
const HY = TILE_HEIGHT / 2;

/** Ground offset of grid vector (a, b) in world pixels. */
function iso(a: number, b: number): P {
  return { x: (a - b) * HX, y: (a + b) * HY };
}

function add(p: P, q: P, up = 0): P {
  return { x: p.x + q.x, y: p.y + q.y - up };
}

function poly(ctx: CanvasRenderingContext2D, pts: P[], fill: string, stroke?: string, lineWidth = 0.6) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Footprint corners: back (N), right (E), front (S), left (W). */
function footprint(x: number, y: number, a: number, b: number) {
  const c = { x, y };
  return {
    n: add(c, iso(-a, -b)),
    e: add(c, iso(a, -b)),
    s: add(c, iso(a, b)),
    w: add(c, iso(-a, b)),
  };
}

const OUTLINE = "rgba(20, 16, 12, 0.55)";

/** Soft contact shadow, cast towards the bottom-right (light comes from the top-left). */
export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, h: number) {
  ctx.fillStyle = "rgba(10, 14, 12, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x + h * 0.25, y + 1, s * HX * 1.5 + h * 0.2, s * HY * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Axis-aligned box with the two visible walls and a flat top. */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  b: number,
  h: number,
  color: string,
  top?: string,
) {
  const f = footprint(x, y, a, b);
  poly(
    ctx,
    [f.w, f.s, add(f.s, { x: 0, y: 0 }, h), add(f.w, { x: 0, y: 0 }, h)],
    shade(color, 0.92),
    OUTLINE,
  );
  poly(
    ctx,
    [f.s, f.e, add(f.e, { x: 0, y: 0 }, h), add(f.s, { x: 0, y: 0 }, h)],
    shade(color, 0.72),
    OUTLINE,
  );
  poly(
    ctx,
    [
      add(f.n, { x: 0, y: 0 }, h),
      add(f.e, { x: 0, y: 0 }, h),
      add(f.s, { x: 0, y: 0 }, h),
      add(f.w, { x: 0, y: 0 }, h),
    ],
    top ?? shade(color, 1.08),
    OUTLINE,
  );
}

/** Gabled roof on top of a box of height h; the ridge runs along the grid x axis or y axis. */
function drawGableRoof(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  b: number,
  h: number,
  rh: number,
  roof: string,
  alongX: boolean,
) {
  // Eaves overhang the walls a little.
  const ea = a * 1.12;
  const eb = b * 1.12;
  const f = footprint(x, y, ea, eb);
  const t = (p: P) => add(p, { x: 0, y: 0 }, h);
  if (alongX) {
    const r1 = add({ x, y }, iso(-ea, 0), h + rh);
    const r2 = add({ x, y }, iso(ea, 0), h + rh);
    poly(ctx, [t(f.n), t(f.e), r2, r1], shade(roof, 0.78), OUTLINE);
    poly(ctx, [t(f.e), t(f.s), r2], shade(roof, 0.66), OUTLINE);
    poly(ctx, [t(f.w), t(f.s), r2, r1], shade(roof, 1.02), OUTLINE);
  } else {
    const r1 = add({ x, y }, iso(0, -eb), h + rh);
    const r2 = add({ x, y }, iso(0, eb), h + rh);
    poly(ctx, [t(f.n), t(f.w), r2, r1], shade(roof, 0.95), OUTLINE);
    poly(ctx, [t(f.w), t(f.s), r2], shade(roof, 1.05), OUTLINE);
    poly(ctx, [t(f.e), t(f.s), r2, r1], shade(roof, 0.74), OUTLINE);
  }
}

function drawPyramidRoof(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  h: number,
  rh: number,
  roof: string,
) {
  const f = footprint(x, y, a * 1.1, a * 1.1);
  const apex = { x, y: y - h - rh };
  const t = (p: P) => add(p, { x: 0, y: 0 }, h);
  poly(ctx, [t(f.n), t(f.e), apex], shade(roof, 0.8), OUTLINE);
  poly(ctx, [t(f.w), t(f.n), apex], shade(roof, 0.92), OUTLINE);
  poly(ctx, [t(f.w), t(f.s), apex], shade(roof, 1.04), OUTLINE);
  poly(ctx, [t(f.s), t(f.e), apex], shade(roof, 0.7), OUTLINE);
}

export function drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  const along = st.variant < 0.5;
  const a = along ? s * 1.15 : s * 0.85;
  const b = along ? s * 0.85 : s * 1.15;
  const h = 5 + st.variant * 3;
  drawShadow(ctx, x, y, s, h);
  drawBox(ctx, x, y, a, b, h, st.wall);
  drawGableRoof(ctx, x, y, a, b, h, 5 + st.variant * 2, st.roof, along);
}

export function drawLargeHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  const h = 9 + st.variant * 3;
  drawShadow(ctx, x, y, s, h);
  drawBox(ctx, x, y, s * 1.2, s * 0.9, h, st.wall);
  drawGableRoof(ctx, x, y, s * 1.2, s * 0.9, h, 7, st.roof, true);
  // A row of windows on the visible long wall.
  const f = footprint(x, y, s * 1.2, s * 0.9);
  ctx.fillStyle = "rgba(40, 30, 20, 0.6)";
  for (let k = 1; k <= 3; k++) {
    const t = k / 4;
    const px = f.w.x + (f.s.x - f.w.x) * t;
    const py = f.w.y + (f.s.y - f.w.y) * t - h * 0.55;
    ctx.fillRect(px - 0.7, py - 1.2, 1.4, 2.2);
  }
}

export function drawHut(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  const rx = s * HX * 1.25;
  const ry = s * HY * 1.25;
  const h = 4;
  drawShadow(ctx, x, y, s, h + 4);
  // Round wall.
  ctx.fillStyle = shade(st.wall, 0.85);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(x - rx, y - h);
  ctx.ellipse(x, y - h, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Door.
  ctx.fillStyle = "rgba(30, 22, 14, 0.75)";
  ctx.fillRect(x - rx * 0.35, y + ry * 0.35 - h * 0.9, rx * 0.3, h * 0.9);
  // Thatched cone.
  ctx.beginPath();
  ctx.ellipse(x, y - h, rx * 1.15, ry * 1.15, 0, 0, Math.PI);
  ctx.lineTo(x, y - h - 8 - st.variant * 2);
  ctx.closePath();
  ctx.fillStyle = st.roof;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - h - 8 - st.variant * 2);
  ctx.lineTo(x + rx * 1.15, y - h);
  ctx.ellipse(x, y - h, rx * 1.15, ry * 1.15, 0, 0, Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = shade(st.roof, 0.75);
  ctx.fill();
}

export function drawTent(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  const f = footprint(x, y, s, s);
  const apex = { x, y: y - 9 - st.variant * 3 };
  drawShadow(ctx, x, y, s, 6);
  poly(ctx, [f.n, f.e, apex], shade(st.roof, 0.8), OUTLINE);
  poly(ctx, [f.w, f.n, apex], shade(st.roof, 0.95), OUTLINE);
  poly(ctx, [f.w, f.s, apex], shade(st.roof, 1.05), OUTLINE);
  poly(ctx, [f.s, f.e, apex], shade(st.roof, 0.72), OUTLINE);
  // Opening and a pole tip.
  const mid = { x: (f.w.x + f.s.x) / 2, y: (f.w.y + f.s.y) / 2 };
  poly(
    ctx,
    [mid, { x: mid.x + 2, y: mid.y - 1 }, { x: (mid.x + apex.x) / 2, y: (mid.y + apex.y) / 2 }],
    "rgba(40,28,18,0.7)",
  );
  ctx.strokeStyle = PALETTE.trunk;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(apex.x + 1, apex.y - 3);
  ctx.stroke();
}

export function drawCampfire(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const glow = ctx.createRadialGradient(x, y - 1, 0, x, y - 1, s * HX * 3);
  glow.addColorStop(0, "rgba(255, 190, 90, 0.55)");
  glow.addColorStop(1, "rgba(255, 190, 90, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x, y, s * HX * 3, s * HY * 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.trunk;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 3, y + 1);
  ctx.lineTo(x + 3, y - 1);
  ctx.moveTo(x - 3, y - 1);
  ctx.lineTo(x + 3, y + 1);
  ctx.stroke();
  poly(
    ctx,
    [
      { x: x - 2, y },
      { x, y: y - 6 },
      { x: x + 2, y },
    ],
    PALETTE.fire,
  );
  poly(
    ctx,
    [
      { x: x - 1, y },
      { x, y: y - 3.5 },
      { x: x + 1, y },
    ],
    "#ffe29a",
  );
}

export function drawHall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  const h = 8;
  drawShadow(ctx, x, y, s, h);
  drawBox(ctx, x, y, s * 1.2, s * 0.85, h, mix(st.wall, PALETTE.timber, 0.35));
  drawGableRoof(ctx, x, y, s * 1.2, s * 0.85, h, 9, st.roof, true);
  drawFlag(ctx, x + s * HX * 0.9, y - h - 8, st.owner, 8);
}

export function drawPalace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  const h = 12;
  drawShadow(ctx, x, y, s, h + 10);
  // Terrace, main block and a keep.
  drawBox(ctx, x, y, s * 1.15, s * 1.15, 3, PALETTE.stoneDark, PALETTE.stone);
  drawBox(ctx, x, y - 3, s * 0.95, s * 0.8, h, PALETTE.plaster);
  drawGableRoof(ctx, x, y - 3, s * 0.95, s * 0.8, h, 8, st.roof, true);
  const kx = x - s * HX * 0.2;
  const ky = y - 3 + s * HY * 0.1;
  drawBox(ctx, kx, ky, s * 0.32, s * 0.32, h + 14, PALETTE.stone);
  drawPyramidRoof(ctx, kx, ky, s * 0.32, h + 14, 9, st.roof);
  drawFlag(ctx, kx, ky - h - 23, st.owner, 10);
}

export function drawWarehouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  const along = st.variant < 0.5;
  const a = along ? s * 1.3 : s * 0.75;
  const b = along ? s * 0.75 : s * 1.3;
  drawShadow(ctx, x, y, s, 6);
  drawBox(ctx, x, y, a, b, 6, PALETTE.timber);
  drawGableRoof(ctx, x, y, a, b, 6, 5, mix(PALETTE.roofThatch, st.owner, 0.2), along);
  // Big door on the visible face.
  const f = footprint(x, y, a, b);
  const mid = along
    ? { x: (f.w.x + f.s.x) / 2, y: (f.w.y + f.s.y) / 2 }
    : { x: (f.s.x + f.e.x) / 2, y: (f.s.y + f.e.y) / 2 };
  ctx.fillStyle = "rgba(40, 28, 18, 0.7)";
  ctx.fillRect(mid.x - 1.6, mid.y - 4.5, 3.2, 4.5);
}

export function drawMarket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  const f = footprint(x, y, s, s);
  poly(ctx, [f.n, f.e, f.s, f.w], PALETTE.street, "rgba(90,70,40,0.4)");
  const awnings = ["#c9553b", "#e0b34a", st.owner, "#5f9fa8"];
  const spots: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  spots.forEach(([da, db], k) => {
    const p = add({ x, y }, iso(da * s, db * s));
    drawBox(ctx, p.x, p.y, s * 0.28, s * 0.28, 3, PALETTE.timber);
    // Striped canopy.
    const c = footprint(p.x, p.y, s * 0.36, s * 0.36);
    const up = (q: P) => add(q, { x: 0, y: 0 }, 6);
    poly(ctx, [up(c.n), up(c.e), up(c.s), up(c.w)], awnings[k % awnings.length] ?? st.owner, OUTLINE);
  });
}

export function drawTemple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  drawShadow(ctx, x, y, s, 16);
  drawBox(ctx, x, y, s * 1.1, s * 1.1, 3, PALETTE.stoneDark, PALETTE.stone);
  drawBox(ctx, x, y - 3, s * 0.9, s * 0.9, 3, PALETTE.stone);
  drawBox(ctx, x, y - 6, s * 0.7, s * 0.7, 9, "#d9d0bd");
  // Columns suggested by vertical strokes on the visible walls.
  const f = footprint(x, y - 6, s * 0.7, s * 0.7);
  ctx.strokeStyle = "rgba(90, 80, 64, 0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let k = 1; k < 4; k++) {
    const t = k / 4;
    for (const [p, q] of [
      [f.w, f.s],
      [f.s, f.e],
    ] as const) {
      const px = p.x + (q.x - p.x) * t;
      const py = p.y + (q.y - p.y) * t;
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 9);
    }
  }
  ctx.stroke();
  drawPyramidRoof(ctx, x, y - 6, s * 0.7, 9, 8, mix(st.roof, PALETTE.gold, 0.35));
}

export function drawWell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const rx = s * HX * 1.4;
  const ry = s * HY * 1.4;
  ctx.fillStyle = PALETTE.stoneDark;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.stone;
  ctx.beginPath();
  ctx.ellipse(x, y - 1.5, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c5a74";
  ctx.beginPath();
  ctx.ellipse(x, y - 1.5, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.trunk;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - rx, y - 1.5);
  ctx.lineTo(x - rx, y - 7);
  ctx.lineTo(x + rx, y - 7);
  ctx.lineTo(x + rx, y - 1.5);
  ctx.stroke();
}

export function drawKiln(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const rx = s * HX * 1.2;
  drawShadow(ctx, x, y, s, 6);
  ctx.fillStyle = "#a3674a";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.5, 0, 0, Math.PI);
  ctx.arc(x, y, rx, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 150, 60, 0.85)";
  ctx.fillRect(x - 1.2, y - 2.5, 2.4, 2.5);
  drawSmoke(ctx, x + rx * 0.4, y - rx - 1);
}

export function drawFoundry(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  drawShadow(ctx, x, y, s, 8);
  drawBox(ctx, x, y, s, s * 0.8, 7, "#6f6660");
  drawGableRoof(ctx, x, y, s, s * 0.8, 7, 4, PALETTE.roofSlate, st.variant < 0.5);
  drawBox(ctx, x + s * HX * 0.5, y - s * HY * 0.3, s * 0.2, s * 0.2, 16, "#5b524c");
  drawSmoke(ctx, x + s * HX * 0.5, y - 18);
}

export function drawBarracks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  st: BuildingStyle,
) {
  drawShadow(ctx, x, y, s, 7);
  drawBox(ctx, x, y, s * 1.25, s * 0.7, 6, PALETTE.stoneDark);
  drawGableRoof(ctx, x, y, s * 1.25, s * 0.7, 6, 4, PALETTE.roofSlate, true);
  drawFlag(ctx, x - s * HX, y - 12, st.owner, 7);
}

export function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  const h = 16 + st.variant * 4;
  drawShadow(ctx, x, y, s, h);
  drawBox(ctx, x, y, s, s, h, PALETTE.stone);
  // Crenellation.
  const f = footprint(x, y, s, s);
  ctx.fillStyle = PALETTE.stoneDark;
  for (const p of [f.w, f.s, f.e]) ctx.fillRect(p.x - 1, p.y - h - 2.5, 2, 2.5);
  drawPyramidRoof(ctx, x, y, s, h, 6, st.roof);
}

/** Wall or palisade segment between two ground points (world pixels). */
export function drawWallSegment(ctx: CanvasRenderingContext2D, p: P, q: P, kind: "walls" | "palisade") {
  const h = kind === "walls" ? 7 : 5;
  if (kind === "walls") {
    const light = q.x > p.x ? 0.92 : 0.74;
    poly(ctx, [p, q, { x: q.x, y: q.y - h }, { x: p.x, y: p.y - h }], shade(PALETTE.stone, light), OUTLINE);
    ctx.strokeStyle = PALETTE.stoneDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - h);
    ctx.lineTo(q.x, q.y - h);
    ctx.stroke();
    return;
  }
  // Palisade: pointed stakes.
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const n = Math.max(2, Math.round(len / 2.2));
  ctx.strokeStyle = PALETTE.timber;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const sx = p.x + (q.x - p.x) * t;
    const sy = p.y + (q.y - p.y) * t;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - h);
  }
  ctx.stroke();
  ctx.strokeStyle = shade(PALETTE.timber, 0.6);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - h * 0.55);
  ctx.lineTo(q.x, q.y - h * 0.55);
  ctx.stroke();
}

export function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  drawShadow(ctx, x, y, s, 6);
  ctx.fillStyle = PALETTE.rock;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(x, y, s * HX * 1.2, s * HY * 1.2, 0, 0, Math.PI);
  ctx.quadraticCurveTo(x - s * HX * 0.4, y - 14, x + s * HX * 1.2, y);
  ctx.fill();
  ctx.stroke();
  // Timbered entrance.
  ctx.fillStyle = "#1c1612";
  ctx.beginPath();
  ctx.moveTo(x - 3, y + 1);
  ctx.lineTo(x - 3, y - 4);
  ctx.quadraticCurveTo(x, y - 7, x + 3, y - 4);
  ctx.lineTo(x + 3, y + 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PALETTE.timber;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Cart rail.
  ctx.strokeStyle = "#4a4038";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y + 1);
  ctx.lineTo(x + 4, y + 5);
  ctx.moveTo(x + 1.5, y + 1);
  ctx.lineTo(x + 7, y + 5);
  ctx.stroke();
}

export function drawQuarry(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  for (let k = 0; k < 3; k++) {
    const f = footprint(x, y + k * 1.5, s * (1 - k * 0.25), s * (1 - k * 0.25));
    poly(ctx, [f.n, f.e, f.s, f.w], shade("#cfc6b6", 1 - k * 0.12), "rgba(80,70,60,0.5)");
  }
  drawBox(ctx, x + s * HX * 0.7, y - s * HY * 0.2, s * 0.18, s * 0.18, 3, "#bdb3a2");
}

export function drawPort(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, st: BuildingStyle) {
  // Pier planks.
  const f = footprint(x, y, s * 1.1, s * 0.35);
  poly(ctx, [f.n, f.e, f.s, f.w], PALETTE.timber, OUTLINE);
  ctx.strokeStyle = shade(PALETTE.timber, 0.6);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let k = 1; k < 5; k++) {
    const t = k / 5;
    ctx.moveTo(f.n.x + (f.e.x - f.n.x) * t, f.n.y + (f.e.y - f.n.y) * t);
    ctx.lineTo(f.w.x + (f.s.x - f.w.x) * t, f.w.y + (f.s.y - f.w.y) * t);
  }
  ctx.stroke();
  // A moored boat with a sail in the owner's colour.
  const bx = x + s * HX * 0.2;
  const by = y + s * HY * 1.4;
  ctx.fillStyle = "#6b4a2e";
  ctx.beginPath();
  ctx.moveTo(bx - 6, by - 1);
  ctx.lineTo(bx + 6, by - 1);
  ctx.lineTo(bx + 4, by + 2);
  ctx.lineTo(bx - 4, by + 2);
  ctx.closePath();
  ctx.fill();
  poly(
    ctx,
    [
      { x: bx, y: by - 1 },
      { x: bx, y: by - 11 },
      { x: bx + 5, y: by - 2 },
    ],
    mix("#efe6d0", st.owner, 0.3),
    OUTLINE,
  );
}

export function drawRuin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, variant: number) {
  const f = footprint(x, y, s, s);
  const h1 = 2 + variant * 3;
  const h2 = 1 + (1 - variant) * 3;
  poly(ctx, [f.w, f.s, { x: f.s.x, y: f.s.y - h1 }, { x: f.w.x, y: f.w.y - h2 }], "#9d968a", OUTLINE);
  poly(
    ctx,
    [
      f.s,
      { x: (f.s.x + f.e.x) / 2, y: (f.s.y + f.e.y) / 2 },
      { x: (f.s.x + f.e.x) / 2, y: (f.s.y + f.e.y) / 2 - h2 },
      { x: f.s.x, y: f.s.y - h1 },
    ],
    "#7c766c",
    OUTLINE,
  );
}

export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pole: number) {
  ctx.strokeStyle = "#3a3026";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y + pole);
  ctx.lineTo(x, y);
  ctx.stroke();
  poly(
    ctx,
    [
      { x, y },
      { x: x + 6, y: y + 1.5 },
      { x, y: y + 3.5 },
    ],
    color,
    "rgba(0,0,0,0.35)",
  );
}

function drawSmoke(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "rgba(210, 210, 205, 0.45)";
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(x + k * 1.6, y - k * 3, 1.4 + k * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  conifer: boolean,
  variant: number,
  snowy = false,
) {
  const h = (7 + variant * 4) * scale;
  ctx.fillStyle = "rgba(10, 20, 10, 0.2)";
  ctx.beginPath();
  ctx.ellipse(x + 1.5 * scale, y + 0.5, 3.2 * scale, 1.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (conifer) {
    const w = 3.4 * scale;
    poly(
      ctx,
      [
        { x: x - w, y: y - 1 },
        { x, y: y - h - 3 * scale },
        { x: x + w, y: y - 1 },
      ],
      PALETTE.conifer,
    );
    poly(
      ctx,
      [
        { x, y: y - 1 },
        { x, y: y - h - 3 * scale },
        { x: x + w, y: y - 1 },
      ],
      shade(PALETTE.conifer, 0.75),
    );
    if (snowy)
      poly(
        ctx,
        [
          { x: x - w * 0.35, y: y - h * 0.7 },
          { x, y: y - h - 3 * scale },
          { x: x + w * 0.35, y: y - h * 0.7 },
        ],
        PALETTE.snow,
      );
    return;
  }
  ctx.strokeStyle = PALETTE.trunk;
  ctx.lineWidth = 1.1 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h * 0.5);
  ctx.stroke();
  const r = (3.4 + variant) * scale;
  ctx.fillStyle = mix(PALETTE.foliage, PALETTE.foliageLight, variant);
  ctx.beginPath();
  ctx.arc(x, y - h * 0.62, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y - h * 0.55, r * 0.7, -Math.PI / 3, Math.PI * 0.8);
  ctx.fill();
}

/** Approximate on-screen height of each building (world pixels), used for bounds and hit tests. */
export const BUILDING_HEIGHT: Record<BuildingKind, number> = {
  tent: 12,
  campfire: 7,
  hut: 14,
  house: 14,
  "house-large": 19,
  hall: 26,
  palace: 50,
  warehouse: 13,
  market: 7,
  temple: 30,
  well: 8,
  kiln: 12,
  foundry: 22,
  barracks: 22,
  tower: 28,
  mine: 14,
  quarry: 5,
  port: 13,
  ruin: 6,
};

/** World-space bounding box of a building drawn at ground anchor (x, y). */
export function buildingBounds(kind: BuildingKind, x: number, y: number, s: number) {
  const w = s * TILE_WIDTH * 1.4 + 4;
  const h = BUILDING_HEIGHT[kind];
  return { x: x - w / 2, y: y - h - 2, width: w, height: h + s * TILE_HEIGHT * 0.9 + 2 };
}
