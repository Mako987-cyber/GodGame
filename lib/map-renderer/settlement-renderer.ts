/**
 * Settlements: turns a deterministic layout into depth-sorted sprites (ground, buildings, walls),
 * plus the screen-space icons used at overview zoom and the name plates.
 */
import { drawAsset, type AssetRegistry } from "./asset-registry";
import { buildingBounds, drawFlag, drawTent, drawWallSegment, type BuildingStyle } from "./building-renderer";
import { PALETTE, mix, roofColor, shade, withAlpha } from "./color-palette";
import type { HitTarget } from "./hit-testing";
import { gridToScreen, type IsoProjectionConfig, type Point, type Rect } from "./projection";
import type { DepthSortable } from "./render-order";
import type { SettlementLayout } from "./settlement-layout";
import type { NomadBandViewModel, SettlementViewModel, SettlementVisualTier } from "./types";

export interface Sprite extends DepthSortable {
  draw: (ctx: CanvasRenderingContext2D) => void;
  /** World-space bounds for culling and hit testing. */
  bounds: Rect;
  target?: HitTarget;
}

type ElevationAt = (x: number, y: number) => number;

function groundPoint(gx: number, gy: number, elevationAt: ElevationAt, config: IsoProjectionConfig): Point {
  return gridToScreen(gx, gy, elevationAt(Math.floor(gx), Math.floor(gy)), config);
}

/** Samples a straight grid segment every `step`, following the terrain height. */
function sampleSegment(
  a: Point,
  b: Point,
  elevationAt: ElevationAt,
  config: IsoProjectionConfig,
  step = 0.25,
): Point[] {
  return sampleGrid(a, b, step).map((g) => groundPoint(g.x, g.y, elevationAt, config));
}

/** Grid positions matching `sampleSegment`'s samples. */
function sampleGrid(a: Point, b: Point, step: number): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  return out;
}

export interface SettlementSpriteOptions {
  /** Draw every house; false keeps only primary buildings (landmarks, walls, stores). */
  minor: boolean;
  order: number;
}

export function settlementSprites(
  s: SettlementViewModel,
  layout: SettlementLayout,
  elevationAt: ElevationAt,
  config: IsoProjectionConfig,
  registry: AssetRegistry,
  options: SettlementSpriteOptions,
): Sprite[] {
  const sprites: Sprite[] = [];
  const style = (variant: number): BuildingStyle => ({
    owner: s.color,
    roof: roofColor(s.color, s.tier),
    wall:
      s.tier === "camp" || s.tier === "village"
        ? mix(PALETTE.plaster, PALETTE.timber, 0.35)
        : PALETTE.plaster,
    variant,
  });
  const target: HitTarget = { type: "settlement", id: s.id };
  const c = layout.center;
  const r = layout.radius;

  // Ground: plaza and streets, below every building of the settlement.
  if (layout.plaza || layout.streets.length) {
    const back = { x: c.x - r - 0.3, y: c.y - r - 0.3 };
    const a = gridToScreen(c.x - r, c.y + r, 0, config);
    const b = gridToScreen(c.x + r, c.y - r, 0, config);
    sprites.push({
      gx: Math.max(0, back.x),
      gy: Math.max(0, back.y),
      kind: "ground",
      order: options.order * 1000,
      bounds: {
        x: a.x,
        y: gridToScreen(c.x - r, c.y - r, 8, config).y,
        width: b.x - a.x,
        height: r * 2 * config.tileHeight + 60,
      },
      draw: (ctx) => {
        for (const st of layout.streets) {
          const pts = sampleSegment(st.from, st.to, elevationAt, config);
          for (const [w, col] of [
            [st.width * config.tileWidth * 0.9 + 1.2, withAlpha(PALETTE.roadEdge, 0.55)],
            [st.width * config.tileWidth * 0.9, PALETTE.street],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
          }
        }
        if (layout.plaza) {
          const { x, y, size } = layout.plaza;
          const e = elevationAt(Math.floor(x), Math.floor(y));
          const pts = [
            gridToScreen(x - size, y - size, e, config),
            gridToScreen(x + size, y - size, e, config),
            gridToScreen(x + size, y + size, e, config),
            gridToScreen(x - size, y + size, e, config),
          ];
          ctx.beginPath();
          pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
          ctx.fillStyle = mix(PALETTE.street, PALETTE.stone, 0.4);
          ctx.fill();
          ctx.strokeStyle = withAlpha(PALETTE.roadEdge, 0.45);
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      },
    });
  }

  layout.buildings.forEach((b, k) => {
    if (!options.minor && !b.primary) return;
    const p = groundPoint(b.gx, b.gy, elevationAt, config);
    const bounds = buildingBounds(b.kind, p.x, p.y, b.size);
    sprites.push({
      gx: b.gx,
      gy: b.gy,
      kind: "object",
      order: options.order * 1000 + k + 1,
      bounds,
      target: { type: "building", settlementId: s.id, label: b.label },
      // Looked up at draw time: a sprite registered or loaded later replaces the procedural shape.
      draw: (ctx) => drawAsset(ctx, registry.get(`building:${b.kind}`), p.x, p.y, b.size, style(b.variant)),
    });
  });

  if (layout.walls) {
    const { points, kind, gates } = layout.walls;
    // The ring follows the terrain only within one level of the settlement, so a wall never
    // plunges down a cliff; stretches over water are left open (the shore is the defence).
    const base = elevationAt(s.x, s.y);
    const wallLevel = (x: number, y: number) => {
      const e = elevationAt(x, y);
      return e <= 0 ? -1 : Math.max(base - 1, Math.min(base + 1, e));
    };
    points.forEach((a, k) => {
      if (gates.includes(k)) return;
      const b = points[(k + 1) % points.length];
      if (!b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pieces = sampleGrid(a, b, 0.2).map((g) => {
        const level = wallLevel(Math.floor(g.x), Math.floor(g.y));
        return { p: gridToScreen(g.x, g.y, Math.max(0, level), config), water: level < 0 };
      });
      const xs = pieces.map(({ p }) => p.x);
      const ys = pieces.map(({ p }) => p.y);
      sprites.push({
        gx: mid.x,
        gy: mid.y,
        kind: "wall",
        order: options.order * 1000 + 500 + k,
        bounds: {
          x: Math.min(...xs) - 2,
          y: Math.min(...ys) - 10,
          width: Math.max(...xs) - Math.min(...xs) + 4,
          height: Math.max(...ys) - Math.min(...ys) + 12,
        },
        target,
        draw: (ctx) => {
          for (let n = 0; n < pieces.length - 1; n++) {
            const p = pieces[n];
            const q = pieces[n + 1];
            if (p && q && !p.water && !q.water) drawWallSegment(ctx, p.p, q.p, kind);
          }
        },
      });
    });
  }
  return sprites;
}

export function nomadSprites(
  band: NomadBandViewModel,
  elevationAt: ElevationAt,
  config: IsoProjectionConfig,
  order: number,
): Sprite[] {
  const tents = band.population > 40 ? 3 : 2;
  const spots: [number, number][] = [
    [0.38, 0.4],
    [0.62, 0.52],
    [0.42, 0.66],
  ];
  const style: BuildingStyle = {
    owner: band.color,
    roof: mix(PALETTE.tent, band.color, 0.25),
    wall: PALETTE.tent,
    variant: 0.4,
  };
  const sprites: Sprite[] = [];
  for (let k = 0; k < tents; k++) {
    const [u, v] = spots[k] ?? [0.5, 0.5];
    const gx = band.x + u;
    const gy = band.y + v;
    const p = groundPoint(gx, gy, elevationAt, config);
    sprites.push({
      gx,
      gy,
      kind: "object",
      order: order * 1000 + k,
      bounds: { x: p.x - 8, y: p.y - 22, width: 16, height: 26 },
      target: { type: "nomad", id: band.id },
      draw: (ctx) => {
        drawTent(ctx, p.x, p.y, 0.075, { ...style, variant: k * 0.3 });
        if (k === 0) drawFlag(ctx, p.x + 5, p.y - 20, band.color, 12);
      },
    });
  }
  return sprites;
}

const ICON_SIZE: Record<SettlementVisualTier, number> = {
  camp: 5,
  village: 7,
  town: 9,
  city: 11,
  capital: 13,
};

/** Settlement glyph at overview zoom, in screen space, sized by tier. Returns its radius. */
export function drawSettlementIcon(
  ctx: CanvasRenderingContext2D,
  s: SettlementViewModel,
  x: number,
  y: number,
  scale = 1,
): number {
  const r = ICON_SIZE[s.tier] * scale;
  if (s.status === "abandoned") {
    ctx.strokeStyle = "rgba(170, 170, 160, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return r;
  }
  if (s.tier === "capital") {
    const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.2);
    halo.addColorStop(0, withAlpha(PALETTE.gold, 0.45));
    halo.addColorStop(1, withAlpha(PALETTE.gold, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(10, 16, 20, 0.8)";
  ctx.beginPath();
  if (s.tier === "camp" || s.tier === "village") ctx.arc(x, y, r, 0, Math.PI * 2);
  else ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35);
  ctx.fill();
  ctx.fillStyle = s.color;
  ctx.strokeStyle = s.tier === "capital" ? PALETTE.gold : PALETTE.label;
  ctx.lineWidth = s.tier === "capital" ? 2 : 1.2;
  ctx.beginPath();
  if (s.tier === "camp") {
    // Tent.
    ctx.moveTo(x - r * 0.65, y + r * 0.45);
    ctx.lineTo(x, y - r * 0.6);
    ctx.lineTo(x + r * 0.65, y + r * 0.45);
    ctx.closePath();
  } else if (s.tier === "village") {
    // House.
    ctx.moveTo(x - r * 0.6, y + r * 0.55);
    ctx.lineTo(x - r * 0.6, y - r * 0.05);
    ctx.lineTo(x, y - r * 0.6);
    ctx.lineTo(x + r * 0.6, y - r * 0.05);
    ctx.lineTo(x + r * 0.6, y + r * 0.55);
    ctx.closePath();
  } else {
    // Walled town: crenellated block, taller for cities.
    const h = s.tier === "town" ? 0.45 : 0.62;
    ctx.moveTo(x - r * 0.72, y + r * 0.6);
    ctx.lineTo(x - r * 0.72, y - r * h);
    for (let k = 0; k < 3; k++) {
      const x0 = x - r * 0.72 + k * r * 0.54;
      ctx.lineTo(x0 + r * 0.18, y - r * h);
      ctx.lineTo(x0 + r * 0.18, y - r * h + r * 0.22);
      ctx.lineTo(x0 + r * 0.36, y - r * h + r * 0.22);
      ctx.lineTo(x0 + r * 0.36, y - r * h);
      ctx.lineTo(x0 + r * 0.54, y - r * h);
    }
    ctx.lineTo(x + r * 0.72, y + r * 0.6);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (s.tier === "capital") drawStar(ctx, x, y - r * 1.45, r * 0.5);
  return r;
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = PALETTE.gold;
  ctx.strokeStyle = "rgba(40, 28, 10, 0.8)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export interface LabelStyle {
  emphasis: "capital" | "city" | "normal" | "minor";
  selected: boolean;
}

const LABEL_FONT: Record<LabelStyle["emphasis"], string> = {
  capital: "600 13px var(--font-alegreya-sans), system-ui, sans-serif",
  city: "600 12px var(--font-alegreya-sans), system-ui, sans-serif",
  normal: "500 11px var(--font-alegreya-sans), system-ui, sans-serif",
  minor: "500 11px var(--font-alegreya-sans), system-ui, sans-serif",
};

/** Measures a name plate centred horizontally at (x, y = bottom). */
export function measureLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: LabelStyle,
): Rect {
  ctx.font = LABEL_FONT[style.emphasis];
  // Padding, colour swatch and (for capitals) the star.
  const w = ctx.measureText(text).width + (style.emphasis === "capital" ? 34 : 24);
  const h = style.emphasis === "capital" ? 20 : 17;
  return { x: x - w / 2, y: y - h, width: w, height: h };
}

/** Name plate: dark pill with the owner's colour as a swatch; gold edge when selected. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rect,
  color: string,
  style: LabelStyle,
) {
  ctx.font = LABEL_FONT[style.emphasis];
  ctx.fillStyle = style.selected ? "rgba(30, 24, 12, 0.94)" : "rgba(10, 16, 20, 0.82)";
  ctx.strokeStyle = style.selected
    ? PALETTE.selection
    : style.emphasis === "capital"
      ? withAlpha(PALETTE.gold, 0.8)
      : withAlpha(color, 0.7);
  ctx.lineWidth = style.selected || style.emphasis === "capital" ? 1.5 : 1;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.height / 2);
  ctx.fill();
  ctx.stroke();
  let tx = rect.x + 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(tx + 2.5, rect.y + rect.height / 2, 3, 0, Math.PI * 2);
  ctx.fill();
  tx += 8;
  if (style.emphasis === "capital") {
    drawStar(ctx, tx + 3, rect.y + rect.height / 2, 4.5);
    tx += 10;
  }
  ctx.fillStyle = style.emphasis === "minor" ? shade(PALETTE.label, 0.85) : PALETTE.label;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, tx, rect.y + rect.height / 2 + 0.5);
}

export function rectsOverlap(a: Rect, b: Rect, margin = 2): boolean {
  return !(
    a.x + a.width + margin < b.x ||
    b.x + b.width + margin < a.x ||
    a.y + a.height + margin < b.y ||
    b.y + b.height + margin < a.y
  );
}
