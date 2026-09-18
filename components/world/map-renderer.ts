import type { WorldDetail } from "@/lib/dto";
import type { Overlay, Selection } from "@/lib/client/store";
import { BIOME_COLORS, hexToRgb, ramp, rgb, shade } from "@/lib/client/map-palette";

export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const OCEAN = 0;
const biomeRgb = BIOME_COLORS.map(hexToRgb);

function baseColor(detail: WorldDetail, i: number): [number, number, number] {
  const m = detail.map;
  const biome = m.biome[i] ?? 0;
  if (m.river[i]) return hexToRgb("#4f8fb5");
  return shade(biomeRgb[biome] ?? [0, 0, 0], 0.72 + (m.altitude[i] ?? 0.5) * 0.5);
}

function cellColor(detail: WorldDetail, overlay: Overlay, i: number): [number, number, number] {
  const m = detail.map;
  const ocean = (m.biome[i] ?? 0) === OCEAN;
  if (overlay === "biome") return baseColor(detail, i);
  if (ocean) return hexToRgb("#16303c");
  switch (overlay) {
    case "fertility":
      return ramp("#3b3326", "#a8cf6c", m.fertility[i] ?? 0);
    case "resources": {
      const food = (m.fauna[i] ?? 0) / 30;
      const wood = (m.wood[i] ?? 0) / 100;
      return ramp("#2c2a22", "#d6b25a", food * 0.65 + wood * 0.35);
    }
    case "population":
    case "infrastructure":
      return shade(baseColor(detail, i), 0.5);
    case "borders": {
      const owner = m.owner[i] ?? -1;
      const tribe = owner >= 0 ? detail.tribes[owner] : undefined;
      const base = shade(baseColor(detail, i), 0.55);
      if (!tribe) return base;
      const t = hexToRgb(tribe.color);
      return [base[0] * 0.5 + t[0] * 0.5, base[1] * 0.5 + t[1] * 0.5, base[2] * 0.5 + t[2] * 0.5];
    }
  }
}

/** Pure drawing function: the React component only manages size, view transform and events. */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  detail: WorldDetail,
  opts: {
    overlay: Overlay;
    view: View;
    cssSize: number;
    selection: Selection | null;
    focus: { x: number; y: number } | null;
  },
) {
  const { width, height } = detail.world;
  const { overlay, view, cssSize } = opts;
  const cell = (cssSize / Math.max(width, height)) * view.scale;
  const m = detail.map;

  ctx.fillStyle = "#0f1a1f";
  ctx.fillRect(0, 0, cssSize, cssSize);
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);

  const x0 = Math.max(0, Math.floor(-view.offsetX / cell));
  const y0 = Math.max(0, Math.floor(-view.offsetY / cell));
  const x1 = Math.min(width, Math.ceil((cssSize - view.offsetX) / cell));
  const y1 = Math.min(height, Math.ceil((cssSize - view.offsetY) / cell));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      ctx.fillStyle = rgb(cellColor(detail, overlay, i));
      // +0.5 hides anti-aliasing seams between adjacent cells.
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }
  }

  if (overlay === "resources") {
    for (let i = 0; i < width * height; i++) {
      const copper = (m.copper[i] ?? 0) > 0;
      const iron = (m.iron[i] ?? 0) > 0;
      if (!copper && !iron) continue;
      const x = (i % width) * cell + cell / 2;
      const y = Math.floor(i / width) * cell + cell / 2;
      ctx.fillStyle = copper ? "#e07b39" : "#b8bcc2";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, cell * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (overlay === "infrastructure") {
    ctx.strokeStyle = "rgba(230, 200, 110, 0.9)";
    ctx.lineWidth = Math.max(1, cell * 0.08);
    for (let i = 0; i < width * height; i++) {
      const fields = m.fields[i] ?? 0;
      if (!fields) continue;
      const cx = (i % width) * cell;
      const cy = Math.floor(i / width) * cell;
      const rows = fields + 1;
      for (let r = 1; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(cx + cell * 0.15, cy + (cell * r) / (rows + 1));
        ctx.lineTo(cx + cell * 0.85, cy + (cell * r) / (rows + 1));
        ctx.stroke();
      }
    }
  }

  if (overlay === "infrastructure" || overlay === "biome" || overlay === "borders") {
    ctx.strokeStyle = overlay === "infrastructure" ? "#e6dcc4" : "rgba(230, 220, 196, 0.55)";
    ctx.lineWidth = Math.max(1, cell * 0.12);
    ctx.beginPath();
    for (let i = 0; i < width * height; i++) {
      if (!m.road[i]) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny < 0 || ny >= height || !m.road[ny * width + nx]) continue;
        ctx.moveTo(x * cell + cell / 2, y * cell + cell / 2);
        ctx.lineTo(nx * cell + cell / 2, ny * cell + cell / 2);
      }
    }
    ctx.stroke();
  }

  if (overlay !== "fertility" && overlay !== "resources") {
    // Territory borders: an edge is drawn wherever the owner changes between neighbours.
    ctx.lineWidth = Math.max(1, cell * (overlay === "borders" ? 0.14 : 0.08));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const owner = m.owner[y * width + x] ?? -1;
        if (owner < 0) continue;
        const tribe = detail.tribes[owner];
        if (!tribe) continue;
        ctx.strokeStyle = tribe.color;
        ctx.beginPath();
        if (x + 1 >= width || m.owner[y * width + x + 1] !== owner) {
          ctx.moveTo((x + 1) * cell, y * cell);
          ctx.lineTo((x + 1) * cell, (y + 1) * cell);
        }
        if (x === 0 || m.owner[y * width + x - 1] !== owner) {
          ctx.moveTo(x * cell, y * cell);
          ctx.lineTo(x * cell, (y + 1) * cell);
        }
        if (y + 1 >= height || m.owner[(y + 1) * width + x] !== owner) {
          ctx.moveTo(x * cell, (y + 1) * cell);
          ctx.lineTo((x + 1) * cell, (y + 1) * cell);
        }
        if (y === 0 || m.owner[(y - 1) * width + x] !== owner) {
          ctx.moveTo(x * cell, y * cell);
          ctx.lineTo((x + 1) * cell, y * cell);
        }
        ctx.stroke();
      }
    }
  }

  if (overlay === "population") {
    const max = Math.max(1, ...m.population);
    for (let i = 0; i < width * height; i++) {
      const pop = m.population[i] ?? 0;
      if (!pop) continue;
      const x = (i % width) * cell + cell / 2;
      const y = Math.floor(i / width) * cell + cell / 2;
      const r = cell * (0.6 + 2.2 * Math.sqrt(pop / max));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(232, 182, 84, 0.85)");
      g.addColorStop(1, "rgba(232, 182, 84, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Settlements: square sized by level; abandoned ones as hollow grey squares.
  for (const s of detail.settlements) {
    const tribe = detail.tribes.find((t) => t.id === s.tribeId);
    const size = cell * (0.45 + s.level * 0.12);
    const x = s.x * cell + (cell - size) / 2;
    const y = s.y * cell + (cell - size) / 2;
    if (s.status === "abandoned") {
      ctx.strokeStyle = "rgba(152, 165, 160, 0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, size, size);
      continue;
    }
    ctx.fillStyle = tribe?.color ?? "#e6dcc4";
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "#0f1a1f";
    ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.strokeRect(x, y, size, size);
    if (s.buildings.palisade) {
      ctx.strokeStyle = "#e6dcc4";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
    }
  }

  // Nomadic bands: circles in the tribe colour.
  for (const t of detail.tribes) {
    if (t.status !== "nomadic" || t.population === 0) continue;
    const settledHere = detail.settlements.some((s) => s.status === "active" && s.x === t.x && s.y === t.y);
    if (settledHere) continue;
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "#0f1a1f";
    ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.beginPath();
    ctx.arc(t.x * cell + cell / 2, t.y * cell + cell / 2, cell * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const sel = opts.selection;
  let highlight: { x: number; y: number } | null = null;
  if (sel?.kind === "cell") highlight = sel;
  else if (sel?.kind === "settlement") highlight = detail.settlements.find((s) => s.id === sel.id) ?? null;
  else if (sel?.kind === "tribe") highlight = detail.tribes.find((t) => t.id === sel.id) ?? null;
  if (highlight) {
    ctx.strokeStyle = "#e8b654";
    ctx.lineWidth = 2;
    ctx.strokeRect(highlight.x * cell - 1, highlight.y * cell - 1, cell + 2, cell + 2);
  }
  if (opts.focus) {
    ctx.strokeStyle = "rgba(232, 182, 84, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(opts.focus.x * cell + cell / 2, opts.focus.y * cell + cell / 2, cell * 1.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
