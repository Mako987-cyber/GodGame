/**
 * Deterministic settlement layouts.
 *
 * The simulation stores how many buildings of each type a settlement owns, not where they are.
 * This module places them: `position = f(worldSeed, settlementId, buildingIndex)`, with rejection
 * sampling seeded by the same inputs. Building i never depends on buildings placed after it, so a
 * settlement that grows keeps its existing houses where they were.
 */
import { hashString, seededRng } from "./seeded";
import type { SettlementViewModel, SettlementVisualTier } from "./types";

export type BuildingKind =
  | "tent"
  | "campfire"
  | "hut"
  | "house"
  | "house-large"
  | "hall"
  | "palace"
  | "warehouse"
  | "market"
  | "temple"
  | "well"
  | "kiln"
  | "foundry"
  | "barracks"
  | "tower"
  | "mine"
  | "quarry"
  | "port"
  | "ruin";

export interface PlacedBuilding {
  kind: BuildingKind;
  /** Continuous grid coordinates of the footprint centre. */
  gx: number;
  gy: number;
  /** Half-extent of the footprint in grid units. */
  size: number;
  /** 0..1 variation for colours and proportions. */
  variant: number;
  /** Primary buildings stay visible when minor detail is hidden. */
  primary: boolean;
  label: string;
}

export interface WallRing {
  kind: "palisade" | "walls";
  /** Closed polygon in grid coordinates. */
  points: { x: number; y: number }[];
  towers: boolean;
  /** Indices of segments left open as gates (where the main streets cross the ring). */
  gates: number[];
}

export interface SettlementLayout {
  settlementId: string;
  tier: SettlementVisualTier;
  center: { x: number; y: number };
  radius: number;
  buildings: PlacedBuilding[];
  /** Main streets in grid coordinates (drawn under buildings). */
  streets: { from: { x: number; y: number }; to: { x: number; y: number }; width: number }[];
  plaza: { x: number; y: number; size: number } | null;
  walls: WallRing | null;
  /** Cells covered by the layout (for occlusion and hit testing). */
  cells: number[];
}

/** Terrain queries the layout needs; the renderer supplies them from the view model. */
export interface LayoutTerrain {
  width: number;
  height: number;
  /** True for land a building can stand on. */
  buildable(x: number, y: number): boolean;
  isWater(x: number, y: number): boolean;
  /** Hills and mountains, for mines and quarries. */
  isRocky(x: number, y: number): boolean;
}

export const TIER_RADIUS: Record<SettlementVisualTier, number> = {
  camp: 0.34,
  village: 0.78,
  town: 1.12,
  city: 1.5,
  capital: 1.85,
};

const HOUSE_RANGE: Record<SettlementVisualTier, [number, number]> = {
  camp: [2, 5],
  village: [5, 12],
  town: [10, 20],
  city: [16, 28],
  capital: [22, 36],
};

export const BUILDING_LABELS: Record<BuildingKind, string> = {
  tent: "Tenda",
  campfire: "Fuoco comune",
  hut: "Capanna",
  house: "Abitazione",
  "house-large": "Casa grande",
  hall: "Casa del capo",
  palace: "Palazzo",
  warehouse: "Magazzino",
  market: "Mercato",
  temple: "Tempio",
  well: "Pozzo",
  kiln: "Fornace",
  foundry: "Fonderia",
  barracks: "Caserma",
  tower: "Torre",
  mine: "Miniera",
  quarry: "Cava",
  port: "Porto",
  ruin: "Rovine",
};

const BASE_SIZE: Record<BuildingKind, number> = {
  tent: 0.075,
  campfire: 0.05,
  hut: 0.08,
  house: 0.085,
  "house-large": 0.11,
  hall: 0.13,
  palace: 0.22,
  warehouse: 0.12,
  market: 0.16,
  temple: 0.15,
  well: 0.04,
  kiln: 0.07,
  foundry: 0.09,
  barracks: 0.12,
  tower: 0.07,
  mine: 0.12,
  quarry: 0.13,
  port: 0.14,
  ruin: 0.1,
};

export function houseCount(tier: SettlementVisualTier, population: number, huts: number): number {
  const [min, max] = HOUSE_RANGE[tier];
  const byPopulation = tier === "camp" ? 2 + population / 15 : min + population / 22 + huts * 0.5;
  return Math.round(Math.max(min, Math.min(max, byPopulation)));
}

function count(s: SettlementViewModel, key: string): number {
  return Math.max(0, Math.floor(s.buildings[key] ?? 0));
}

/** Rejection sampler for one building; every attempt is seeded by (seed, settlement, index, attempt). */
function place(
  seedKey: number,
  index: number,
  center: { x: number; y: number },
  minR: number,
  maxR: number,
  size: number,
  placed: PlacedBuilding[],
  terrain: LayoutTerrain,
  avoid: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const rng = seededRng((seedKey ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = rng() * Math.PI * 2;
    const r = minR + (maxR - minR) * Math.sqrt(rng());
    const x = center.x + Math.cos(angle) * r;
    const y = center.y + Math.sin(angle) * r;
    if (!terrain.buildable(Math.floor(x), Math.floor(y))) continue;
    if (avoid(x, y)) continue;
    let clear = true;
    for (const b of placed) {
      const dx = b.gx - x;
      const dy = b.gy - y;
      const min = (b.size + size) * 1.05;
      if (Math.abs(dx) < min && Math.abs(dy) < min) {
        clear = false;
        break;
      }
    }
    if (clear) return { x, y };
  }
  return null;
}

function ringPolygon(center: { x: number; y: number }, radius: number, sides: number, phase: number) {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    points.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return points;
}

/** Nearest cell (by ring distance) around (x, y) matching `test`, within `maxDistance`. */
function nearestCell(
  x: number,
  y: number,
  maxDistance: number,
  terrain: LayoutTerrain,
  test: (cx: number, cy: number) => boolean,
): { x: number; y: number } | null {
  for (let d = 1; d <= maxDistance; d++) {
    const ring: { x: number; y: number }[] = [];
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= terrain.width || cy >= terrain.height) continue;
        if (test(cx, cy)) ring.push({ x: cx, y: cy });
      }
    }
    if (ring.length) {
      // Prefer the cell in front of the settlement, then a stable order.
      ring.sort((a, b) => b.x + b.y - (a.x + a.y) || a.x - b.x);
      return ring[0] ?? null;
    }
  }
  return null;
}

export function buildSettlementLayout(
  s: SettlementViewModel,
  worldSeed: string,
  terrain: LayoutTerrain,
): SettlementLayout {
  const seedKey = hashString(`${worldSeed}:${s.id}`);
  const tier = s.tier;
  const center = { x: s.x + 0.5, y: s.y + 0.5 };
  const radius = TIER_RADIUS[tier];
  const buildings: PlacedBuilding[] = [];
  const streets: SettlementLayout["streets"] = [];
  let index = 0;
  const add = (kind: BuildingKind, x: number, y: number, primary: boolean, size = BASE_SIZE[kind]) => {
    const variant = seededRng((seedKey ^ Math.imul(index + 101, 0x85ebca6b)) >>> 0)();
    buildings.push({ kind, gx: x, gy: y, size, variant, primary, label: BUILDING_LABELS[kind] });
  };

  if (s.status === "abandoned") {
    const n = tier === "camp" ? 2 : Math.min(6, 2 + Math.round(radius * 3));
    for (let i = 0; i < n; i++) {
      const p = place(
        seedKey,
        index++,
        center,
        0,
        radius * 0.8,
        BASE_SIZE.ruin,
        buildings,
        terrain,
        () => false,
      );
      if (p) add("ruin", p.x, p.y, i === 0);
    }
    return {
      settlementId: s.id,
      tier,
      center,
      radius,
      buildings,
      streets,
      plaza: null,
      walls: null,
      cells: coveredCells(center, radius, terrain),
    };
  }

  const urban = tier === "town" || tier === "city" || tier === "capital";
  const plaza = tier === "camp" ? null : { x: center.x, y: center.y, size: urban ? 0.2 : 0.12 };

  // Main streets cross at the plaza along the grid axes; houses keep off them.
  const streetHalf = urban ? radius * 0.95 : tier === "village" ? radius * 0.8 : 0;
  if (streetHalf > 0) {
    const w = tier === "capital" ? 0.07 : urban ? 0.06 : 0.045;
    streets.push({
      from: { x: center.x - streetHalf, y: center.y },
      to: { x: center.x + streetHalf, y: center.y },
      width: w,
    });
    if (urban) {
      streets.push({
        from: { x: center.x, y: center.y - streetHalf },
        to: { x: center.x, y: center.y + streetHalf },
        width: w,
      });
    }
  }
  const onStreet = (x: number, y: number) =>
    streets.some((st) =>
      st.from.y === st.to.y
        ? Math.abs(y - st.from.y) < st.width + 0.06
        : Math.abs(x - st.from.x) < st.width + 0.06,
    );
  const nearPlaza = (x: number, y: number) =>
    plaza !== null && Math.abs(x - plaza.x) < plaza.size + 0.05 && Math.abs(y - plaza.y) < plaza.size + 0.05;
  const avoid = (x: number, y: number) => onStreet(x, y) || nearPlaza(x, y);

  // Landmarks at fixed spots around the plaza, so the town reads the same every time.
  const q = urban && plaza ? plaza.size + 0.2 : 0.2;
  if (tier === "camp") {
    add("campfire", center.x, center.y, true);
  } else if (tier === "capital") {
    add("palace", center.x - q, center.y - q, true);
  } else {
    add("hall", center.x - q * 0.9, center.y - q * 0.9, true);
    const hall = buildings[buildings.length - 1];
    if (hall && urban) hall.label = "Sede del governo";
  }
  if (count(s, "temple") > 0) add("temple", center.x + q, center.y - q, true);
  if (count(s, "market") > 0) add("market", center.x - q, center.y + q, true);
  if (count(s, "well") > 0) {
    if (plaza) add("well", center.x + (urban ? 0.02 : 0.1), center.y + (urban ? 0.02 : 0.1), false);
  }

  const slot = (kind: BuildingKind, primary: boolean, minR: number, maxR: number) => {
    const p = place(seedKey, index++, center, minR, maxR, BASE_SIZE[kind], buildings, terrain, avoid);
    if (p) add(kind, p.x, p.y, primary);
  };

  const storehouses = Math.min(tier === "capital" ? 3 : 2, count(s, "storehouse"));
  for (let i = 0; i < storehouses; i++) slot("warehouse", true, radius * 0.3, radius * 0.85);
  if (count(s, "barracks") > 0) slot("barracks", true, radius * 0.4, radius * 0.9);
  if (count(s, "kiln") > 0) slot("kiln", false, radius * 0.5, radius * 0.95);
  if (count(s, "foundry") > 0) slot("foundry", false, radius * 0.5, radius * 0.95);

  const houses = houseCount(tier, s.population, count(s, "hut"));
  const houseKind: BuildingKind = tier === "camp" ? "tent" : tier === "village" ? "hut" : "house";
  for (let i = 0; i < houses; i++) {
    // Larger homes towards the centre of towns; the rest spread outwards.
    const kind = urban && i % 5 === 0 ? "house-large" : houseKind;
    const minR = tier === "camp" ? 0.12 : urban ? 0.18 : 0.14;
    slot(kind, false, minR, radius);
  }

  // Walls: stone ring for defended towns, wooden palisade otherwise.
  let walls: WallRing | null = null;
  const hasWalls = count(s, "walls") > 0;
  const hasPalisade = count(s, "palisade") > 0;
  if ((hasWalls || hasPalisade) && tier !== "camp") {
    const sides = tier === "capital" ? 8 : urban ? 8 : 6;
    const points = ringPolygon(center, radius + 0.1, sides, Math.PI / sides);
    // Gates where the streets leave: the segments crossing the four axis directions.
    const gates: number[] = [];
    if (streets.length) {
      for (let i = 0; i < sides; i++) {
        const mid = ((i + 0.5) / sides) * Math.PI * 2 + Math.PI / sides;
        const onAxis = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].some(
          (a) => Math.abs(Math.atan2(Math.sin(mid - a), Math.cos(mid - a))) < Math.PI / sides,
        );
        if (onAxis) gates.push(i);
      }
    }
    walls = { kind: hasWalls ? "walls" : "palisade", points, towers: hasWalls && tier !== "village", gates };
  }

  // Works outside the ring: mines and quarries on nearby rock, a port on the nearest water.
  const cx = s.x;
  const cy = s.y;
  if (count(s, "mine") > 0) {
    const c = nearestCell(cx, cy, 3, terrain, (x, y) => terrain.isRocky(x, y));
    if (c) add("mine", c.x + 0.5, c.y + 0.5, true);
  }
  if (count(s, "quarry") > 0) {
    const c = nearestCell(
      cx,
      cy,
      3,
      terrain,
      (x, y) =>
        terrain.isRocky(x, y) && !buildings.some((b) => Math.floor(b.gx) === x && Math.floor(b.gy) === y),
    );
    if (c) add("quarry", c.x + 0.5, c.y + 0.5, true);
  }
  if (count(s, "port") > 0) {
    const c = nearestCell(cx, cy, 2, terrain, (x, y) => terrain.isWater(x, y));
    if (c) {
      // The pier stands on the shore edge facing the settlement.
      const px = c.x + 0.5 + Math.sign(cx - c.x) * 0.35;
      const py = c.y + 0.5 + Math.sign(cy - c.y) * 0.35;
      add("port", px, py, true);
    }
  }
  if (walls?.towers) {
    walls.points.forEach((p, i) => {
      if (tier === "capital" || i % 2 === 0) add("tower", p.x, p.y, true);
    });
  }

  return {
    settlementId: s.id,
    tier,
    center,
    radius,
    buildings,
    streets,
    plaza,
    walls,
    cells: coveredCells(center, radius, terrain),
  };
}

function coveredCells(center: { x: number; y: number }, radius: number, terrain: LayoutTerrain): number[] {
  const out: number[] = [];
  const r = Math.ceil(radius + 0.2);
  for (let y = Math.floor(center.y) - r; y <= Math.floor(center.y) + r; y++) {
    for (let x = Math.floor(center.x) - r; x <= Math.floor(center.x) + r; x++) {
      if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) continue;
      const dx = Math.max(0, Math.abs(x + 0.5 - center.x) - 0.5);
      const dy = Math.max(0, Math.abs(y + 0.5 - center.y) - 0.5);
      if (Math.hypot(dx, dy) <= radius + 0.15) out.push(y * terrain.width + x);
    }
  }
  return out;
}
