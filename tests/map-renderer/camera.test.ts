import { describe, expect, it } from "vitest";
import {
  cameraCenter,
  centerOn,
  clampCameraToGrid,
  createFittedCamera,
  lerpCamera,
  pan,
  zoomAt,
} from "@/lib/map-renderer/camera";
import { createProjection, gridToScreen, worldToGrid, type CameraState } from "@/lib/map-renderer/projection";

const viewport = { width: 800, height: 600 };
const bounds = { x: 0, y: 0, width: 4000, height: 2000 };

const base: CameraState = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 3 };

describe("camera", () => {
  it("la vista iniziale contiene tutto il mondo ed è centrata", () => {
    const cam = createFittedCamera(bounds, viewport);
    expect(bounds.width * cam.zoom).toBeLessThanOrEqual(viewport.width);
    expect(bounds.height * cam.zoom).toBeLessThanOrEqual(viewport.height);
    const c = cameraCenter(cam, viewport);
    expect(c.x).toBeCloseTo(2000);
    expect(c.y).toBeCloseTo(1000);
    expect(cam.minZoom).toBeLessThan(cam.zoom);
  });

  it("lo zoom mantiene fermo il punto sotto il cursore", () => {
    const cam = { ...base, x: -300, y: -100 };
    const px = 250;
    const py = 410;
    const before = { x: (px - cam.x) / cam.zoom, y: (py - cam.y) / cam.zoom };
    const next = zoomAt(cam, 1.6, px, py);
    expect((px - next.x) / next.zoom).toBeCloseTo(before.x, 9);
    expect((py - next.y) / next.zoom).toBeCloseTo(before.y, 9);
  });

  it("lo zoom rispetta i limiti minimo e massimo", () => {
    expect(zoomAt(base, 100, 0, 0).zoom).toBe(3);
    expect(zoomAt(base, 0.0001, 0, 0).zoom).toBe(0.2);
  });

  it("il pan sposta la traslazione", () => {
    expect(pan(base, 12, -7)).toMatchObject({ x: 12, y: -7, zoom: 1 });
  });

  it("l'interpolazione parte e arriva esattamente alle due camere", () => {
    const a = centerOn(base, { x: 100, y: 100 }, viewport, 0.5);
    const b = centerOn(base, { x: 3000, y: 1500 }, viewport, 2);
    const start = lerpCamera(a, b, 0, viewport);
    const end = lerpCamera(a, b, 1, viewport);
    expect(start.x).toBeCloseTo(a.x);
    expect(start.zoom).toBeCloseTo(a.zoom);
    expect(end.x).toBeCloseTo(b.x);
    expect(end.y).toBeCloseTo(b.y);
    expect(end.zoom).toBeCloseTo(b.zoom);
  });

  it("clampCameraToGrid tiene il centro della vista sopra il rombo della mappa", () => {
    const config = createProjection(20, 20);
    // Centre on an empty corner of the bounding rectangle (grid x < 0).
    const corner = centerOn(base, { x: 0, y: 0 }, viewport);
    const clamped = clampCameraToGrid(corner, viewport, config, 20, 20);
    const c = cameraCenter(clamped, viewport);
    const g = worldToGrid(c.x, c.y, config);
    expect(g.x).toBeGreaterThanOrEqual(-1e-9);
    expect(g.y).toBeGreaterThanOrEqual(-1e-9);
    expect(g.x).toBeLessThanOrEqual(20);
    expect(g.y).toBeLessThanOrEqual(20);
    // A camera already over the map is left untouched.
    const inside = centerOn(base, gridToScreen(10, 10, 0, config), viewport);
    expect(clampCameraToGrid(inside, viewport, config, 20, 20)).toBe(inside);
  });
});
