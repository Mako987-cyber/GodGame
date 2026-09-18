/**
 * Terrain chunks.
 *
 * The static part of the map (tiles, walls, water, rivers, roads, fields, territory fill and
 * decorations) is baked into offscreen canvases of CHUNK_SIZE × CHUNK_SIZE cells, one per zoom
 * bucket. Panning only blits bitmaps; a chunk is re-baked only when the cells it contains change
 * (signature mismatch), when the layers change, or when it is evicted by the memory budget.
 */
import {
  DECORATION_HEADROOM,
  MAX_ELEVATION,
  gridToScreen,
  type IsoProjectionConfig,
  type Rect,
} from "./projection";
import { hashInts } from "./seeded";
import { drawTile, drawTileDecorations, type TerrainContext } from "./tile-renderer";

export const CHUNK_SIZE = 16;
/** Maximum cached pixels across all chunks (≈ 4 bytes each). */
export const CHUNK_PIXEL_BUDGET = 24_000_000;
/** Chunks baked per frame at most; the rest are drawn directly this frame and baked later. */
export const CHUNK_BUILDS_PER_FRAME = 4;

/** Bitmap scale buckets: powers of two, so re-baking happens only when zoom changes a lot. */
export function chunkBucket(zoom: number, dpr: number): number {
  const scale = zoom * dpr;
  const b = Math.pow(2, Math.ceil(Math.log2(Math.max(scale, 1e-3))));
  return Math.min(2, Math.max(0.125, b));
}

/** Above this device scale chunks would be blurry; tiles are drawn directly (few are visible). */
export const DIRECT_DRAW_SCALE = 2.5;

export interface ChunkInfo {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** World-space bounds, including walls and decoration headroom. */
  rect: Rect;
}

export function chunkGrid(width: number, height: number, config: IsoProjectionConfig): ChunkInfo[] {
  const out: ChunkInfo[] = [];
  const cols = Math.ceil(width / CHUNK_SIZE);
  const rows = Math.ceil(height / CHUNK_SIZE);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * CHUNK_SIZE;
      const y0 = cy * CHUNK_SIZE;
      const x1 = Math.min(width, x0 + CHUNK_SIZE);
      const y1 = Math.min(height, y0 + CHUNK_SIZE);
      const left = gridToScreen(x0, y1, 0, config).x - 2;
      const right = gridToScreen(x1, y0, 0, config).x + 2;
      const top = gridToScreen(x0, y0, MAX_ELEVATION, config).y - DECORATION_HEADROOM;
      const bottom = gridToScreen(x1, y1, 0, config).y + config.elevationStep * (MAX_ELEVATION + 3);
      out.push({
        cx,
        cy,
        x0,
        y0,
        x1,
        y1,
        rect: { x: left, y: top, width: right - left, height: bottom - top },
      });
    }
  }
  // Back to front: chunks further away first.
  return out.sort((a, b) => a.cx + a.cy - (b.cx + b.cy) || a.cx - b.cx);
}

/** Cells of a chunk in back-to-front order. */
export function chunkCells(chunk: ChunkInfo, width: number): number[] {
  const out: number[] = [];
  const w = chunk.x1 - chunk.x0;
  const h = chunk.y1 - chunk.y0;
  for (let d = 0; d <= w + h - 2; d++) {
    for (let dx = Math.max(0, d - h + 1); dx <= Math.min(d, w - 1); dx++) {
      out.push((chunk.y0 + d - dx) * width + chunk.x0 + dx);
    }
  }
  return out;
}

/** Signature of everything a chunk's bitmap depends on. */
export function chunkSignature(chunk: ChunkInfo, tc: TerrainContext, layerKey: number): number {
  let h = layerKey >>> 0;
  // Walls depend on the row/column just outside the chunk too.
  for (let y = chunk.y0 - 1; y <= chunk.y1; y++) {
    for (let x = chunk.x0 - 1; x <= chunk.x1; x++) {
      if (x < 0 || y < 0 || x >= tc.width || y >= tc.height) continue;
      const i = y * tc.width + x;
      const c = tc.cells[i];
      if (!c) continue;
      h = hashInts(
        h,
        c.region,
        (tc.elevation[i] ?? 0) | (c.river ? 16 : 0) | (c.road ? 32 : 0) | ((tc.cleared[i] ?? 0) << 6),
        c.fields * 8 + c.pastures,
        Math.round(c.fertility * 16),
        c.biome.charCodeAt(0) + c.biome.charCodeAt(2),
      );
    }
  }
  return h;
}

/** Draws the tiles of a chunk (and their decorations) into `ctx`, already transformed to world space. */
export function drawChunkTiles(ctx: CanvasRenderingContext2D, chunk: ChunkInfo, tc: TerrainContext) {
  for (const i of chunkCells(chunk, tc.width)) {
    drawTile(ctx, tc, i);
    drawTileDecorations(ctx, tc, i);
  }
}

interface CacheEntry {
  canvas: HTMLCanvasElement;
  signature: number;
  pixels: number;
  lastUsed: number;
}

export class ChunkCache {
  private entries = new Map<string, CacheEntry>();
  private frame = 0;
  builds = 0;

  constructor(private readonly createCanvas: () => HTMLCanvasElement | null) {}

  get size(): number {
    return this.entries.size;
  }

  beginFrame() {
    this.frame++;
    this.builds = 0;
  }

  clear() {
    for (const e of this.entries.values()) releaseCanvas(e.canvas);
    this.entries.clear();
  }

  /** Drops entries whose signature no longer matches. */
  invalidate(signatures: Map<string, number>) {
    for (const [key, entry] of this.entries) {
      const chunkKey = key.slice(key.indexOf("|") + 1);
      if (signatures.get(chunkKey) !== entry.signature) {
        releaseCanvas(entry.canvas);
        this.entries.delete(key);
      }
    }
  }

  /**
   * Cached bitmap for a chunk at a bucket, baking it if the per-frame budget allows.
   * Returns null when the chunk must be drawn directly this frame.
   */
  get(chunk: ChunkInfo, bucket: number, signature: number, tc: TerrainContext): HTMLCanvasElement | null {
    const key = `${bucket}|${chunk.cx}:${chunk.cy}`;
    const hit = this.entries.get(key);
    if (hit && hit.signature === signature) {
      hit.lastUsed = this.frame;
      return hit.canvas;
    }
    if (this.builds >= CHUNK_BUILDS_PER_FRAME) return null;
    const canvas = hit?.canvas ?? this.createCanvas();
    if (!canvas) return null;
    const w = Math.max(1, Math.ceil(chunk.rect.width * bucket));
    const h = Math.max(1, Math.ceil(chunk.rect.height * bucket));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(bucket, 0, 0, bucket, -chunk.rect.x * bucket, -chunk.rect.y * bucket);
    ctx.clearRect(chunk.rect.x, chunk.rect.y, chunk.rect.width, chunk.rect.height);
    drawChunkTiles(ctx, chunk, tc);
    this.builds++;
    this.entries.set(key, { canvas, signature, pixels: w * h, lastUsed: this.frame });
    this.evict();
    return canvas;
  }

  private evict() {
    let total = 0;
    for (const e of this.entries.values()) total += e.pixels;
    if (total <= CHUNK_PIXEL_BUDGET) return;
    const byAge = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, e] of byAge) {
      if (total <= CHUNK_PIXEL_BUDGET * 0.8 || e.lastUsed === this.frame) break;
      total -= e.pixels;
      releaseCanvas(e.canvas);
      this.entries.delete(key);
    }
  }
}

/** Shrinking a canvas releases its backing store immediately on most browsers. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}
