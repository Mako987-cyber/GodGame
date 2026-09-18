/**
 * Isometric map renderer (Canvas 2D).
 *
 * Owns the canvas, the chunk cache and the derived render data; React only feeds it a view model,
 * a camera and the viewport, and asks it to render when something changed (render on demand).
 */
import { sharedAssetRegistry, type AssetRegistry } from "./asset-registry";
import { drawBorders } from "./border-renderer";
import { visibleWorldRect, type Viewport } from "./camera";
import { PALETTE, withAlpha } from "./color-palette";
import { drawBattleIcon, drawConflictLines, drawCrisisIcon, drawHazards } from "./conflict-renderer";
import { effectiveElevations } from "./elevation-renderer";
import { pickCell, pickRegion, targetKey, type HitRegion, type HitTarget } from "./hit-testing";
import { FpsMeter, emptyStats, now, type FrameStats } from "./performance";
import {
  createProjection,
  gridToScreen,
  mapWorldBounds,
  screenToWorld,
  tileCorners,
  type CameraState,
  type IsoProjectionConfig,
  type Rect,
} from "./projection";
import { sortByDepth } from "./render-order";
import { clusterResources, drawResourceIcon } from "./resource-renderer";
import { drawTradeRoutes } from "./route-renderer";
import { buildSettlementLayout, type SettlementLayout } from "./settlement-layout";
import {
  drawLabel,
  drawSettlementIcon,
  measureLabel,
  nomadSprites,
  rectsOverlap,
  settlementSprites,
  type LabelStyle,
  type Sprite,
} from "./settlement-renderer";
import {
  CHUNK_SIZE,
  ChunkCache,
  DIRECT_DRAW_SCALE,
  chunkBucket,
  chunkCells,
  chunkGrid,
  chunkSignature,
  drawChunkTiles,
  type ChunkInfo,
} from "./terrain-renderer";
import { drawTile, drawTileDecorations, hasTallDecoration, type TerrainContext } from "./tile-renderer";
import type {
  IsometricMapViewModel,
  MapLayerVisibility,
  SelectedMapEntity,
  SettlementViewModel,
} from "./types";
import { ZOOM, labelZoomFor, resourceClusterSize, settlementZoomFor } from "./visibility";

export interface RenderOptions {
  camera: CameraState;
  viewport: Viewport;
  dpr: number;
  hover: HitTarget | null;
  focus: { x: number; y: number } | null;
}

export interface RenderResult {
  stats: FrameStats;
  /** True when some chunks were drawn without cache and another frame will finish baking them. */
  needsAnotherFrame: boolean;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function layerKey(layers: MapLayerVisibility): number {
  const keys: (keyof MapLayerVisibility)[] = [
    "terrain",
    "elevation",
    "water",
    "rivers",
    "roads",
    "fertility",
    "territories",
  ];
  return keys.reduce((k, id, n) => k | (layers[id] ? 1 << n : 0), 0);
}

export class IsometricRenderer {
  readonly config: IsoProjectionConfig;
  readonly bounds: Rect;
  readonly registry: AssetRegistry;
  private vm: IsometricMapViewModel;
  private elevation: Int8Array = new Int8Array(0);
  private cleared: Uint8Array = new Uint8Array(0);
  private layouts = new Map<string, SettlementLayout>();
  private occluders = new Map<string, number[]>();
  private spriteCache = new Map<string, Sprite[]>();
  private readonly chunks: ChunkInfo[];
  private signatures = new Map<string, number>();
  private readonly cache: ChunkCache;
  private hitRegions: HitRegion[] = [];
  private readonly fps = new FpsMeter();
  private lastStats = emptyStats();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    vm: IsometricMapViewModel,
    registry?: AssetRegistry,
  ) {
    this.config = createProjection(vm.width, vm.height);
    this.bounds = mapWorldBounds(vm.width, vm.height, this.config);
    this.registry = registry ?? sharedAssetRegistry;
    this.chunks = chunkGrid(vm.width, vm.height, this.config);
    this.cache = new ChunkCache(() =>
      typeof document !== "undefined" ? document.createElement("canvas") : null,
    );
    this.vm = vm;
    this.rebuild();
  }

  /** True when `vm` describes the same world (size and seed), so it can be applied incrementally. */
  accepts(vm: IsometricMapViewModel): boolean {
    return vm.width === this.vm.width && vm.height === this.vm.height && vm.seed === this.vm.seed;
  }

  /** Same world required (see `accepts`); a different world needs a new renderer. */
  setViewModel(vm: IsometricMapViewModel) {
    if (!this.accepts(vm)) throw new Error("La mappa appartiene a un altro mondo");
    const layersChanged = layerKey(vm.layers) !== layerKey(this.vm.layers);
    const dataChanged = vm.cells !== this.vm.cells || vm.settlements !== this.vm.settlements || layersChanged;
    this.vm = vm;
    if (dataChanged) this.rebuild();
  }

  get stats(): FrameStats {
    return this.lastStats;
  }

  get hitRegionCount(): number {
    return this.hitRegions.length;
  }

  elevationAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= this.vm.width || y >= this.vm.height) return 0;
    return this.elevation[y * this.vm.width + x] ?? 0;
  };

  /** World-space anchor of a grid cell centre (for camera centring). */
  cellCenter(x: number, y: number) {
    return gridToScreen(x + 0.5, y + 0.5, this.elevationAt(Math.floor(x), Math.floor(y)), this.config);
  }

  layoutOf(settlementId: string): SettlementLayout | undefined {
    return this.layouts.get(settlementId);
  }

  dispose() {
    this.cache.clear();
    this.hitRegions = [];
  }

  private rebuild() {
    const { vm } = this;
    const { width, height } = vm;
    this.elevation = effectiveElevations(vm.cells, vm.layers);
    this.layouts.clear();
    this.occluders.clear();
    this.spriteCache.clear();
    const cleared = new Uint8Array(width * height);
    const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    for (const s of vm.settlements) {
      const base = this.elevationAt(s.x, s.y);
      const layout = buildSettlementLayout(s, vm.seed, {
        width,
        height,
        buildable: (x, y) => {
          if (!inBounds(x, y)) return false;
          const c = vm.cells[y * width + x];
          return Boolean(
            c &&
            c.biome !== "ocean" &&
            c.biome !== "mountain" &&
            Math.abs(this.elevationAt(x, y) - base) <= 1,
          );
        },
        isWater: (x, y) => inBounds(x, y) && vm.cells[y * width + x]?.biome === "ocean",
        isRocky: (x, y) => {
          const b = inBounds(x, y) ? vm.cells[y * width + x]?.biome : undefined;
          return b === "hills" || b === "mountain";
        },
      });
      this.layouts.set(s.id, layout);
      if (s.status === "active") for (const i of layout.cells) cleared[i] = 1;
    }
    this.cleared = cleared;

    // Tiles in front of a settlement that are higher or carry tall decorations must be redrawn
    // after its buildings, or a house behind a hill would be painted over the hill.
    for (const s of vm.settlements) {
      const layout = this.layouts.get(s.id);
      if (!layout) continue;
      const base = this.elevationAt(s.x, s.y);
      const set = new Set<number>();
      for (const i of layout.cells) {
        const x0 = i % width;
        const y0 = Math.floor(i / width);
        for (let dy = 0; dy <= 2; dy++) {
          for (let dx = 0; dx <= 2; dx++) {
            if (dx + dy === 0 && i === s.y * width + s.x) continue;
            const x = x0 + dx;
            const y = y0 + dy;
            if (!inBounds(x, y)) continue;
            const j = y * width + x;
            const c = vm.cells[j];
            if (!c) continue;
            const higher = (this.elevation[j] ?? 0) > base;
            const tall = hasTallDecoration(c) && !(c.biome === "forest" && cleared[j]);
            if (higher || tall) set.add(j);
          }
        }
      }
      this.occluders.set(s.id, [...set]);
    }

    const tc = this.terrainContext(1);
    const key = layerKey(vm.layers);
    this.signatures = new Map(this.chunks.map((c) => [`${c.cx}:${c.cy}`, chunkSignature(c, tc, key)]));
    this.cache.invalidate(this.signatures);
  }

  private terrainContext(detail: number): TerrainContext {
    const { vm } = this;
    return {
      width: vm.width,
      height: vm.height,
      cells: vm.cells,
      regions: vm.regions,
      elevation: this.elevation,
      config: this.config,
      layers: vm.layers,
      cleared: this.cleared,
      detail,
    };
  }

  private regionOf(sel: SelectedMapEntity | undefined): number {
    if (!sel) return -1;
    if (sel.kind === "civilization")
      return this.vm.regions.findIndex((r) => r.kind === "civilization" && r.id === sel.id);
    if (sel.kind === "tribe") return this.vm.regions.findIndex((r) => r.tribeIds.includes(sel.id));
    return -1;
  }

  private settlementSpritesFor(s: SettlementViewModel, minor: boolean, order: number): Sprite[] {
    const key = `${s.id}|${minor ? 1 : 0}`;
    const cached = this.spriteCache.get(key);
    if (cached) return cached;
    const layout = this.layouts.get(s.id);
    if (!layout) return [];
    const sprites = settlementSprites(s, layout, this.elevationAt, this.config, this.registry, {
      minor,
      order,
    });
    this.spriteCache.set(key, sprites);
    return sprites;
  }

  /** Target under a screen point, using the hit regions of the last frame and elevation-aware cell picking. */
  pick(screenX: number, screenY: number, camera: CameraState): { target: HitTarget | null; ms: number } {
    const t0 = now();
    const region = pickRegion(this.hitRegions, screenX, screenY);
    let target: HitTarget | null = region?.target ?? null;
    if (!target) {
      const world = screenToWorld(screenX, screenY, camera);
      const cell = pickCell(world, this.vm.width, this.vm.height, this.elevationAt, this.config);
      if (cell) target = { type: "cell", x: cell.x, y: cell.y };
    }
    return { target, ms: now() - t0 };
  }

  render(opts: RenderOptions): RenderResult {
    const t0 = now();
    const { camera, viewport, dpr } = opts;
    const { vm, config } = this;
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

    // Background.
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

    // World transform.
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * camera.x, dpr * camera.y);
    const view = visibleWorldRect(camera, viewport);
    const margin = 40 * px;
    const cull: Rect = {
      x: view.x - margin,
      y: view.y - margin,
      width: view.width + margin * 2,
      height: view.height + margin * 2,
    };

    // Terrain: cached chunks, or direct drawing when zoomed in beyond the cache resolution.
    const scale = zoom * dpr;
    const direct = scale > DIRECT_DRAW_SCALE;
    const bucket = chunkBucket(zoom, dpr);
    const tc = this.terrainContext(direct ? zoom : bucket / dpr);
    let visibleChunks = 0;
    let visibleTiles = 0;
    for (const chunk of this.chunks) {
      if (!intersects(chunk.rect, cull)) continue;
      visibleChunks++;
      if (direct) {
        for (const i of chunkCells(chunk, vm.width)) {
          const c = vm.cells[i];
          if (!c) continue;
          const p = gridToScreen(c.x + 0.5, c.y + 0.5, this.elevation[i] ?? 0, config);
          if (p.x < cull.x - config.tileWidth || p.x > cull.x + cull.width + config.tileWidth) continue;
          if (p.y < cull.y - config.tileHeight * 2 || p.y > cull.y + cull.height + 120) continue;
          drawTile(ctx, tc, i);
          drawTileDecorations(ctx, tc, i);
        }
        continue;
      }
      const sig = this.signatures.get(`${chunk.cx}:${chunk.cy}`) ?? 0;
      const bitmap = this.cache.get(chunk, bucket, sig, tc);
      if (bitmap) ctx.drawImage(bitmap, chunk.rect.x, chunk.rect.y, chunk.rect.width, chunk.rect.height);
      else {
        drawChunkTiles(ctx, chunk, tc);
        needsAnotherFrame = true;
      }
    }
    for (let i = 0; i < vm.cells.length; i++) {
      const c = vm.cells[i];
      if (!c) continue;
      const p = gridToScreen(c.x + 0.5, c.y + 0.5, this.elevation[i] ?? 0, config);
      if (p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height)
        visibleTiles++;
    }

    // Territory borders (the fill is baked in the chunks).
    const highlightRegion = this.regionOf(selection);
    if (layers.territories) {
      drawBorders(ctx, vm.borders, config, {
        zoom,
        highlight: highlightRegion,
        color: (r) => vm.regions[r]?.color ?? "#ffffff",
      });
    }

    if (layers.debugGrid) {
      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const c of vm.cells) {
        const pts = tileCorners(c.x, c.y, this.elevation[c.index] ?? 0, config);
        const [a, b, d, e] = pts;
        if (!intersects({ x: e.x, y: a.y, width: b.x - e.x, height: d.y - a.y }, cull)) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(d.x, d.y);
        ctx.lineTo(e.x, e.y);
        ctx.closePath();
      }
      ctx.stroke();
    }

    // Entities: settlements with buildings, nomad camps, and the tiles that must cover them.
    const showBuildings = layers.settlements && layers.buildings && zoom >= ZOOM.buildings;
    const worldToScreenRect = (r: Rect): Rect => ({
      x: r.x * zoom + camera.x,
      y: r.y * zoom + camera.y,
      width: r.width * zoom,
      height: r.height * zoom,
    });
    if (layers.settlements) {
      const sprites: Sprite[] = [];
      const occluderTiles = new Set<number>();
      if (showBuildings) {
        vm.settlements.forEach((s, order) => {
          const layout = this.layouts.get(s.id);
          if (!layout) return;
          const c = gridToScreen(layout.center.x, layout.center.y, this.elevationAt(s.x, s.y), config);
          const reach = (layout.radius + 1) * config.tileWidth;
          if (!intersects({ x: c.x - reach, y: c.y - reach, width: reach * 2, height: reach * 1.5 }, cull))
            return;
          // Houses of big places appear a little earlier than those of villages and camps.
          const urban = s.tier === "town" || s.tier === "city" || s.tier === "capital";
          const minor = zoom >= ZOOM.minorBuildings || (urban && zoom >= ZOOM.urbanBuildings);
          sprites.push(...this.settlementSpritesFor(s, minor, order));
          // Occlusion by terrain only matters once buildings are big enough to notice it.
          if (zoom >= ZOOM.occlusion) for (const i of this.occluders.get(s.id) ?? []) occluderTiles.add(i);
        });
      }
      if (zoom >= ZOOM.buildings) {
        vm.nomads.forEach((band, k) =>
          sprites.push(...nomadSprites(band, this.elevationAt, config, 5000 + k)),
        );
      }
      for (const i of occluderTiles) {
        const c = vm.cells[i];
        if (!c) continue;
        sprites.push({
          gx: c.x + 0.001,
          gy: c.y + 0.001,
          kind: "tile",
          order: i,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          draw: (g) => {
            drawTile(g, tc, i);
            drawTileDecorations(g, tc, i);
          },
        });
      }
      sortByDepth(sprites);
      for (const sp of sprites) {
        if (sp.kind !== "tile" && !intersects(sp.bounds, cull)) continue;
        sp.draw(ctx);
        entities++;
        if (sp.target)
          hits.push({ ...worldToScreenRect(sp.bounds), depth: sp.gx + sp.gy, target: sp.target });
      }
    }

    // Resources (discrete, clustered at low zoom).
    if (layers.resources) {
      const markers = clusterResources(vm.cells, vm.width, resourceClusterSize(zoom));
      const r = 6.5 * px;
      for (const m of markers) {
        const p = gridToScreen(m.gx, m.gy, m.elevation, config);
        if (p.x < cull.x || p.x > cull.x + cull.width || p.y < cull.y || p.y > cull.y + cull.height) continue;
        drawResourceIcon(ctx, m.kind, p.x, p.y - 4 * px, r);
        if (m.count > 1) {
          ctx.font = `600 ${9 * px}px system-ui, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillStyle = PALETTE.label;
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.lineWidth = 2.5 * px;
          ctx.strokeText(String(m.count), p.x + r * 0.9, p.y + r * 0.2);
          ctx.fillText(String(m.count), p.x + r * 0.9, p.y + r * 0.2);
        }
        entities++;
        const s = { x: p.x * zoom + camera.x, y: (p.y - 4 * px) * zoom + camera.y };
        hits.push({
          x: s.x - 8,
          y: s.y - 8,
          width: 16,
          height: 16,
          circle: true,
          depth: m.gx + m.gy,
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
      const drawn = drawTradeRoutes(ctx, vm.tradeRoutes, this.elevationAt, config, zoom, (route) =>
        Boolean(
          (selSettlement && route.settlementIds.includes(selSettlement)) ||
          (selTribe && (route.aId === selTribe || route.bId === selTribe)) ||
          hoverKey === `trade:${route.id}`,
        ),
      );
      for (const d of drawn) {
        const s = { x: d.mid.x * zoom + camera.x, y: d.mid.y * zoom + camera.y };
        hits.push({
          x: s.x - 7,
          y: s.y - 7,
          width: 14,
          height: 14,
          circle: true,
          depth: 0,
          target: { type: "trade", id: d.route.id },
        });
      }
    }

    // Conflicts and hazards.
    const selectedWar = selection?.kind === "war" ? `${selection.aId}:${selection.bId}` : null;
    if (layers.conflicts) {
      drawHazards(ctx, vm.hazards, config, zoom);
      drawConflictLines(ctx, vm.conflicts, this.elevationAt, config, zoom, selectedWar);
    }

    // Selection and hover, in world space.
    const outlineCell = (x: number, y: number, color: string, width: number) => {
      const pts = tileCorners(x, y, this.elevationAt(x, y), config);
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.beginPath();
      pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    };
    const ringAround = (sid: string, color: string, width: number) => {
      const layout = this.layouts.get(sid);
      const s = vm.settlements.find((x) => x.id === sid);
      if (!layout || !s) return;
      const c = gridToScreen(layout.center.x, layout.center.y, this.elevationAt(s.x, s.y), config);
      const r = Math.max(layout.radius + 0.25, 0.6);
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r * config.tileWidth * 0.72, r * config.tileHeight * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (opts.hover?.type === "cell")
      outlineCell(opts.hover.x, opts.hover.y, withAlpha(PALETTE.hover, 0.8), 1.5);
    if (opts.hover?.type === "settlement") ringAround(opts.hover.id, withAlpha(PALETTE.hover, 0.7), 1.5);
    if (opts.hover?.type === "building")
      ringAround(opts.hover.settlementId, withAlpha(PALETTE.hover, 0.6), 1.2);
    if (selection?.kind === "cell") outlineCell(selection.x, selection.y, PALETTE.selection, 2.5);
    if (selection?.kind === "settlement") ringAround(selection.id, PALETTE.selection, 2.5);
    if (selection?.kind === "tribe") {
      const band = vm.nomads.find((n) => n.id === selection.id);
      if (band) outlineCell(band.x, band.y, PALETTE.selection, 2.5);
    }
    if (opts.focus) {
      const c = this.cellCenter(opts.focus.x, opts.focus.y);
      ctx.strokeStyle = withAlpha(PALETTE.selection, 0.85);
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, config.tileWidth * 1.3, config.tileHeight * 1.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Screen-space pass: icons, markers and labels keep a constant size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (gx: number, gy: number, e: number) => {
      const w = gridToScreen(gx, gy, e, config);
      return { x: w.x * zoom + camera.x, y: w.y * zoom + camera.y };
    };
    const onScreen = (p: { x: number; y: number }, pad = 40) =>
      p.x > -pad && p.y > -pad && p.x < viewport.width + pad && p.y < viewport.height + pad;

    const labelCandidates: {
      text: string;
      x: number;
      y: number;
      color: string;
      style: LabelStyle;
      rank: number;
      target: HitTarget;
    }[] = [];
    if (layers.settlements) {
      vm.settlements.forEach((s) => {
        const layout = this.layouts.get(s.id);
        if (!layout) return;
        const selected = selection?.kind === "settlement" && selection.id === s.id;
        const hovered =
          hoverKey === `settlement:${s.id}` ||
          (opts.hover?.type === "building" && opts.hover.settlementId === s.id);
        if (s.status === "abandoned" && zoom < 0.9 && !selected && !hovered) return;
        if (zoom < settlementZoomFor(s.tier) && !selected && !hovered) return;
        const e = this.elevationAt(s.x, s.y);
        const centre = toScreen(layout.center.x, layout.center.y, e);
        if (!onScreen(centre, 120)) return;
        let top = centre.y;
        if (!showBuildings) {
          const r = drawSettlementIcon(ctx, s, centre.x, centre.y, zoom < 0.25 ? 0.85 : 1);
          top = centre.y - r - (s.tier === "capital" ? r * 1.3 : 0);
          hits.push({
            x: centre.x - r - 3,
            y: centre.y - r - 3,
            width: r * 2 + 6,
            height: r * 2 + 6,
            depth: s.x + s.y,
            target: { type: "settlement", id: s.id },
          });
          entities++;
        } else {
          const rw = (layout.radius + 0.3) * config.tileWidth * 0.75 * zoom;
          const rh = (layout.radius + 0.3) * config.tileHeight * 0.75 * zoom;
          top = centre.y - rh * 0.85 - 16 * zoom;
          hits.push({
            x: centre.x - rw,
            y: centre.y - rh - 20 * zoom,
            width: rw * 2,
            height: rh * 2 + 20 * zoom,
            circle: true,
            depth: s.x + s.y,
            target: { type: "settlement", id: s.id },
          });
          if (s.tier === "capital") {
            // Capital halo under the name, visible among the buildings.
            ctx.strokeStyle = withAlpha(PALETTE.gold, 0.55);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(centre.x, centre.y, rw * 1.05, rh * 1.05, 0, 0, Math.PI * 2);
            ctx.stroke();
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
        if (!layers.labels && !selected && !hovered) return;
        // Ruins are named only when pointed at or selected, never as background noise.
        const minLabelZoom = s.status === "abandoned" ? Number.POSITIVE_INFINITY : labelZoomFor(s.tier);
        if (zoom < minLabelZoom && !selected && !hovered) return;
        const rankByTier = { capital: 5, city: 4, town: 3, village: 2, camp: 1 } as const;
        const emphasis: LabelStyle["emphasis"] =
          s.tier === "capital"
            ? "capital"
            : s.tier === "city"
              ? "city"
              : s.tier === "camp" || s.status === "abandoned"
                ? "minor"
                : "normal";
        labelCandidates.push({
          text: s.status === "abandoned" ? `Rovine di ${s.name}` : s.name,
          x: centre.x,
          y: top - 4,
          color: s.color,
          style: { emphasis, selected: selected || hovered },
          rank:
            (selected ? 100 : hovered ? 50 : 0) + rankByTier[s.tier] * 10 + Math.min(9, s.population / 100),
          target: { type: "settlement", id: s.id },
        });
      });

      if (!showBuildings) {
        for (const band of vm.nomads) {
          const p = toScreen(band.x + 0.5, band.y + 0.5, this.elevationAt(band.x, band.y));
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
            depth: band.x + band.y,
            target: { type: "nomad", id: band.id },
          });
        }
      }
    }

    if (layers.conflicts) {
      for (const crisis of vm.crises) {
        const p = toScreen(crisis.x + 0.5, crisis.y + 0.5, this.elevationAt(crisis.x, crisis.y));
        if (!onScreen(p)) continue;
        drawCrisisIcon(ctx, p.x - 14, p.y - 18, 6, crisis);
      }
      for (const c of vm.conflicts) {
        const p = toScreen(
          c.anchor.x,
          c.anchor.y,
          this.elevationAt(Math.floor(c.anchor.x), Math.floor(c.anchor.y)),
        );
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

    // Labels: highest rank first, skipped when they would overlap one already placed.
    const placed: Rect[] = [];
    labelCandidates.sort((a, b) => b.rank - a.rank);
    for (const l of labelCandidates) {
      const rect = measureLabel(ctx, l.text, l.x, l.y, l.style);
      if (!l.style.selected && placed.some((p) => rectsOverlap(p, rect))) continue;
      placed.push(rect);
      drawLabel(ctx, l.text, rect, l.color, l.style);
      hits.push({ ...rect, depth: 1e6, target: l.target });
    }
    // Region names at overview zoom, only where there is room.
    if (layers.labels && layers.territories && zoom < ZOOM.regionLabels) {
      const regions = vm.regions
        .map((r, k) => ({ r, k }))
        .filter(({ r, k }) => r.centroid && (r.cellCount >= 14 || k === highlightRegion))
        .sort((a, b) => b.r.cellCount - a.r.cellCount);
      for (const { r } of regions) {
        if (!r.centroid) continue;
        const cx = Math.floor(r.centroid.x);
        const cy = Math.floor(r.centroid.y);
        const p = toScreen(r.centroid.x, r.centroid.y, this.elevationAt(cx, cy));
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
        ctx.strokeStyle = "rgba(8, 14, 18, 0.55)";
        ctx.strokeText(text, p.x, rect.y + size / 2);
        ctx.fillStyle = withAlpha(r.color, 0.9);
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

  recordHitTest(ms: number) {
    this.lastStats = { ...this.lastStats, hitTestMs: ms };
  }
}

export { CHUNK_SIZE };
