import { describe, expect, it } from "vitest";
import {
  createProjection,
  gridToScreen,
  mapWorldBounds,
  screenToGrid,
  worldToGrid,
  type CameraState,
} from "@/lib/map-renderer/projection";

const config = { tileWidth: 64, tileHeight: 32, elevationStep: 6, originX: 500, originY: 100 };
const camera = (over: Partial<CameraState> = {}): CameraState => ({
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 4,
  ...over,
});

describe("proiezione isometrica 2:1", () => {
  it("applica la formula di base", () => {
    expect(gridToScreen(0, 0, 0, config)).toEqual({ x: 500, y: 100 });
    expect(gridToScreen(1, 0, 0, config)).toEqual({ x: 532, y: 116 });
    expect(gridToScreen(0, 1, 0, config)).toEqual({ x: 468, y: 116 });
    expect(gridToScreen(3, 2, 0, config)).toEqual({ x: 532, y: 180 });
  });

  it("solleva le celle in base all'elevazione", () => {
    expect(gridToScreen(2, 2, 3, config).y).toBe(gridToScreen(2, 2, 0, config).y - 18);
    expect(gridToScreen(2, 2, 3, config).x).toBe(gridToScreen(2, 2, 0, config).x);
  });

  it("round-trip griglia → schermo → griglia", () => {
    for (const [gx, gy] of [
      [0, 0],
      [3.25, 7.5],
      [63.9, 0.1],
      [12, 40],
    ] as const) {
      const s = gridToScreen(gx, gy, 0, config);
      const back = worldToGrid(s.x, s.y, config);
      expect(back.x).toBeCloseTo(gx, 9);
      expect(back.y).toBeCloseTo(gy, 9);
    }
  });

  it("screenToGrid tiene conto di pan e zoom", () => {
    const cam = camera({ x: -120, y: 45, zoom: 1.75 });
    const world = gridToScreen(5.5, 9.25, 0, config);
    const sx = world.x * cam.zoom + cam.x;
    const sy = world.y * cam.zoom + cam.y;
    const g = screenToGrid(sx, sy, cam, config);
    expect(g?.x).toBeCloseTo(5.5, 9);
    expect(g?.y).toBeCloseTo(9.25, 9);
  });

  it("restituisce null fuori dai bordi della mappa", () => {
    const outside = gridToScreen(-1, 3, 0, config);
    expect(screenToGrid(outside.x, outside.y, camera(), config, { width: 10, height: 10 })).toBeNull();
    const inside = gridToScreen(9.5, 9.5, 0, config);
    expect(screenToGrid(inside.x, inside.y, camera(), config, { width: 10, height: 10 })).not.toBeNull();
  });

  it("i limiti del mondo contengono tutti gli angoli della mappa", () => {
    const p = createProjection(32, 20);
    const b = mapWorldBounds(32, 20, p);
    for (const [x, y] of [
      [0, 0],
      [32, 0],
      [0, 20],
      [32, 20],
    ] as const) {
      const s = gridToScreen(x, y, 0, p);
      expect(s.x).toBeGreaterThanOrEqual(b.x);
      expect(s.x).toBeLessThanOrEqual(b.x + b.width);
      expect(s.y).toBeGreaterThanOrEqual(b.y);
      expect(s.y).toBeLessThanOrEqual(b.y + b.height);
    }
    expect(b.x).toBeGreaterThanOrEqual(0);
  });
});
