import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYERS,
  ZOOM,
  detailLevel,
  labelZoomFor,
  resourceClusterSize,
  settlementZoomFor,
  toggleLayer,
} from "@/lib/map-renderer/visibility";
import { CHUNK_SIZE, chunkBucket, chunkCells, chunkGrid } from "@/lib/map-renderer/terrain-renderer";
import { createProjection } from "@/lib/map-renderer/projection";

describe("visibilità dei livelli", () => {
  it("default: terreno, acqua, fiumi, insediamenti, edifici e territori attivi; il resto spento", () => {
    for (const on of ["terrain", "water", "rivers", "settlements", "buildings", "territories"] as const) {
      expect(DEFAULT_LAYERS[on]).toBe(true);
    }
    for (const off of ["resources", "fertility", "tradeRoutes", "conflicts", "debugGrid"] as const) {
      expect(DEFAULT_LAYERS[off]).toBe(false);
    }
  });

  it("toggleLayer cambia solo il livello richiesto", () => {
    const next = toggleLayer(DEFAULT_LAYERS, "tradeRoutes");
    expect(next.tradeRoutes).toBe(true);
    expect({ ...next, tradeRoutes: false }).toEqual(DEFAULT_LAYERS);
  });

  it("soglie di zoom: capitali sempre, poi città, villaggi e accampamenti", () => {
    expect(labelZoomFor("capital")).toBe(0);
    expect(labelZoomFor("capital")).toBeLessThan(labelZoomFor("city"));
    expect(labelZoomFor("city")).toBeLessThan(labelZoomFor("town"));
    expect(labelZoomFor("town")).toBeLessThan(labelZoomFor("village"));
    expect(labelZoomFor("village")).toBeLessThan(labelZoomFor("camp"));
    expect(settlementZoomFor("capital")).toBe(0);
    expect(settlementZoomFor("camp")).toBeGreaterThan(0);
  });

  it("livelli di dettaglio e cluster delle risorse", () => {
    expect(detailLevel(0.2)).toBe("overview");
    expect(detailLevel(ZOOM.buildings)).toBe("regional");
    expect(detailLevel(2)).toBe("local");
    expect(resourceClusterSize(2)).toBe(1);
    expect(resourceClusterSize(0.8)).toBeGreaterThan(1);
    expect(resourceClusterSize(0.2)).toBeGreaterThan(resourceClusterSize(0.8));
  });
});

describe("chunk del terreno", () => {
  it("i chunk coprono ogni cella esattamente una volta", () => {
    const w = 40;
    const h = 20;
    const chunks = chunkGrid(w, h, createProjection(w, h));
    expect(chunks.length).toBe(Math.ceil(w / CHUNK_SIZE) * Math.ceil(h / CHUNK_SIZE));
    const seen = new Set<number>();
    for (const c of chunks) for (const i of chunkCells(c, w)) seen.add(i);
    expect(seen.size).toBe(w * h);
  });

  it("i bucket di risoluzione sono potenze di due limitate", () => {
    expect(chunkBucket(1, 1)).toBe(1);
    expect(chunkBucket(0.3, 1)).toBe(0.5);
    expect(chunkBucket(1, 2)).toBe(2);
    expect(chunkBucket(5, 2)).toBe(2);
    expect(chunkBucket(0.001, 1)).toBe(0.125);
  });
});
