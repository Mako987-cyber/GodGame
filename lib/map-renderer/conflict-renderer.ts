/**
 * Conflicts: one front line (or one campaign arrow) and one marker per war, recent battle sites,
 * climate hazards and crisis markers. Never one line per pair of fighters.
 */
import { PALETTE, withAlpha } from "./color-palette";
import { gridToScreen, type IsoProjectionConfig, type Point } from "./projection";
import type { ConflictViewModel, CrisisMarkerViewModel, HazardViewModel } from "./types";

type ElevationAt = (x: number, y: number) => number;

/** Front lines and campaigns, in world space (widths are screen-constant). */
export function drawConflictLines(
  ctx: CanvasRenderingContext2D,
  conflicts: ConflictViewModel[],
  elevationAt: ElevationAt,
  config: IsoProjectionConfig,
  zoom: number,
  highlightId: string | null,
) {
  const px = 1 / zoom;
  for (const c of conflicts) {
    const strong = c.id === highlightId;
    const dim = highlightId !== null && !strong;
    if (c.front.length) {
      // Soft red glow under a dashed front.
      for (const [w, col, dash] of [
        [7, withAlpha(PALETTE.war, dim ? 0.08 : 0.22), false],
        [strong ? 3 : 2.2, withAlpha(PALETTE.war, dim ? 0.35 : 0.95), true],
      ] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w * px;
        ctx.setLineDash(dash ? [5 * px, 3 * px] : []);
        ctx.lineCap = "round";
        ctx.beginPath();
        for (const run of c.front) {
          const [p0, p1] = run.points;
          if (!p0 || !p1) continue;
          const a = gridToScreen(p0.x, p0.y, run.elevation, config);
          const b = gridToScreen(p1.x, p1.y, run.elevation, config);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    } else if (c.campaign) {
      const a = gridToScreen(
        c.campaign.from.x + 0.5,
        c.campaign.from.y + 0.5,
        elevationAt(c.campaign.from.x, c.campaign.from.y),
        config,
      );
      const b = gridToScreen(
        c.campaign.to.x + 0.5,
        c.campaign.to.y + 0.5,
        elevationAt(c.campaign.to.x, c.campaign.to.y),
        config,
      );
      drawCampaignArrow(ctx, a, b, px, dim ? 0.3 : strong ? 1 : 0.8);
    }
    // Recent battle sites: small scorched marks.
    if (!dim) {
      for (const bt of c.recentBattles) {
        const p = gridToScreen(bt.x + 0.5, bt.y + 0.5, elevationAt(bt.x, bt.y), config);
        ctx.fillStyle = withAlpha(PALETTE.war, 0.35);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = withAlpha(PALETTE.war, 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * px, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawCampaignArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, px: number, alpha: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Trim both ends so the arrow does not cover the settlements.
  const trim = Math.min(len * 0.2, 28);
  const s = { x: a.x + ux * trim, y: a.y + uy * trim - 6 };
  const e = { x: b.x - ux * trim, y: b.y - uy * trim - 6 };
  ctx.strokeStyle = withAlpha(PALETTE.war, alpha);
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(e.x, e.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const h = 9 * px;
  ctx.fillStyle = withAlpha(PALETTE.war, alpha);
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x - ux * h - uy * h * 0.55, e.y - uy * h + ux * h * 0.55);
  ctx.lineTo(e.x - ux * h + uy * h * 0.55, e.y - uy * h - ux * h * 0.55);
  ctx.closePath();
  ctx.fill();
}

/** Hazard areas as dashed diamonds (the square cell area they cover, projected). */
export function drawHazards(
  ctx: CanvasRenderingContext2D,
  hazards: HazardViewModel[],
  config: IsoProjectionConfig,
  zoom: number,
) {
  const px = 1 / zoom;
  for (const h of hazards) {
    const color = h.kind === "drought" ? "#d6b25a" : h.kind === "flood" ? "#5fa8d3" : "#e0703f";
    const e = 1;
    const pts = [
      gridToScreen(h.x - h.radius, h.y - h.radius, e, config),
      gridToScreen(h.x + h.radius + 1, h.y - h.radius, e, config),
      gridToScreen(h.x + h.radius + 1, h.y + h.radius + 1, e, config),
      gridToScreen(h.x - h.radius, h.y + h.radius + 1, e, config),
    ];
    ctx.fillStyle = withAlpha(color, 0.08);
    ctx.strokeStyle = withAlpha(color, 0.75);
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.beginPath();
    pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Crossed swords on a red disc, screen space. */
export function drawBattleIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  active: boolean,
) {
  ctx.fillStyle = active ? "rgba(120, 24, 16, 0.95)" : "rgba(90, 30, 24, 0.9)";
  ctx.strokeStyle = active ? PALETTE.selection : "#f3c0a8";
  ctx.lineWidth = active ? 2 : 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#f4ecd8";
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.lineCap = "round";
  const k = r * 0.52;
  ctx.beginPath();
  ctx.moveTo(x - k, y + k);
  ctx.lineTo(x + k, y - k);
  ctx.moveTo(x + k, y + k);
  ctx.lineTo(x - k, y - k);
  // Hilts.
  ctx.moveTo(x - k * 0.95, y + k * 0.35);
  ctx.lineTo(x - k * 0.35, y + k * 0.95);
  ctx.moveTo(x + k * 0.95, y + k * 0.35);
  ctx.lineTo(x + k * 0.35, y + k * 0.95);
  ctx.stroke();
}

/** Warning triangle for crises (epidemics, revolts, famines), screen space. */
export function drawCrisisIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  crisis: CrisisMarkerViewModel | null,
) {
  ctx.fillStyle = crisis && crisis.severity > 0.6 ? PALETTE.war : PALETTE.warSoft;
  ctx.strokeStyle = "rgba(20, 10, 6, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.95, y + r * 0.7);
  ctx.lineTo(x - r * 0.95, y + r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1a0f0a";
  ctx.fillRect(x - 0.9, y - r * 0.45, 1.8, r * 0.6);
  ctx.fillRect(x - 0.9, y + r * 0.3, 1.8, 1.8);
}
