/**
 * Hex map renderer (Canvas 2D).
 *
 * Same contract as the isometric renderer (see `MapRenderer`): React feeds a view model, a camera
 * and a viewport and asks for a frame when something changed. Static terrain is baked in chunk
 * bitmaps; borders, grid, entities, markers and labels are drawn per frame with zoom-dependent
 * detail: biomes and big territories far away, grid, fields, buildings and resources up close.
 */
import { sharedAssetRegistry, type AssetRegistry } from "../asset-registry";
import { clampCameraToRect, visibleWorldRect, type Viewport } from "../camera";
import { PALETTE, withAlpha } from "../color-palette";
import { drawBattleIcon, drawCampaignArrow, drawCrisisIcon } from "../conflict-renderer";
import { pickRegion, targetKey, type HitRegion, type HitTarget } from "../hit-testing";
import type { MapRenderer, RenderOptions, RenderResult } from "../map-renderer";
import { FpsMeter, emptyStats, now, type FrameStats } from "../performance";
import { screenToWorld, type CameraState, type Rect } from "../projection";
import { clusterResources, drawResourceIcon } from "../resource-renderer";
import { quadraticPoint, routeWidth, tradeCurve } from "../route-renderer";
import {
  drawLabel,
  drawSettlementIcon,
  measureLabel,
  rectsOverlap,
  type LabelStyle,
} from "../settlement-renderer";
import { ChunkCache, DIRECT_DRAW_SCALE, chunkBucket, type ChunkInfo } from "../terrain-renderer";
import type { IsometricMapViewModel, MapLayerVisibility, SelectedMapEntity } from "../types";
import { ZOOM, labelZoomFor, resourceClusterSize, settlementZoomFor } from "../visibility";
import { computeHexBorders, hexSharedEdges, insetPolyline, type HexBorderRun } from "./borders";
import { HexGrid, type Point } from "./geometry";
import { riverLinks, roadLinks } from "./hex-links";
import {
  drawHexChunk,
  drawHexDecorations,
  drawHexTile,
  hexChunkGrid,
  hexChunkSignature,
  hexHasTallDecoration,
  rectsIntersect,
  type HexTerrainContext,
} from "./hex-terrain";
import {
  buildHexSettlementLayout,
  drawSettlementGround,
  hexNomadSprites,
  hexSettlementSprites,
  type HexSettlementLayout,
  type HexSprite,
} from "./hex-settlements";

/** Zoom above which thin details (grid, secondary borders) are drawn. */
export const HEX_ZOOM = {
  grid: 0.5,
  borders: 0.3,
} as const;

function layerKey(layers: MapLayerVisibility): number {
  const keys: (keyof MapLayerVisibility)[] = [
    "terrain",
    "elevation",
    "water",
    "rivers",
    "roads",
    "fertility",
    "territories",
    "climate",
  ];
  return keys.reduce((k, id, n) => k | (layers[id] ? 1 << n : 0), 0);
}

interface ConflictGeometry {
  id: string;
  front: HexBorderRun[];
}

export class HexRenderer implements MapRenderer {
  readonly grid: HexGrid;
  readonly bounds: Rect;
  readonly registry: AssetRegistry;
  private vm: IsometricMapViewModel;
  private elevation: Int8Array = new Int8Array(0);
  private cleared: Uint8Array = new Uint8Array(0);
  private rivers: Uint8Array = new Uint8Array(0);
  private roads: Uint8Array = new Uint8Array(0);
  private layouts = new Map<string, HexSettlementLayout>();
  private occluders = new Map<string, number[]>();
  private spriteCache = new Map<string, HexSprite[]>();
  private borders: HexBorderRun[] = [];
  private fronts: ConflictGeometry[] = [];
  private readonly chunks: ChunkInfo[];
  private signatures = new Map<string, number>();
  private readonly cache: ChunkCache<HexTerrainContext>;
  private hitRegions: HitRegion[] = [];
  private hatch: CanvasPattern | null = null;
  private readonly fps = new FpsMeter();
  private lastStats = emptyStats();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    vm: IsometricMapViewModel,
    registry?: AssetRegistry,
  ) {
    this.grid = new HexGrid(vm.width, vm.height);
    this.bounds = this.grid.bounds();
    this.registry = registry ?? sharedAssetRegistry;
    this.chunks = hexChunkGrid(this.grid);
    this.cache = new ChunkCache<HexTerrainContext>(
      () => (typeof document !== "undefined" ? document.createElement("canvas") : null),
      drawHexChunk,
    );
    this.vm = vm;
    this.rebuild();
  }

  accepts(vm: IsometricMapViewModel): boolean {
    return vm.width === this.vm.width && vm.height === this.vm.height && vm.seed === this.vm.seed;
  }

  setViewModel(vm: IsometricMapViewModel) {
    if (!this.accepts(vm)) throw new Error("La mappa appartiene a un altro mondo");
    const layersChanged = layerKey(vm.layers) !== layerKey(this.vm.layers);
    const dataChanged = vm.cells !== this.vm.cells || vm.settlements !== this.vm.settlements || layersChanged;
    const conflictsChanged = vm.conflicts !== this.vm.conflicts;
    this.vm = vm;
    if (dataChanged) this.rebuild();
    else if (conflictsChanged) this.rebuildFronts();
  }

  get stats(): FrameStats {
    return this.lastStats;
  }

  cellCenter(x: number, y: number): Point {
    return this.grid.center(Math.floor(x), Math.floor(y));
  }

  clampCamera(camera: CameraState, viewport: Viewport): CameraState {
    return clampCameraToRect(camera, viewport, this.bounds);
  }

  dispose() {
    this.cache.clear();
    this.hitRegions = [];
  }

  recordHitTest(ms: number) {
    this.lastStats = { ...this.lastStats, hitTestMs: ms };
  }

  private terrainContext(detail: number): HexTerrainContext {
    const { vm } = this;
    return {
      grid: this.grid,
      cells: vm.cells,
      regions: vm.regions,
      layers: vm.layers,
      elevation: this.elevation,
      cleared: this.cleared,
      rivers: this.rivers,
      roads: this.roads,
      detail,
    };
  }

  private rebuild() {
    const { vm, grid } = this;
    this.elevation = new Int8Array(vm.cells.length);
    for (let i = 0; i < vm.cells.length; i++) {
      const e = vm.cells[i]?.elevation ?? 0;
      this.elevation[i] = vm.layers.elevation ? e : e > 0 ? 1 : 0;
    }
    this.rivers = riverLinks(grid, vm.cells);
    this.roads = roadLinks(grid, vm.cells);
    this.layouts.clear();
    this.occluders.clear();
    this.spriteCache.clear();
    const cleared = new Uint8Array(vm.cells.length);
    for (const s of vm.settlements) {
      if (!grid.inBounds(s.x, s.y)) continue;
      const h = buildHexSettlementLayout(s, vm.seed, grid, vm.cells);
      this.layouts.set(s.id, h);
      if (s.status === "active") for (const i of h.cells) cleared[i] = 1;
    }
    this.cleared = cleared;
    // Hexes below a settlement whose trees or peaks would stand in front of its buildings.
    for (const s of vm.settlements) {
      const h = this.layouts.get(s.id);
      if (!h || s.status !== "active") continue;
      const reach = s.tier === "capital" || s.tier === "city" ? 2 : 1;
      const list = grid
        .range(s.x, s.y, reach)
        .filter((p) => p.y > s.y)
        .map((p) => grid.index(p.x, p.y))
        .filter((i) => {
          const c = vm.cells[i];
          return c !== undefined && hexHasTallDecoration(c, Boolean(cleared[i]));
        });
      this.occluders.set(s.id, list);
    }

    const warPairs = new Set<string>();
    const tribeRegion = new Map<string, number>();
    vm.regions.forEach((r, k) => r.tribeIds.forEach((t) => tribeRegion.set(t, k)));
    for (const c of vm.conflicts) {
      if (c.phase !== "war") continue;
      const a = tribeRegion.get(c.aId);
      const b = tribeRegion.get(c.bId);
      if (a !== undefined && b !== undefined) {
        warPairs.add(`${a}:${b}`);
        warPairs.add(`${b}:${a}`);
      }
    }
    this.borders = computeHexBorders(
      grid,
      vm.cells.map((c) => c.region),
      (a, b) => warPairs.has(`${a}:${b}`),
    );
    this.rebuildFronts();

    const tc = this.terrainContext(1);
    const key = layerKey(vm.layers);
    this.signatures = new Map(this.chunks.map((c) => [`${c.cx}:${c.cy}`, hexChunkSignature(c, tc, key)]));
    this.cache.invalidate(this.signatures);
  }

  private rebuildFronts() {
    const { vm, grid } = this;
    const tribeIndex = new Map(vm.tribeIds.map((id, k) => [id, k]));
    const owner = vm.cells.map((c) => c.tribe);
    this.fronts = vm.conflicts.map((c) => {
      const a = tribeIndex.get(c.aId);
      const b = tribeIndex.get(c.bId);
      const front = a === undefined || b === undefined ? [] : hexSharedEdges(grid, owner, a, b);
      return { id: c.id, front };
    });
  }

  private regionOf(sel: SelectedMapEntity | undefined): number {
    if (!sel) return -1;
    if (sel.kind === "civilization")
      return this.vm.regions.findIndex((r) => r.kind === "civilization" && r.id === sel.id);
    if (sel.kind === "tribe") return this.vm.regions.findIndex((r) => r.tribeIds.includes(sel.id));
    if (sel.kind === "settlement") {
      const s = this.vm.settlements.find((x) => x.id === sel.id);
      return s ? this.vm.regions.findIndex((r) => r.tribeIds.includes(s.tribeId)) : -1;
    }
    return -1;
  }

  pick(screenX: number, screenY: number, camera: CameraState): { target: HitTarget | null; ms: number } {
    const t0 = now();
    const region = pickRegion(this.hitRegions, screenX, screenY);
    let target: HitTarget | null = region?.target ?? null;
    if (!target) {
      const w = screenToWorld(screenX, screenY, camera);
      const cell = this.grid.cellAt(w.x, w.y);
      if (cell) target = { type: "cell", x: cell.x, y: cell.y };
    }
    return { target, ms: now() - t0 };
  }

  private hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.hatch || typeof document === "undefined") return this.hatch;
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 8;
    const g = tile.getContext("2d");
    if (!g) return null;
    g.strokeStyle = "rgba(255, 244, 214, 0.2)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-2, 10);
    g.lineTo(10, -2);
    g.moveTo(6, 10);
    g.lineTo(10, 6);
    g.moveTo(-2, 2);
    g.lineTo(2, -2);
    g.stroke();
    this.hatch = ctx.createPattern(tile, "repeat");
    return this.hatch;
  }

  private hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, grow = 0) {
    const c = this.grid.center(x, y);
    const k = grow ? 1 + grow / this.grid.size : 1;
    this.grid.corners.forEach((p, n) =>
      n === 0 ? ctx.moveTo(c.x + p.x * k, c.y + p.y * k) : ctx.lineTo(c.x + p.x * k, c.y + p.y * k),
    );
    ctx.closePath();
  }

  render(opts: RenderOptions): RenderResult {
    const t0 = now();
    const { camera, viewport, dpr } = opts;
    const { vm, grid } = this;
    const layers = vm.layers;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");
    const zoom = camera.zoom;
    const px = 1 / zoom;
    const hits: HitRegion[] = [];
    const selection = vm.selectedEntity;
    const hoverKey = targetKey(opts.hover);
    let entities = 0;
    let needsAnotherFrame = false;
    this.cache.beginFrame();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(
      viewport.width / 2,
      viewport.height / 2,
      0,
      viewport.width / 2,
      viewport.height / 2,
      Math.max(viewport.width, viewport.height) * 0.75,
    );
    bg.addColorStop(0, "#132631");
    bg.addColorStop(1, PALETTE.background);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * camera.x, dpr * camera.y);
    const view = visibleWorldRect(camera, viewport);
    const margin = 40 * px;
    const cull: Rect = {
      x: view.x - margin,
      y: view.y - margin,
      width: view.width + margin * 2,
      height: view.height + margin * 2,
    };
    // Visible cell range (rows and columns), used by every per-cell pass.
    const row0 = Math.max(0, Math.floor((cull.y - grid.originY) / grid.rowStep) - 1);
    const row1 = Math.min(
      grid.height - 1,
      Math.ceil((cull.y + cull.height - grid.originY) / grid.rowStep) + 1,
    );
    const col0 = Math.max(0, Math.floor((cull.x - grid.originX) / grid.colStep) - 1);
    const col1 = Math.min(grid.width - 1, Math.ceil((cull.x + cull.width - grid.originX) / grid.colStep) + 1);
    const visibleTiles = Math.max(0, row1 - row0 + 1) * Math.max(0, col1 - col0 + 1);

    // Map base: a soft shadow under the whole landmass block.
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fillRect(this.bounds.x + 6, this.bounds.y + 8, this.bounds.width, this.bounds.height);

    // Terrain.
    const scale = zoom * dpr;
    const direct = scale > DIRECT_DRAW_SCALE;
    const bucket = chunkBucket(zoom, dpr);
    const tc = this.terrainContext(direct ? zoom : bucket / dpr);
    let visibleChunks = 0;
    if (direct) {
      for (let y = row0; y <= row1; y++)
        for (let x = col0; x <= col1; x++) drawHexTile(ctx, tc, grid.index(x, y));
      for (let y = row0; y <= row1; y++)
        for (let x = col0; x <= col1; x++) drawHexDecorations(ctx, tc, grid.index(x, y));
      visibleChunks = 0;
    } else {
      for (const chunk of this.chunks) {
        if (!rectsIntersect(chunk.rect, cull)) continue;
        visibleChunks++;
        const sig = this.signatures.get(`${chunk.cx}:${chunk.cy}`) ?? 0;
        const bitmap = this.cache.get(chunk, bucket, sig, tc);
        if (bitmap) ctx.drawImage(bitmap, chunk.rect.x, chunk.rect.y, chunk.rect.width, chunk.rect.height);
        else {
          drawHexChunk(ctx, chunk, tc);
          needsAnotherFrame = true;
        }
      }
    }

    // Hex grid: only when zoomed in, fading in so it never becomes a rigid, noisy net.
    if ((layers.hexGrid || layers.debugGrid) && zoom >= HEX_ZOOM.grid) {
      const alpha = layers.debugGrid ? 0.35 : Math.min(0.16, (zoom - HEX_ZOOM.grid) * 0.3 + 0.04);
      ctx.strokeStyle = `rgba(245, 238, 220, ${alpha})`;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let y = row0; y <= row1; y++) for (let x = col0; x <= col1; x++) this.hexPath(ctx, x, y);
      ctx.stroke();
    }

    // Territory: hatch over the highlighted region, then borders.
    const highlightRegion = this.regionOf(selection);
    if (layers.territories && highlightRegion >= 0) {
      const pattern = this.hatchPattern(ctx);
      if (pattern) {
        ctx.save();
        ctx.fillStyle = pattern;
        // Patterns are drawn in world space: keep the stripes about 8 screen px apart.
        pattern.setTransform?.(new DOMMatrix([px, 0, 0, px, 0, 0]));
        ctx.beginPath();
        for (let y = row0; y <= row1; y++)
          for (let x = col0; x <= col1; x++)
            if (vm.cells[grid.index(x, y)]?.region === highlightRegion) this.hexPath(ctx, x, y);
        ctx.fill();
        ctx.restore();
      }
    }
    if (layers.territories || layers.conflicts) this.drawBorders(ctx, zoom, highlightRegion, cull);

    if (layers.debugGrid && zoom >= 0.9) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `${9 * px}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let y = row0; y <= row1; y++)
        for (let x = col0; x <= col1; x++) {
          const c = grid.center(x, y);
          ctx.fillText(`${x},${y}`, c.x, c.y);
        }
    }

    // Entities.
    const showBuildings = layers.settlements && layers.buildings && zoom >= ZOOM.buildings;
    const toScreenRect = (r: Rect): Rect => ({
      x: r.x * zoom + camera.x,
      y: r.y * zoom + camera.y,
      width: r.width * zoom,
      height: r.height * zoom,
    });
    if (layers.settlements) {
      const sprites: HexSprite[] = [];
      const occluding = new Set<number>();
      if (showBuildings) {
        vm.settlements.forEach((s, order) => {
          const h = this.layouts.get(s.id);
          if (!h) return;
          const c = h.frame.origin;
          const area = {
            x: c.x - h.rx - 30,
            y: c.y - h.ry - 60,
            width: h.rx * 2 + 60,
            height: h.ry * 2 + 80,
          };
          if (!rectsIntersect(area, cull)) return;
          drawSettlementGround(ctx, h);
          const urban = s.tier === "town" || s.tier === "city" || s.tier === "capital";
          const minor = zoom >= ZOOM.minorBuildings || (urban && zoom >= ZOOM.urbanBuildings);
          const key = `${s.id}|${minor ? 1 : 0}`;
          let list = this.spriteCache.get(key);
          if (!list) {
            list = hexSettlementSprites(s, h, grid, vm.cells, this.registry, { minor, order });
            this.spriteCache.set(key, list);
          }
          sprites.push(...list);
          if (zoom >= ZOOM.occlusion) for (const i of this.occluders.get(s.id) ?? []) occluding.add(i);
        });
        vm.nomads.forEach((band, k) => sprites.push(...hexNomadSprites(band, grid, 5000 + k)));
      }
      for (const i of occluding) {
        const c = vm.cells[i];
        if (!c) continue;
        const centre = grid.center(c.x, c.y);
        sprites.push({
          y: centre.y - grid.size * 0.4,
          order: i,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          draw: (g) => drawHexDecorations(g, tc, i),
        });
      }
      sprites.sort((a, b) => a.y - b.y || a.order - b.order);
      for (const sp of sprites) {
        if (sp.bounds.width > 0 && !rectsIntersect(sp.bounds, cull)) continue;
        sp.draw(ctx);
        entities++;
        if (sp.target) hits.push({ ...toScreenRect(sp.bounds), depth: sp.y, target: sp.target });
      }
    }

    // Resources: clustered far away, one per hex up close.
    if (layers.resources) {
      const markers = clusterResources(vm.cells, vm.width, resourceClusterSize(zoom));
      const r = 6.5 * px;
      for (const m of markers) {
        const p = grid.gridPoint(m.gx, m.gy);
        if (p.x < cull.x || p.x > cull.x + cull.width || p.y < cull.y || p.y > cull.y + cull.height) continue;
        const py = p.y + grid.size * 0.35;
        drawResourceIcon(ctx, m.kind, p.x, py, r);
        if (m.count > 1) {
          ctx.font = `600 ${9 * px}px system-ui, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillStyle = PALETTE.label;
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.lineWidth = 2.5 * px;
          ctx.strokeText(String(m.count), p.x + r * 0.9, py + r * 0.2);
          ctx.fillText(String(m.count), p.x + r * 0.9, py + r * 0.2);
        }
        entities++;
        const s = { x: p.x * zoom + camera.x, y: py * zoom + camera.y };
        hits.push({
          x: s.x - 8,
          y: s.y - 8,
          width: 16,
          height: 16,
          circle: true,
          depth: p.y,
          target: {
            type: "resource",
            kind: m.kind,
            count: m.count,
            x: Math.floor(m.gx),
            y: Math.floor(m.gy),
          },
        });
      }
    }

    // Trade routes.
    if (layers.tradeRoutes && vm.tradeRoutes.length) {
      const selSettlement = selection?.kind === "settlement" ? selection.id : null;
      const selTribe = selection?.kind === "tribe" ? selection.id : null;
      const strongOf = (id: string, aId: string, bId: string, ids: string[]) =>
        Boolean(
          (selSettlement && ids.includes(selSettlement)) ||
          (selTribe && (aId === selTribe || bId === selTribe)) ||
          hoverKey === `trade:${id}`,
        );
      const anyStrong = vm.tradeRoutes.some((r) => strongOf(r.id, r.aId, r.bId, r.settlementIds));
      for (const route of vm.tradeRoutes) {
        const a = grid.center(route.from.x, route.from.y);
        const b = grid.center(route.to.x, route.to.y);
        const curve = tradeCurve({ x: a.x, y: a.y - 8 }, { x: b.x, y: b.y - 8 }, route.id);
        const strong = strongOf(route.id, route.aId, route.bId, route.settlementIds);
        const alpha = strong ? 0.95 : anyStrong ? 0.2 : 0.55;
        const w = routeWidth(route.volume) * (strong ? 1.4 : 1);
        for (const [lw, col, dash] of [
          [w + 1.5, `rgba(20, 16, 8, ${alpha * 0.3})`, false],
          [w, withAlpha(PALETTE.trade, alpha), true],
        ] as const) {
          ctx.strokeStyle = col;
          ctx.lineWidth = lw * px;
          ctx.setLineDash(dash ? [7 * px, 5 * px] : []);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(curve.from.x, curve.from.y);
          ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const mid = quadraticPoint(curve, 0.5);
        const s = { x: mid.x * zoom + camera.x, y: mid.y * zoom + camera.y };
        hits.push({
          x: s.x - 7,
          y: s.y - 7,
          width: 14,
          height: 14,
          circle: true,
          depth: 0,
          target: { type: "trade", id: route.id },
        });
      }
    }

    // Conflicts and hazards (world space).
    const selectedWar = selection?.kind === "war" ? `${selection.aId}:${selection.bId}` : null;
    if (layers.conflicts) {
      for (const h of vm.hazards) {
        if (!grid.inBounds(h.x, h.y)) continue;
        const c = grid.center(h.x, h.y);
        const color = h.kind === "drought" ? "#d6b25a" : h.kind === "flood" ? "#5fa8d3" : "#e0703f";
        ctx.fillStyle = withAlpha(color, 0.08);
        ctx.strokeStyle = withAlpha(color, 0.75);
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath();
        ctx.ellipse(
          c.x,
          c.y,
          (h.radius + 0.5) * grid.colStep,
          (h.radius + 0.5) * grid.rowStep,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const c of vm.conflicts) {
        const strong = c.id === selectedWar;
        const dim = selectedWar !== null && !strong;
        const geometry = this.fronts.find((f) => f.id === c.id);
        if (geometry?.front.length) {
          for (const [w, col, dash] of [
            [7, withAlpha(PALETTE.war, dim ? 0.08 : 0.22), false],
            [strong ? 3 : 2.2, withAlpha(PALETTE.war, dim ? 0.35 : 0.95), true],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = w * px;
            ctx.setLineDash(dash ? [5 * px, 3 * px] : []);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (const run of geometry.front) {
              run.points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
              if (run.closed) ctx.closePath();
            }
            ctx.stroke();
          }
          ctx.setLineDash([]);
        } else if (c.campaign) {
          const a = grid.center(c.campaign.from.x, c.campaign.from.y);
          const b = grid.center(c.campaign.to.x, c.campaign.to.y);
          drawCampaignArrow(ctx, a, b, px, dim ? 0.3 : strong ? 1 : 0.8);
        }
        if (!dim) {
          for (const bt of c.recentBattles) {
            if (!grid.inBounds(bt.x, bt.y)) continue;
            const p = grid.center(bt.x, bt.y);
            ctx.fillStyle = withAlpha(PALETTE.war, 0.3);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, grid.size * 0.45, grid.size * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = withAlpha(PALETTE.war, 0.9);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.2 * px, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // Selection and hover.
    const glowCell = (x: number, y: number, color: string, width: number, fill: number) => {
      if (!grid.inBounds(x, y)) return;
      ctx.beginPath();
      this.hexPath(ctx, x, y);
      if (fill > 0) {
        ctx.fillStyle = withAlpha(color, fill);
        ctx.fill();
      }
      ctx.lineJoin = "round";
      ctx.strokeStyle = withAlpha(color, 0.25);
      ctx.lineWidth = (width + 4) * px;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.stroke();
    };
    const ringAround = (sid: string, color: string, width: number) => {
      const h = this.layouts.get(sid);
      if (!h) return;
      const c = h.frame.origin;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.beginPath();
      ctx.ellipse(
        c.x,
        c.y,
        Math.max(h.rx, grid.colStep * 0.45),
        Math.max(h.ry, grid.size * 0.5),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    };
    if (opts.hover?.type === "cell") glowCell(opts.hover.x, opts.hover.y, PALETTE.hover, 1.4, 0.08);
    if (opts.hover?.type === "settlement") ringAround(opts.hover.id, withAlpha(PALETTE.hover, 0.7), 1.5);
    if (opts.hover?.type === "building")
      ringAround(opts.hover.settlementId, withAlpha(PALETTE.hover, 0.6), 1.2);
    if (selection?.kind === "cell") glowCell(selection.x, selection.y, PALETTE.selection, 2.4, 0.12);
    if (selection?.kind === "settlement") ringAround(selection.id, PALETTE.selection, 2.5);
    if (selection?.kind === "tribe") {
      const band = vm.nomads.find((n) => n.id === selection.id);
      if (band) glowCell(band.x, band.y, PALETTE.selection, 2.4, 0.1);
    }
    if (opts.focus && grid.inBounds(opts.focus.x, opts.focus.y)) {
      const c = grid.center(opts.focus.x, opts.focus.y);
      ctx.strokeStyle = withAlpha(PALETTE.selection, 0.85);
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, grid.size * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Screen-space pass: icons, markers and labels keep a constant size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (p: Point) => ({ x: p.x * zoom + camera.x, y: p.y * zoom + camera.y });
    const onScreen = (p: Point, pad = 40) =>
      p.x > -pad && p.y > -pad && p.x < viewport.width + pad && p.y < viewport.height + pad;
    const labels: {
      text: string;
      x: number;
      y: number;
      color: string;
      style: LabelStyle;
      rank: number;
      target: HitTarget;
    }[] = [];
    if (layers.settlements) {
      for (const s of vm.settlements) {
        const h = this.layouts.get(s.id);
        if (!h) continue;
        const selected = selection?.kind === "settlement" && selection.id === s.id;
        const hovered =
          hoverKey === `settlement:${s.id}` ||
          (opts.hover?.type === "building" && opts.hover.settlementId === s.id);
        if (s.status === "abandoned" && zoom < 0.9 && !selected && !hovered) continue;
        if (zoom < settlementZoomFor(s.tier) && !selected && !hovered) continue;
        const centre = toScreen(h.frame.origin);
        if (!onScreen(centre, 120)) continue;
        let top = centre.y;
        if (!showBuildings) {
          const r = drawSettlementIcon(ctx, s, centre.x, centre.y, zoom < 0.25 ? 0.85 : 1);
          top = centre.y - r - (s.tier === "capital" ? r * 1.3 : 0);
          hits.push({
            x: centre.x - r - 3,
            y: centre.y - r - 3,
            width: r * 2 + 6,
            height: r * 2 + 6,
            depth: h.frame.origin.y,
            target: { type: "settlement", id: s.id },
          });
          entities++;
        } else {
          const rw = Math.max(h.rx, grid.colStep * 0.4) * zoom;
          const rh = Math.max(h.ry, grid.size * 0.45) * zoom;
          top = centre.y - rh - 18 * zoom;
          hits.push({
            x: centre.x - rw,
            y: centre.y - rh - 20 * zoom,
            width: rw * 2,
            height: rh * 2 + 20 * zoom,
            circle: true,
            depth: h.frame.origin.y,
            target: { type: "settlement", id: s.id },
          });
          if (s.tier === "capital" && s.status === "active") {
            ctx.strokeStyle = withAlpha(PALETTE.gold, 0.55);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(centre.x, centre.y, rw * 1.08, rh * 1.08, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          // Owner banner: a small pennant in the civilization's colour marks whose town it is.
          if (s.status === "active") {
            ctx.fillStyle = s.color;
            ctx.strokeStyle = "rgba(10,14,16,0.85)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(centre.x + rw * 0.72, top + 10);
            ctx.lineTo(centre.x + rw * 0.72, top - 4);
            ctx.lineTo(centre.x + rw * 0.72 + 9, top);
            ctx.lineTo(centre.x + rw * 0.72, top + 3);
            ctx.stroke();
            ctx.fill();
          }
        }
        if (s.epidemic && s.status === "active") {
          ctx.fillStyle = PALETTE.war;
          ctx.strokeStyle = "rgba(0,0,0,0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(centre.x + 10, top + 2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (!layers.labels && !selected && !hovered) continue;
        const minLabelZoom = s.status === "abandoned" ? Number.POSITIVE_INFINITY : labelZoomFor(s.tier);
        if (zoom < minLabelZoom && !selected && !hovered) continue;
        const rankByTier = { capital: 5, city: 4, town: 3, village: 2, camp: 1 } as const;
        const emphasis: LabelStyle["emphasis"] =
          s.tier === "capital"
            ? "capital"
            : s.tier === "city"
              ? "city"
              : s.tier === "camp" || s.status === "abandoned"
                ? "minor"
                : "normal";
        labels.push({
          text: s.status === "abandoned" ? `Rovine di ${s.name}` : s.name,
          x: centre.x,
          y: top - 4,
          color: s.color,
          style: { emphasis, selected: selected || hovered },
          rank:
            (selected ? 100 : hovered ? 50 : 0) + rankByTier[s.tier] * 10 + Math.min(9, s.population / 100),
          target: { type: "settlement", id: s.id },
        });
      }
      if (!showBuildings) {
        for (const band of vm.nomads) {
          const p = toScreen(grid.center(band.x, band.y));
          if (!onScreen(p)) continue;
          ctx.fillStyle = band.color;
          ctx.strokeStyle = "rgba(10,16,20,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          hits.push({
            x: p.x - 7,
            y: p.y - 7,
            width: 14,
            height: 14,
            circle: true,
            depth: p.y,
            target: { type: "nomad", id: band.id },
          });
        }
      }
    }
    if (layers.conflicts) {
      for (const crisis of vm.crises) {
        if (!grid.inBounds(crisis.x, crisis.y)) continue;
        const p = toScreen(grid.center(crisis.x, crisis.y));
        if (!onScreen(p)) continue;
        drawCrisisIcon(ctx, p.x - 14, p.y - 18, 6, crisis);
      }
      for (const c of vm.conflicts) {
        const p = toScreen(grid.gridPoint(c.anchor.x, c.anchor.y));
        if (!onScreen(p)) continue;
        const active = selectedWar === c.id || hoverKey === `conflict:${c.id}`;
        drawBattleIcon(ctx, p.x, p.y - 10, active ? 11 : 9, active);
        hits.push({
          x: p.x - 12,
          y: p.y - 22,
          width: 24,
          height: 24,
          circle: true,
          depth: 1e6,
          target: { type: "conflict", id: c.id },
        });
        entities++;
      }
    }

    const placed: Rect[] = [];
    labels.sort((a, b) => b.rank - a.rank);
    for (const l of labels) {
      const rect = measureLabel(ctx, l.text, l.x, l.y, l.style);
      if (!l.style.selected && placed.some((p) => rectsOverlap(p, rect))) continue;
      placed.push(rect);
      drawLabel(ctx, l.text, rect, l.color, l.style);
      hits.push({ ...rect, depth: 1e6, target: l.target });
    }
    if (layers.labels && layers.territories && zoom < ZOOM.regionLabels) {
      const regions = vm.regions
        .map((r, k) => ({ r, k }))
        .filter(({ r, k }) => r.centroid && (r.cellCount >= 14 || k === highlightRegion))
        .sort((a, b) => b.r.cellCount - a.r.cellCount);
      for (const { r } of regions) {
        if (!r.centroid) continue;
        const p = toScreen(grid.gridPoint(r.centroid.x, r.centroid.y));
        if (!onScreen(p)) continue;
        const size = Math.round(Math.max(12, Math.min(20, 10 + Math.sqrt(r.cellCount) * 0.6)));
        ctx.font = `600 ${size}px var(--font-alegreya), Georgia, serif`;
        const text = r.name.toUpperCase().split("").join(" ");
        const w = ctx.measureText(text).width;
        const rect = { x: p.x - w / 2, y: p.y - size / 2 + 18, width: w, height: size };
        if (placed.some((q) => rectsOverlap(q, rect, 6))) continue;
        placed.push(rect);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8, 14, 18, 0.6)";
        ctx.strokeText(text, p.x, rect.y + size / 2);
        ctx.fillStyle = withAlpha(r.color, 0.92);
        ctx.fillText(text, p.x, rect.y + size / 2);
      }
    }

    this.hitRegions = hits;
    const frameMs = now() - t0;
    this.lastStats = {
      fps: this.fps.tick(t0),
      frameMs,
      visibleTiles,
      totalTiles: vm.cells.length,
      entities,
      visibleChunks,
      cachedChunks: this.cache.size,
      chunkBuilds: this.cache.builds,
      hitTestMs: this.lastStats.hitTestMs,
      zoom,
    };
    return { stats: this.lastStats, needsAnotherFrame };
  }

  /**
   * Borders only where the owner changes. At overview zoom only the highlighted region and
   * contested stretches are stroked (the fill already shows territories); closer in every border
   * appears, inset towards its own region so neighbours sit side by side.
   */
  private drawBorders(ctx: CanvasRenderingContext2D, zoom: number, highlight: number, cull: Rect) {
    const px = 1 / zoom;
    const { layers } = this.vm;
    const showAll = layers.territories && zoom >= HEX_ZOOM.borders;
    const alpha = Math.max(0.45, Math.min(0.9, 0.35 + zoom * 0.5));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const b of this.borders) {
      const strong = b.region === highlight;
      if (!b.contested && !strong && !showAll) continue;
      if (!b.contested && !layers.territories) continue;
      if (b.contested && !(layers.conflicts || layers.territories)) continue;
      if (!this.runVisible(b, cull)) continue;
      const width = (b.contested ? 3 : strong ? 2.8 : 1.6) * px;
      const pts = insetPolyline(b.points, b.closed, width / 2 + 0.5 * px);
      const region = this.vm.regions[b.region];
      ctx.strokeStyle = b.contested
        ? withAlpha(PALETTE.war, 0.95)
        : withAlpha(region?.color ?? "#ffffff", strong ? 1 : alpha);
      ctx.lineWidth = width;
      ctx.setLineDash(b.contested ? [6 * px, 4 * px] : []);
      ctx.beginPath();
      pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      if (b.closed) ctx.closePath();
      ctx.stroke();
      if (strong && !b.contested) {
        // A dark hairline inside the highlighted border: readable on any terrain, not only by colour.
        ctx.strokeStyle = "rgba(8, 12, 14, 0.65)";
        ctx.lineWidth = px;
        ctx.setLineDash([]);
        ctx.beginPath();
        insetPolyline(b.points, b.closed, width + 1.2 * px).forEach((p, k) =>
          k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
        );
        if (b.closed) ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  private runVisible(run: HexBorderRun, cull: Rect): boolean {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of run.points) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return rectsIntersect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, cull);
  }
}
