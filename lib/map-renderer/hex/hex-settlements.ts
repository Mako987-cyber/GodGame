/**
 * Settlements on the hex map.
 *
 * The deterministic layouts of `settlement-layout.ts` place buildings in a local square frame
 * (continuous grid units around the settlement). On the hex map that frame is anchored on the
 * centre of the settlement's hex and projected with the same 2:1 ground vectors the procedural
 * buildings use, so streets, walls and houses stay aligned with each other; terrain queries of
 * the layout are answered by the hex actually under each point. A village fits in its hex, a
 * town spills over its neighbours, a capital covers the first ring.
 */
import { drawAsset, type AssetRegistry } from "../asset-registry";
import {
  buildingBounds,
  drawFlag,
  drawTent,
  drawWallSegment,
  type BuildingStyle,
} from "../building-renderer";
import { PALETTE, mix, roofColor, withAlpha } from "../color-palette";
import type { HitTarget } from "../hit-testing";
import { TILE_HEIGHT, TILE_WIDTH, type Rect } from "../projection";
import { buildSettlementLayout, type SettlementLayout } from "../settlement-layout";
import type { MapCellViewModel, NomadBandViewModel, SettlementViewModel } from "../types";
import type { HexGrid, Point } from "./geometry";

export interface HexSprite {
  /** Depth key: world y of the ground anchor (larger is in front). */
  y: number;
  order: number;
  bounds: Rect;
  draw: (ctx: CanvasRenderingContext2D) => void;
  target?: HitTarget;
}

/** Maps the layout's local grid frame to world space around a settlement's hex. */
export interface SettlementFrame {
  origin: Point;
  /** Layout coordinates of the frame origin (centre of the settlement cell). */
  cx: number;
  cy: number;
}

export function frameToWorld(f: SettlementFrame, gx: number, gy: number): Point {
  const a = gx - f.cx;
  const b = gy - f.cy;
  return { x: f.origin.x + ((a - b) * TILE_WIDTH) / 2, y: f.origin.y + ((a + b) * TILE_HEIGHT) / 2 };
}

export interface HexSettlementLayout {
  layout: SettlementLayout;
  frame: SettlementFrame;
  /** Hexes covered by the settlement (trees are cleared there). */
  cells: number[];
  /** World half-extents of the settlement footprint (for rings and hit areas). */
  rx: number;
  ry: number;
}

export function buildHexSettlementLayout(
  s: SettlementViewModel,
  seed: string,
  grid: HexGrid,
  cells: MapCellViewModel[],
): HexSettlementLayout {
  const frame: SettlementFrame = { origin: grid.center(s.x, s.y), cx: s.x + 0.5, cy: s.y + 0.5 };
  const cellUnder = (vx: number, vy: number) => {
    const p = frameToWorld(frame, vx + 0.5, vy + 0.5);
    const c = grid.cellAt(p.x, p.y);
    return c ? cells[grid.index(c.x, c.y)] : undefined;
  };
  const layout = buildSettlementLayout(s, seed, {
    width: grid.width,
    height: grid.height,
    buildable: (x, y) => {
      const c = cellUnder(x, y);
      return Boolean(c && c.biome !== "ocean" && c.biome !== "mountain");
    },
    isWater: (x, y) => cellUnder(x, y)?.biome === "ocean",
    isRocky: (x, y) => {
      const b = cellUnder(x, y)?.biome;
      return b === "hills" || b === "mountain";
    },
  });
  const covered = new Set<number>([grid.index(s.x, s.y)]);
  for (const i of layout.cells) {
    const vx = i % grid.width;
    const vy = Math.floor(i / grid.width);
    const p = frameToWorld(frame, vx + 0.5, vy + 0.5);
    const c = grid.cellAt(p.x, p.y);
    if (c) covered.add(grid.index(c.x, c.y));
  }
  const r = Math.max(layout.radius + 0.25, 0.55);
  return {
    layout,
    frame,
    cells: [...covered],
    rx: r * (TILE_WIDTH / 2) * Math.SQRT2,
    ry: r * (TILE_HEIGHT / 2) * Math.SQRT2,
  };
}

function sample(a: Point, b: Point, step: number): Point[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  const out: Point[] = [];
  for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  return out;
}

/** Streets and plaza, drawn under every building. */
export function drawSettlementGround(ctx: CanvasRenderingContext2D, h: HexSettlementLayout) {
  const { layout, frame } = h;
  for (const st of layout.streets) {
    const a = frameToWorld(frame, st.from.x, st.from.y);
    const b = frameToWorld(frame, st.to.x, st.to.y);
    for (const [w, col] of [
      [st.width * TILE_WIDTH * 0.9 + 1.2, withAlpha(PALETTE.roadEdge, 0.55)],
      [st.width * TILE_WIDTH * 0.9, PALETTE.street],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  if (layout.plaza) {
    const { x, y, size } = layout.plaza;
    const pts = [
      frameToWorld(frame, x - size, y - size),
      frameToWorld(frame, x + size, y - size),
      frameToWorld(frame, x + size, y + size),
      frameToWorld(frame, x - size, y + size),
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
}

export function hexSettlementSprites(
  s: SettlementViewModel,
  h: HexSettlementLayout,
  grid: HexGrid,
  cells: MapCellViewModel[],
  registry: AssetRegistry,
  options: { minor: boolean; order: number },
): HexSprite[] {
  const { layout, frame } = h;
  const sprites: HexSprite[] = [];
  const style = (variant: number): BuildingStyle => ({
    owner: s.color,
    roof: roofColor(s.color, s.tier),
    wall:
      s.tier === "camp" || s.tier === "village"
        ? mix(PALETTE.plaster, PALETTE.timber, 0.35)
        : PALETTE.plaster,
    variant,
  });
  layout.buildings.forEach((b, k) => {
    if (!options.minor && !b.primary) return;
    const p = frameToWorld(frame, b.gx, b.gy);
    sprites.push({
      y: p.y,
      order: options.order * 1000 + k + 1,
      bounds: buildingBounds(b.kind, p.x, p.y, b.size),
      target: { type: "building", settlementId: s.id, label: b.label },
      draw: (ctx) => drawAsset(ctx, registry.get(`building:${b.kind}`), p.x, p.y, b.size, style(b.variant)),
    });
  });
  if (layout.walls) {
    const { points, kind, gates } = layout.walls;
    const overWater = (p: Point) => {
      const c = grid.cellAt(p.x, p.y);
      return !c || cells[grid.index(c.x, c.y)]?.biome === "ocean";
    };
    points.forEach((a, k) => {
      if (gates.includes(k)) return;
      const b = points[(k + 1) % points.length];
      if (!b) return;
      const pieces = sample(frameToWorld(frame, a.x, a.y), frameToWorld(frame, b.x, b.y), 6).map((p) => ({
        p,
        water: overWater(p),
      }));
      const xs = pieces.map(({ p }) => p.x);
      const ys = pieces.map(({ p }) => p.y);
      sprites.push({
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        order: options.order * 1000 + 500 + k,
        bounds: {
          x: Math.min(...xs) - 2,
          y: Math.min(...ys) - 10,
          width: Math.max(...xs) - Math.min(...xs) + 4,
          height: Math.max(...ys) - Math.min(...ys) + 12,
        },
        target: { type: "settlement", id: s.id },
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

export function hexNomadSprites(band: NomadBandViewModel, grid: HexGrid, order: number): HexSprite[] {
  const c = grid.center(band.x, band.y);
  const tents = band.population > 40 ? 3 : 2;
  const spots: [number, number][] = [
    [-8, -4],
    [9, 1],
    [-2, 9],
  ];
  const style: BuildingStyle = {
    owner: band.color,
    roof: mix(PALETTE.tent, band.color, 0.25),
    wall: PALETTE.tent,
    variant: 0.4,
  };
  const out: HexSprite[] = [];
  for (let k = 0; k < tents; k++) {
    const [dx, dy] = spots[k] ?? [0, 0];
    const p = { x: c.x + dx, y: c.y + dy };
    out.push({
      y: p.y,
      order: order * 1000 + k,
      bounds: { x: p.x - 8, y: p.y - 22, width: 16, height: 26 },
      target: { type: "nomad", id: band.id },
      draw: (ctx) => {
        drawTent(ctx, p.x, p.y, 0.075, { ...style, variant: k * 0.3 });
        if (k === 0) drawFlag(ctx, p.x + 5, p.y - 20, band.color, 12);
      },
    });
  }
  return out;
}
