/**
 * Elevation: terrace levels and the side walls that give the map its depth.
 * Only the two walls facing the viewer are ever visible (towards +x and +y).
 */
import { mix, shade } from "./color-palette";
import { gridToScreen, type IsoProjectionConfig } from "./projection";
import type { MapCellViewModel, MapLayerVisibility } from "./types";

/** Elevation actually drawn: flat land at level 1 when the relief layer is off. */
export function effectiveElevations(cells: MapCellViewModel[], layers: MapLayerVisibility): Int8Array {
  const out = new Int8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const e = cells[i]?.elevation ?? 0;
    out[i] = layers.elevation ? e : e > 0 ? 1 : 0;
  }
  return out;
}

/** Level the base of the map block sits on: walls at the map edge drop to it. */
export const MAP_BASE_LEVEL = -2;

/**
 * Draws the front walls of tile (x, y) at level `e`, down to the neighbour levels
 * `rightLevel` (cell x+1) and `leftLevel` (cell y+1). Nothing is drawn when a neighbour is as high.
 */
export function drawTileWalls(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  e: number,
  leftLevel: number,
  rightLevel: number,
  topColor: string,
  config: IsoProjectionConfig,
  earth: string,
) {
  const wallColor = mix(topColor, earth, 0.3);
  if (leftLevel < e) {
    // Left wall: along the edge between the left corner (x, y+1) and the bottom corner (x+1, y+1).
    const a = gridToScreen(x, y + 1, e, config);
    const b = gridToScreen(x + 1, y + 1, e, config);
    const drop = (e - leftLevel) * config.elevationStep;
    ctx.fillStyle = shade(wallColor, 0.84);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x, b.y + drop);
    ctx.lineTo(a.x, a.y + drop);
    ctx.closePath();
    ctx.fill();
    strata(ctx, a, b, drop, config.elevationStep);
  }
  if (rightLevel < e) {
    // Right wall: between the bottom corner (x+1, y+1) and the right corner (x+1, y).
    const a = gridToScreen(x + 1, y + 1, e, config);
    const b = gridToScreen(x + 1, y, e, config);
    const drop = (e - rightLevel) * config.elevationStep;
    ctx.fillStyle = shade(wallColor, 0.68);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x, b.y + drop);
    ctx.lineTo(a.x, a.y + drop);
    ctx.closePath();
    ctx.fill();
    strata(ctx, a, b, drop, config.elevationStep);
  }
}

/** Faint horizontal lines on tall walls, one per terrace level: reads as layered rock. */
function strata(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  drop: number,
  step: number,
) {
  if (drop < step * 3) return;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let d = step; d < drop; d += step) {
    ctx.moveTo(a.x, a.y + d);
    ctx.lineTo(b.x, b.y + d);
  }
  ctx.stroke();
}
