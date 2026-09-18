import { describe, expect, it } from "vitest";
import {
  RENDER_PASSES,
  compareDepth,
  passIndex,
  sortByDepth,
  tileDrawOrder,
  type DepthSortable,
} from "@/lib/map-renderer/render-order";

describe("ordine di rendering", () => {
  it("i passaggi seguono l'ordine previsto", () => {
    expect(passIndex("terrain")).toBeLessThan(passIndex("elevation"));
    expect(passIndex("roads")).toBeLessThan(passIndex("territory"));
    expect(passIndex("buildings")).toBeLessThan(passIndex("settlements"));
    expect(passIndex("tradeRoutes")).toBeLessThan(passIndex("selection"));
    expect(RENDER_PASSES[0]).toBe("background");
  });

  it("tileDrawOrder visita ogni cella una volta, dal fondo verso l'osservatore", () => {
    const order = tileDrawOrder(5, 3);
    expect(new Set(order).size).toBe(15);
    let last = -1;
    for (const i of order) {
      const d = (i % 5) + Math.floor(i / 5);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });

  it("un tile ridisegnato sta davanti agli edifici delle celle dietro e dietro a quelli sulla sua cella", () => {
    const behind: DepthSortable = { gx: 3.9, gy: 3.9, kind: "object", order: 1 };
    const tile: DepthSortable = { gx: 4.001, gy: 3.001, kind: "tile", order: 2 };
    const onTile: DepthSortable = { gx: 4.2, gy: 3.1, kind: "object", order: 3 };
    // (3.9, 3.9) has a larger exact depth than the tile anchor, but stands on the cell behind.
    expect(sortByDepth([onTile, tile, behind])).toEqual([behind, tile, onTile]);
  });

  it("è stabile a parità di profondità", () => {
    const a: DepthSortable = { gx: 2.5, gy: 2.5, kind: "object", order: 1 };
    const b: DepthSortable = { gx: 2.5, gy: 2.5, kind: "object", order: 2 };
    expect(compareDepth(a, b)).toBeLessThan(0);
    expect(compareDepth(b, a)).toBeGreaterThan(0);
  });
});
