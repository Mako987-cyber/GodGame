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

function tintByOwner(detail: WorldDetail, i: number, strength: number): [number, number, number] {
  const owner = detail.map.owner[i] ?? -1;
  const tribe = owner >= 0 ? detail.tribes[owner] : undefined;
  const base = shade(baseColor(detail, i), 0.55);
  if (!tribe) return base;
  const t = hexToRgb(tribe.color);
  const k = strength;
  return [base[0] * (1 - k) + t[0] * k, base[1] * (1 - k) + t[1] * k, base[2] * (1 - k) + t[2] * k];
}

function cellColor(detail: WorldDetail, overlay: Overlay, i: number): [number, number, number] {
  const m = detail.map;
  const ocean = (m.biome[i] ?? 0) === OCEAN;
  if (overlay === "biome") return baseColor(detail, i);
  if (ocean) return hexToRgb("#16303c");
  switch (overlay) {
    case "fertility":
      return ramp("#3b3326", "#a8cf6c", m.fertility[i] ?? 0);
    case "water":
      return ramp("#3a3228", "#5fa8d3", m.water[i] ?? 0);
    case "resources": {
      const food = (m.fauna[i] ?? 0) / 30;
      const wood = (m.wood[i] ?? 0) / 100;
      return ramp("#2c2a22", "#d6b25a", food * 0.65 + wood * 0.35);
    }
    case "population":
    case "infrastructure":
    case "trade":
    case "conflicts":
      return shade(baseColor(detail, i), 0.5);
    case "culture":
      return tintByOwner(detail, i, 0.62);
    case "borders":
      return tintByOwner(detail, i, 0.5);
  }
}

/** Active trade routes, derived from the relationships that actually exchange goods. */
function tradeRoutes(detail: WorldDetail) {
  const home = new Map<string, { x: number; y: number }>();
  for (const s of detail.settlements) if (s.status === "active") home.set(s.tribeId, { x: s.x, y: s.y });
  for (const t of detail.tribes) if (!home.has(t.id)) home.set(t.id, { x: t.x, y: t.y });
  return detail.relationships
    .filter((r) => r.tradeVolume > 5 && !r.atWar)
    .map((r) => ({ from: home.get(r.aId), to: home.get(r.bId), volume: r.tradeVolume }))
    .filter((r): r is { from: { x: number; y: number }; to: { x: number; y: number }; volume: number } =>
      Boolean(r.from && r.to),
    );
}

function conflictLines(detail: WorldDetail) {
  const home = new Map<string, { x: number; y: number; color: string }>();
  for (const t of detail.tribes) home.set(t.id, { x: t.x, y: t.y, color: t.color });
  return detail.relationships
    .filter((r) => r.atWar || r.hostility > 0.55)
    .map((r) => ({ a: home.get(r.aId), b: home.get(r.bId), war: r.atWar }))
    .filter(
      (
        r,
      ): r is {
        a: { x: number; y: number; color: string };
        b: { x: number; y: number; color: string };
        war: boolean;
      } => Boolean(r.a && r.b),
    );
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
    // One dot per deposit kind: the colour says which mineral is there.
    const deposits: [number[], string][] = [
      [m.copper, "#e07b39"],
      [m.iron, "#b8bcc2"],
      [m.tin, "#9fd3c7"],
      [m.coal, "#4d4d55"],
      [m.clay, "#c98f6b"],
    ];
    for (let i = 0; i < width * height; i++) {
      let slot = 0;
      for (const [layer, color] of deposits) {
        if ((layer[i] ?? 0) <= 0) continue;
        const x = (i % width) * cell + cell / 2 + (slot - 1) * cell * 0.22;
        const y = Math.floor(i / width) * cell + cell / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, cell * 0.14), 0, Math.PI * 2);
        ctx.fill();
        slot++;
      }
    }
  }

  if (overlay === "infrastructure") {
    // Pastures: dotted cells, drawn under the field rows.
    ctx.fillStyle = "rgba(150, 190, 120, 0.75)";
    for (let i = 0; i < width * height; i++) {
      if (!(m.pastures[i] ?? 0)) continue;
      const cx = (i % width) * cell + cell / 2;
      const cy = Math.floor(i / width) * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, cell * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
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

  if (overlay === "trade") {
    for (const route of tradeRoutes(detail)) {
      ctx.strokeStyle = "rgba(122, 190, 214, 0.75)";
      ctx.lineWidth = Math.max(1, Math.min(6, Math.sqrt(route.volume) * 0.3));
      ctx.setLineDash([cell * 0.5, cell * 0.35]);
      ctx.beginPath();
      ctx.moveTo(route.from.x * cell + cell / 2, route.from.y * cell + cell / 2);
      ctx.lineTo(route.to.x * cell + cell / 2, route.to.y * cell + cell / 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (overlay === "conflicts") {
    for (const line of conflictLines(detail)) {
      ctx.strokeStyle = line.war ? "rgba(214, 90, 74, 0.9)" : "rgba(214, 140, 74, 0.55)";
      ctx.lineWidth = line.war ? Math.max(1.5, cell * 0.12) : 1;
      ctx.beginPath();
      ctx.moveTo(line.a.x * cell + cell / 2, line.a.y * cell + cell / 2);
      ctx.lineTo(line.b.x * cell + cell / 2, line.b.y * cell + cell / 2);
      ctx.stroke();
    }
    // Ongoing crises are marked where they happen.
    for (const crisis of detail.crises) {
      const target =
        detail.settlements.find((s) => s.id === crisis.targetId) ??
        detail.tribes.find((t) => t.id === crisis.targetId);
      if (!target) continue;
      ctx.strokeStyle = "rgba(214, 90, 74, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(target.x * cell + cell / 2, target.y * cell + cell / 2, cell * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (overlay === "biome" || overlay === "conflicts") {
    // Climate hazards currently on the map.
    for (const hazard of detail.world.climate.hazards) {
      ctx.strokeStyle =
        hazard.kind === "drought"
          ? "rgba(214, 178, 90, 0.55)"
          : hazard.kind === "flood"
            ? "rgba(95, 168, 211, 0.55)"
            : "rgba(214, 110, 74, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([cell * 0.4, cell * 0.4]);
      ctx.beginPath();
      ctx.arc(hazard.x * cell + cell / 2, hazard.y * cell + cell / 2, hazard.radius * cell, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
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
    if (s.buildings.walls) {
      ctx.strokeStyle = "#f0e6cc";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 3, y - 3, size + 6, size + 6);
    } else if (s.buildings.palisade) {
      ctx.strokeStyle = "#e6dcc4";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
    }
    if (s.epidemic) {
      // A settlement under an outbreak is flagged, not just coloured.
      ctx.fillStyle = "rgba(214, 90, 74, 0.95)";
      ctx.beginPath();
      ctx.arc(x + size, y, Math.max(1.5, cell * 0.16), 0, Math.PI * 2);
      ctx.fill();
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
