/**
 * Minimap: a simplified picture of the whole hex map (water, land, territories, towns, wars)
 * drawn from the view model already in memory, plus the camera viewport. No extra queries.
 */
import { BIOME_TOP, PALETTE, mix } from "./color-palette";
import type { HexGrid, Point } from "./hex/geometry";
import type { Rect } from "./projection";
import type { IsometricMapViewModel } from "./types";

export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Fits the world bounds in a box of the given CSS width, keeping the aspect ratio. */
export function minimapTransform(bounds: Rect, width: number): MinimapTransform {
  const scale = width / bounds.width;
  return {
    scale,
    offsetX: -bounds.x * scale,
    offsetY: -bounds.y * scale,
    width,
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

export function worldToMinimap(t: MinimapTransform, p: Point): Point {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

export function minimapToWorld(t: MinimapTransform, p: Point): Point {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}

/** Viewport rectangle in minimap pixels, clipped to the minimap. */
export function viewportOnMinimap(t: MinimapTransform, view: Rect): Rect {
  const a = worldToMinimap(t, { x: view.x, y: view.y });
  const b = worldToMinimap(t, { x: view.x + view.width, y: view.y + view.height });
  const x = Math.max(0, Math.min(t.width, a.x));
  const y = Math.max(0, Math.min(t.height, a.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(t.width, b.x) - x),
    height: Math.max(0, Math.min(t.height, b.y) - y),
  };
}

/** Terrain, territories, towns and wars. Drawn once per data change into a cached bitmap. */
export function drawMinimapBase(
  ctx: CanvasRenderingContext2D,
  vm: IsometricMapViewModel,
  grid: HexGrid,
  t: MinimapTransform,
) {
  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, t.width, t.height);
  const w = grid.colStep * t.scale + 0.6;
  const h = grid.rowStep * t.scale + 0.6;
  for (const c of vm.cells) {
    const p = worldToMinimap(t, grid.center(c.x, c.y));
    let color: string = c.biome === "ocean" ? PALETTE.deepWater : BIOME_TOP[c.biome];
    if (c.biome !== "ocean") {
      const region = vm.regions[c.region];
      color = region ? mix(color, region.color, 0.55) : mix(color, "#1a2328", 0.2);
    }
    ctx.fillStyle = color;
    ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
  }
  for (const s of vm.settlements) {
    if (s.status !== "active") continue;
    const p = worldToMinimap(t, grid.center(s.x, s.y));
    const r = s.tier === "capital" ? 3.2 : s.tier === "city" || s.tier === "town" ? 2.2 : 1.4;
    ctx.fillStyle = s.tier === "capital" ? PALETTE.gold : "#f4ecd8";
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (s.tier === "capital") {
      // Capitals are squares: distinguishable without relying on colour.
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    } else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const c of vm.conflicts) {
    const p = worldToMinimap(t, grid.gridPoint(c.anchor.x, c.anchor.y));
    ctx.strokeStyle = PALETTE.war;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x - 3, p.y - 3);
    ctx.lineTo(p.x + 3, p.y + 3);
    ctx.moveTo(p.x + 3, p.y - 3);
    ctx.lineTo(p.x - 3, p.y + 3);
    ctx.stroke();
  }
}

/** Camera rectangle and selection marker. */
export function drawMinimapOverlay(
  ctx: CanvasRenderingContext2D,
  t: MinimapTransform,
  view: Rect | null,
  selection: Point | null,
) {
  if (view) {
    const r = viewportOnMinimap(t, view);
    ctx.fillStyle = "rgba(243, 210, 122, 0.08)";
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(2, r.width - 1), Math.max(2, r.height - 1));
    ctx.strokeStyle = PALETTE.selection;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(2, r.width - 1), Math.max(2, r.height - 1));
  }
  if (selection) {
    const p = worldToMinimap(t, selection);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}
