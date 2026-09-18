/**
 * Trade routes: gentle dashed arcs between the partners' seats, width by volume.
 * Roads are part of the terrain tiles (see tile-renderer) because they are static between ticks.
 */
import { PALETTE, withAlpha } from "./color-palette";
import { gridToScreen, type IsoProjectionConfig, type Point } from "./projection";
import { hashString } from "./seeded";
import type { TradeRouteViewModel } from "./types";

/** Control point of a route's arc: bends to a side chosen by the route id, so it is stable. */
export function tradeCurve(from: Point, to: Point, id: string): { from: Point; control: Point; to: Point } {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const side = hashString(id) % 2 ? 1 : -1;
  const bend = Math.min(80, len * 0.18) * side;
  return { from, to, control: { x: mx + (-dy / len) * bend, y: my + (dx / len) * bend } };
}

export function quadraticPoint(c: { from: Point; control: Point; to: Point }, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * c.from.x + 2 * u * t * c.control.x + t * t * c.to.x,
    y: u * u * c.from.y + 2 * u * t * c.control.y + t * t * c.to.y,
  };
}

export function routeWidth(volume: number): number {
  return Math.max(1, Math.min(3.5, 0.6 + Math.sqrt(volume) * 0.22));
}

export interface DrawnRoute {
  route: TradeRouteViewModel;
  /** World-space midpoint of the arc (for hit testing). */
  mid: Point;
}

export function drawTradeRoutes(
  ctx: CanvasRenderingContext2D,
  routes: TradeRouteViewModel[],
  elevationAt: (x: number, y: number) => number,
  config: IsoProjectionConfig,
  zoom: number,
  highlight: (route: TradeRouteViewModel) => boolean,
): DrawnRoute[] {
  const px = 1 / zoom;
  const out: DrawnRoute[] = [];
  const anyHighlight = routes.some(highlight);
  for (const route of routes) {
    const a = gridToScreen(
      route.from.x + 0.5,
      route.from.y + 0.5,
      elevationAt(route.from.x, route.from.y),
      config,
    );
    const b = gridToScreen(route.to.x + 0.5, route.to.y + 0.5, elevationAt(route.to.x, route.to.y), config);
    const curve = tradeCurve({ x: a.x, y: a.y - 10 }, { x: b.x, y: b.y - 10 }, route.id);
    const strong = highlight(route);
    const alpha = strong ? 0.95 : anyHighlight ? 0.2 : 0.5;
    const w = routeWidth(route.volume) * (strong ? 1.4 : 1);
    // Dark underlay keeps the route readable on light terrain.
    for (const [lw, col, dash] of [
      [w + 1.5, `rgba(20, 16, 8, ${alpha * 0.3})`, [] as number[]],
      [w, withAlpha(PALETTE.trade, alpha), [7 * px, 5 * px]],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * px;
      ctx.setLineDash(dash.length ? dash : []);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(curve.from.x, curve.from.y);
      ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Small end caps mark the trading seats.
    ctx.fillStyle = withAlpha(PALETTE.trade, alpha);
    for (const p of [curve.from, curve.to]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    out.push({ route, mid: quadraticPoint(curve, 0.5) });
  }
  return out;
}
