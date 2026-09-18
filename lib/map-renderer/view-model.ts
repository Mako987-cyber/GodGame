/**
 * Adapter from the API payload (`WorldDetail`) to the renderer's view model.
 * This is the only module of the renderer that knows the DTO shapes.
 */
import type { EventDTO, WorldDetail } from "@/lib/dto";
import { computeBorders, sharedEdges } from "./border-renderer";
import { MAX_ELEVATION } from "./projection";
import { hashInts, hashString, unitFloat } from "./seeded";
import type {
  BattleViewModel,
  BiomeKind,
  ConflictViewModel,
  IsometricMapViewModel,
  MapCellViewModel,
  MapLayerVisibility,
  RegionViewModel,
  RoadViewModel,
  SettlementViewModel,
  SettlementVisualTier,
  TradeRouteViewModel,
} from "./types";
import { DEFAULT_LAYERS } from "./visibility";

/** Same order as BIOMES in the simulation core. */
export const BIOME_ORDER: readonly BiomeKind[] = [
  "ocean",
  "coast",
  "plains",
  "forest",
  "hills",
  "mountain",
  "desert",
  "tundra",
];

const SEA_LEVEL = 0.34;

export interface MapViewOptions {
  layers?: MapLayerVisibility;
  /** Recent battle events (type "battle"), used to place conflict markers where fighting happened. */
  battles?: EventDTO[];
  /** How many trade routes to keep (the busiest ones). */
  maxTradeRoutes?: number;
  maxConflicts?: number;
}

/** Terrace level of a cell: 0 for water, 1..MAX_ELEVATION for land. */
export function elevationLevel(biome: BiomeKind, altitude: number): number {
  if (biome === "ocean") return 0;
  if (biome === "coast") return 1;
  const t = (altitude - SEA_LEVEL) / (1 - SEA_LEVEL);
  return Math.max(1, Math.min(MAX_ELEVATION, 1 + Math.floor(t * (MAX_ELEVATION - 0.5))));
}

export function visualTier(tier: string, isCapital: boolean): SettlementVisualTier {
  if (isCapital || tier === "capital") return "capital";
  if (tier === "city_state") return "city";
  if (tier === "town") return "town";
  if (tier === "village") return "village";
  return "camp";
}

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function buildIsometricMapViewModel(
  detail: WorldDetail,
  options: MapViewOptions = {},
): IsometricMapViewModel {
  const { width, height, seed } = detail.world;
  const m = detail.map;
  const seedHash = hashString(seed);
  const total = width * height;

  // Regions: an active civilization groups its tribes; independent tribes are their own region.
  const activeCivs = new Map(detail.civilizations.filter((c) => c.status === "active").map((c) => [c.id, c]));
  const regions: RegionViewModel[] = [];
  const regionByKey = new Map<string, number>();
  const tribeRegion = detail.tribes.map((t) => {
    const civ = t.civilizationId ? activeCivs.get(t.civilizationId) : undefined;
    const key = civ ? `civ:${civ.id}` : `tribe:${t.id}`;
    let idx = regionByKey.get(key);
    if (idx === undefined) {
      idx = regions.length;
      regionByKey.set(key, idx);
      regions.push({
        id: civ ? civ.id : t.id,
        kind: civ ? "civilization" : "tribe",
        name: civ ? civ.name : t.name,
        color: civ ? civ.color : t.color,
        tribeIds: [],
        cellCount: 0,
        centroid: null,
      });
    }
    regions[idx]?.tribeIds.push(t.id);
    return idx;
  });

  const cells: MapCellViewModel[] = new Array(total);
  const regionSums = regions.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let i = 0; i < total; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const biome = BIOME_ORDER[num(m.biome[i])] ?? "plains";
    const altitude = num(m.altitude[i]);
    const owner = m.owner[i] ?? -1;
    const region = owner >= 0 ? (tribeRegion[owner] ?? -1) : -1;
    if (region >= 0) {
      const sum = regionSums[region];
      if (sum) {
        sum.x += x + 0.5;
        sum.y += y + 0.5;
        sum.n++;
      }
    }
    cells[i] = {
      x,
      y,
      index: i,
      biome,
      altitude,
      elevation: elevationLevel(biome, altitude),
      temperature: num(m.temperature[i]),
      moisture: num(m.moisture[i]),
      fertility: num(m.fertility[i]),
      water: num(m.water[i]),
      river: Boolean(m.river[i]),
      riverName: m.riverNames[i] ?? null,
      coastal: Boolean(m.coastal[i]),
      road: Boolean(m.road[i]),
      fields: num(m.fields[i]),
      pastures: num(m.pastures[i]),
      wood: num(m.wood[i]),
      stone: num(m.stone[i]),
      fauna: num(m.fauna[i]),
      maxFauna: num(m.maxFauna[i]),
      copper: num(m.copper[i]),
      iron: num(m.iron[i]),
      tin: num(m.tin[i]),
      coal: num(m.coal[i]),
      clay: num(m.clay[i]),
      region,
      settlement: m.settlement[i] ?? -1,
      noise: unitFloat(hashInts(seedHash, x, y)),
    };
  }
  regions.forEach((r, k) => {
    const sum = regionSums[k];
    if (!sum) return;
    r.cellCount = sum.n;
    r.centroid = sum.n ? { x: sum.x / sum.n, y: sum.y / sum.n } : null;
  });

  const tribeById = new Map(detail.tribes.map((t, k) => [t.id, { tribe: t, index: k }]));
  const techName = new Map(detail.technologies.map((t) => [t.id, t.name]));
  const capitals = new Set(
    detail.civilizations
      .filter((c) => c.status === "active" && c.capitalSettlementId)
      .map((c) => c.capitalSettlementId),
  );

  const settlements: SettlementViewModel[] = detail.settlements.map((s) => {
    const entry = tribeById.get(s.tribeId);
    const tribe = entry?.tribe;
    const civ = s.civilizationId ? activeCivs.get(s.civilizationId) : undefined;
    const isCapital = s.status === "active" && (capitals.has(s.id) || s.tier === "capital");
    const near = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx = 0, dy = 0]) => {
      const nx = s.x + dx;
      const ny = s.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const c = cells[ny * width + nx];
      return Boolean(c && (c.biome === "ocean" || c.river));
    });
    return {
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y,
      tier: visualTier(s.tier, isCapital),
      rawTier: s.tier,
      level: s.level,
      status: s.status,
      population: s.population,
      buildings: s.buildings,
      construction: s.construction
        ? { type: s.construction.type, progress: s.construction.progress, required: s.construction.required }
        : null,
      isCapital,
      epidemic: s.epidemic,
      tribeId: s.tribeId,
      tribeName: tribe?.name ?? "",
      civilizationId: civ?.id ?? null,
      civilizationName: civ?.name ?? null,
      color: civ?.color ?? tribe?.color ?? "#e6dcc4",
      food: s.stock.food,
      stability: s.status === "active" ? Math.round((1 - s.unrest) * 100) : null,
      techs: (tribe?.techs ?? []).map((id) => techName.get(id) ?? id),
      foundedYear: s.foundedYear,
      abandonedYear: s.abandonedYear,
      nearWater: near,
    };
  });

  // Each tribe's seat: its largest active settlement, or where the band currently camps.
  const seat = new Map<string, { x: number; y: number; settlementId: string | null }>();
  for (const s of [...detail.settlements].sort((a, b) => b.population - a.population)) {
    if (s.status === "active" && !seat.has(s.tribeId))
      seat.set(s.tribeId, { x: s.x, y: s.y, settlementId: s.id });
  }
  for (const t of detail.tribes) if (!seat.has(t.id)) seat.set(t.id, { x: t.x, y: t.y, settlementId: null });

  const settledCells = new Set(
    detail.settlements.filter((s) => s.status === "active").map((s) => s.y * width + s.x),
  );
  const nomads = detail.tribes
    .filter((t) => t.status === "nomadic" && t.population > 0 && !settledCells.has(t.y * width + t.x))
    .map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, population: t.population, color: t.color }));

  // Roads: links between neighbouring road cells (each pair once).
  const roads: RoadViewModel[] = [];
  for (let i = 0; i < total; i++) {
    if (!cells[i]?.road) continue;
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
      if (nx >= width || ny < 0 || ny >= height) continue;
      if (!cells[ny * width + nx]?.road) continue;
      // Skip a diagonal when the two straight neighbours already join the cells.
      if (dx !== 0 && dy !== 0 && (cells[y * width + nx]?.road || cells[ny * width + x]?.road)) continue;
      roads.push({ from: { x, y }, to: { x: nx, y: ny } });
    }
  }

  const tradeRoutes: TradeRouteViewModel[] = detail.relationships
    .filter((r) => r.tradeVolume > 5 && !r.atWar)
    .sort((a, b) => b.tradeVolume - a.tradeVolume || a.aId.localeCompare(b.aId))
    .slice(0, options.maxTradeRoutes ?? 12)
    .flatMap((r) => {
      const a = seat.get(r.aId);
      const b = seat.get(r.bId);
      if (!a || !b || (a.x === b.x && a.y === b.y)) return [];
      return [
        {
          id: `${r.aId}:${r.bId}`,
          aId: r.aId,
          bId: r.bId,
          aName: tribeById.get(r.aId)?.tribe.name ?? "",
          bName: tribeById.get(r.bId)?.tribe.name ?? "",
          from: { x: a.x, y: a.y },
          to: { x: b.x, y: b.y },
          settlementIds: [a.settlementId, b.settlementId].filter((id): id is string => Boolean(id)),
          volume: r.tradeVolume,
        },
      ];
    });

  // Conflicts: one entry per war, anchored on the shared front or on the latest battle.
  const tribeOwnerGrid = { width, height, owner: m.owner, elevation: cells.map((c) => c.elevation) };
  const battlesByPair = new Map<string, BattleViewModel[]>();
  for (const e of options.battles ?? []) {
    if (e.type !== "battle" || e.x === null || e.y === null) continue;
    const ids = e.actors.filter((a) => a.kind === "tribe").map((a) => a.id);
    if (ids.length < 2) continue;
    const key = [ids[0], ids[1]].sort().join(":");
    const md = e.metadata;
    const list = battlesByPair.get(key) ?? [];
    list.push({
      id: e.id,
      x: e.x,
      y: e.y,
      year: e.year,
      title: e.title,
      attackerWarriors: Number(md.attackerWarriors ?? 0) || 0,
      defenderWarriors: Number(md.defenderWarriors ?? 0) || 0,
      attackerLosses: Number(md.attackerLosses ?? 0) || 0,
      defenderLosses: Number(md.defenderLosses ?? 0) || 0,
    });
    battlesByPair.set(key, list);
  }
  const wars = detail.relationships
    .filter((r) => r.atWar || r.phase === "war" || r.phase === "raid")
    .sort((a, b) => b.battles - a.battles || b.hostility - a.hostility || a.aId.localeCompare(b.aId))
    .slice(0, options.maxConflicts ?? 16);
  const warRegionPairs = new Set<string>();
  const conflicts: ConflictViewModel[] = wars.flatMap((r) => {
    const a = tribeById.get(r.aId);
    const b = tribeById.get(r.bId);
    if (!a || !b) return [];
    const ra = tribeRegion[a.index] ?? -1;
    const rb = tribeRegion[b.index] ?? -1;
    if (ra >= 0 && rb >= 0 && r.atWar) {
      warRegionPairs.add(`${ra}:${rb}`);
      warRegionPairs.add(`${rb}:${ra}`);
    }
    const front = [
      ...sharedEdges(tribeOwnerGrid, a.index, b.index),
      ...sharedEdges(tribeOwnerGrid, b.index, a.index),
    ];
    const recent = (battlesByPair.get([r.aId, r.bId].sort().join(":")) ?? []).sort((p, q) => q.year - p.year);
    const sa = seat.get(r.aId) ?? { x: a.tribe.x, y: a.tribe.y };
    const sb = seat.get(r.bId) ?? { x: b.tribe.x, y: b.tribe.y };
    let anchor: { x: number; y: number };
    const latest = recent[0];
    if (latest) anchor = { x: latest.x + 0.5, y: latest.y + 0.5 };
    else if (front.length) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const p of front)
        for (const q of p.points) {
          sx += q.x;
          sy += q.y;
          n++;
        }
      anchor = { x: sx / n, y: sy / n };
    } else anchor = { x: (sa.x + sb.x) / 2 + 0.5, y: (sa.y + sb.y) / 2 + 0.5 };
    const casualties = recent.reduce((sum, bt) => sum + bt.attackerLosses + bt.defenderLosses, 0);
    return [
      {
        id: `${r.aId}:${r.bId}`,
        aId: r.aId,
        bId: r.bId,
        aName: a.tribe.name,
        bName: b.tribe.name,
        aColor: a.tribe.color,
        bColor: b.tribe.color,
        phase: r.phase,
        startYear: r.warStartYear,
        battles: r.battles,
        hostility: r.hostility,
        front,
        anchor,
        campaign: front.length ? null : { from: { x: sa.x, y: sa.y }, to: { x: sb.x, y: sb.y } },
        recentBattles: recent.slice(0, 8),
        casualties,
      },
    ];
  });

  const regionOwner = cells.map((c) => c.region);
  const borders = computeBorders(
    { width, height, owner: regionOwner, elevation: cells.map((c) => c.elevation) },
    (p, q) => warRegionPairs.has(`${p}:${q}`),
  );

  const civilizations = detail.civilizations.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    capitalSettlementId: c.capitalSettlementId,
    population: c.population,
    status: c.status,
  }));

  const crises = detail.crises.flatMap((c) => {
    const target =
      detail.settlements.find((s) => s.id === c.targetId) ?? detail.tribes.find((t) => t.id === c.targetId);
    return target ? [{ id: c.id, kind: c.kind, x: target.x, y: target.y, severity: c.severity }] : [];
  });

  return {
    width,
    height,
    seed,
    year: detail.world.currentYear,
    cells,
    regions,
    settlements,
    nomads,
    civilizations,
    roads,
    borders,
    tradeRoutes,
    conflicts,
    hazards: detail.world.climate.hazards.map((h) => ({ ...h })),
    crises,
    layers: options.layers ?? DEFAULT_LAYERS,
  };
}
