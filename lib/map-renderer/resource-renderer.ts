/**
 * Resource markers: one discrete icon per notable deposit, clustered at lower zoom so a map
 * full of resources never becomes a carpet of symbols.
 */
import { PALETTE, RESOURCE_COLORS, shade } from "./color-palette";
import type { MapCellViewModel } from "./types";

export type ResourceKind = keyof typeof RESOURCE_COLORS;

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  food: "Cibo (selvaggina)",
  wood: "Foresta produttiva",
  stone: "Pietra",
  copper: "Rame",
  iron: "Ferro",
  tin: "Stagno",
  coal: "Carbone",
  clay: "Argilla",
  water: "Sorgente d'acqua",
};

/** Priority when a cell holds several resources: rare metals first. */
export const RESOURCE_PRIORITY: ResourceKind[] = [
  "iron",
  "copper",
  "tin",
  "coal",
  "clay",
  "stone",
  "food",
  "wood",
  "water",
];

/** Deposits that are rare enough to be marked even when zoomed out. */
export const RARE_RESOURCES: ReadonlySet<ResourceKind> = new Set(["iron", "copper", "tin", "coal", "clay"]);

/**
 * Notable resources of a cell. Ordinary abundance is not marked: forests already show their wood
 * and mountains their stone, so only what the terrain does not say by itself gets an icon.
 */
export function cellResources(c: MapCellViewModel): ResourceKind[] {
  if (c.biome === "ocean") return [];
  const out: ResourceKind[] = [];
  if (c.iron > 0) out.push("iron");
  if (c.copper > 0) out.push("copper");
  if (c.tin > 0) out.push("tin");
  if (c.coal > 0) out.push("coal");
  if (c.clay > 0) out.push("clay");
  // Quarry-grade stone on hills (mountains are stone everywhere).
  if (c.biome === "hills" && c.stone >= 85) out.push("stone");
  // Exceptional hunting grounds only.
  if (c.fauna >= 26) out.push("food");
  // Productive forest: rich timber inside someone's territory (wilderness forest is just scenery).
  if (c.biome === "forest" && c.wood >= 90 && c.region >= 0) out.push("wood");
  if (!c.river && c.biome !== "coast" && c.water >= 0.92) out.push("water");
  return out;
}

export interface ResourceMarker {
  kind: ResourceKind;
  /** Grid position (cell centre, or centroid of the clustered cells). */
  gx: number;
  gy: number;
  elevation: number;
  count: number;
  /** Cell indices represented by this marker. */
  cells: number[];
}

/**
 * Groups resource cells into `clusterSize`×`clusterSize` blocks: one marker per kind per block,
 * placed on the centroid of the cells it stands for, at most `maxKindsPerBlock` kinds per block.
 */
export function clusterResources(
  cells: MapCellViewModel[],
  width: number,
  clusterSize: number,
  maxKindsPerBlock = 3,
): ResourceMarker[] {
  const size = Math.max(1, Math.floor(clusterSize));
  const blocks = new Map<string, Map<ResourceKind, MapCellViewModel[]>>();
  for (const c of cells) {
    const kinds = cellResources(c);
    if (!kinds.length) continue;
    const key = `${Math.floor(c.x / size)}:${Math.floor(c.y / size)}`;
    let block = blocks.get(key);
    if (!block) blocks.set(key, (block = new Map()));
    // A single cell shows at most two icons; clusters only count rare deposits, common ones
    // (food, wood, stone, springs) appear when zoomed in close enough to see single cells.
    for (const kind of size === 1 ? kinds.slice(0, 2) : kinds.filter((k) => RARE_RESOURCES.has(k))) {
      const list = block.get(kind);
      if (list) list.push(c);
      else block.set(kind, [c]);
    }
  }
  const markers: ResourceMarker[] = [];
  const keys = [...blocks.keys()].sort();
  for (const key of keys) {
    const block = blocks.get(key);
    if (!block) continue;
    const kinds = RESOURCE_PRIORITY.filter((k) => block.has(k)).slice(0, maxKindsPerBlock);
    kinds.forEach((kind, slot) => {
      const list = block.get(kind) ?? [];
      let sx = 0;
      let sy = 0;
      let se = 0;
      for (const c of list) {
        sx += c.x + 0.5;
        sy += c.y + 0.5;
        se += c.elevation;
      }
      const n = list.length || 1;
      // Several kinds in the same place fan out slightly so the icons do not stack.
      const spread = kinds.length > 1 ? (slot - (kinds.length - 1) / 2) * 0.28 : 0;
      markers.push({
        kind,
        gx: sx / n + spread,
        gy: sy / n - spread,
        elevation: Math.round(se / n),
        count: list.length,
        cells: list.map((c) => c.y * width + c.x),
      });
    });
  }
  return markers;
}

/** Draws a resource badge centred at (x, y) in the current transform; `r` is the radius. */
export function drawResourceIcon(
  ctx: CanvasRenderingContext2D,
  kind: ResourceKind,
  x: number,
  y: number,
  r: number,
) {
  const color = RESOURCE_COLORS[kind];
  ctx.fillStyle = "rgba(10, 16, 20, 0.72)";
  ctx.beginPath();
  ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = shade(color, 0.55);
  ctx.lineWidth = r * 0.18;
  ctx.beginPath();
  switch (kind) {
    case "food": {
      // Leaf.
      ctx.ellipse(x, y, r * 0.45, r * 0.8, Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.35, y + r * 0.55);
      ctx.lineTo(x + r * 0.35, y - r * 0.55);
      ctx.stroke();
      break;
    }
    case "wood": {
      ctx.moveTo(x, y - r * 0.85);
      ctx.lineTo(x + r * 0.65, y + r * 0.45);
      ctx.lineTo(x - r * 0.65, y + r * 0.45);
      ctx.closePath();
      ctx.fillStyle = PALETTE.foliageLight;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x - r * 0.12, y + r * 0.45, r * 0.24, r * 0.4);
      break;
    }
    case "stone": {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const px = x + Math.cos(a) * r * 0.75;
        const py = y + Math.sin(a) * r * 0.75;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "water": {
      ctx.moveTo(x, y - r * 0.85);
      ctx.bezierCurveTo(x + r * 0.8, y, x + r * 0.55, y + r * 0.75, x, y + r * 0.75);
      ctx.bezierCurveTo(x - r * 0.55, y + r * 0.75, x - r * 0.8, y, x, y - r * 0.85);
      ctx.fill();
      break;
    }
    case "coal": {
      ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a8a94";
      ctx.stroke();
      break;
    }
    case "clay": {
      ctx.roundRect(x - r * 0.65, y - r * 0.5, r * 1.3, r * 1, r * 0.3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    default: {
      // Metals: a faceted ingot/diamond.
      ctx.moveTo(x, y - r * 0.8);
      ctx.lineTo(x + r * 0.7, y);
      ctx.lineTo(x, y + r * 0.8);
      ctx.lineTo(x - r * 0.7, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.8);
      ctx.lineTo(x + r * 0.35, y - r * 0.4);
      ctx.lineTo(x, y);
      ctx.lineTo(x - r * 0.35, y - r * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
}
