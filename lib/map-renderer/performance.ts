/** Frame statistics for the debug panel. Cheap enough to stay on in production. */
export interface FrameStats {
  fps: number;
  frameMs: number;
  visibleTiles: number;
  totalTiles: number;
  entities: number;
  visibleChunks: number;
  cachedChunks: number;
  chunkBuilds: number;
  hitTestMs: number;
  zoom: number;
}

export function emptyStats(): FrameStats {
  return {
    fps: 0,
    frameMs: 0,
    visibleTiles: 0,
    totalTiles: 0,
    entities: 0,
    visibleChunks: 0,
    cachedChunks: 0,
    chunkBuilds: 0,
    hitTestMs: 0,
    zoom: 1,
  };
}

/** Exponential moving average of frame intervals; frames far apart (idle map) reset the estimate. */
export class FpsMeter {
  private last = 0;
  private avg = 0;

  tick(now: number): number {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    if (dt <= 0 || dt > 250) return this.value;
    this.avg = this.avg ? this.avg * 0.9 + dt * 0.1 : dt;
    return this.value;
  }

  get value(): number {
    return this.avg ? Math.round(1000 / this.avg) : 0;
  }
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
