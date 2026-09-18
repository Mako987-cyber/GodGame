import { describe, expect, it } from "vitest";
import { TIER_RADIUS, buildSettlementLayout, houseCount } from "@/lib/map-renderer/settlement-layout";
import type { SettlementVisualTier } from "@/lib/map-renderer/types";
import { OPEN_TERRAIN, settlement } from "./fixtures";

const TIERS: SettlementVisualTier[] = ["camp", "village", "town", "city", "capital"];

describe("layout degli insediamenti", () => {
  it("stesso seed e stesso insediamento producono lo stesso layout", () => {
    const s = settlement({
      tier: "town",
      population: 150,
      buildings: { hut: 6, storehouse: 2, market: 1, walls: 1 },
    });
    const a = buildSettlementLayout(s, "seed-1", OPEN_TERRAIN);
    const b = buildSettlementLayout(s, "seed-1", OPEN_TERRAIN);
    expect(b).toEqual(a);
  });

  it("seed diversi producono posizioni diverse", () => {
    const s = settlement({ tier: "village" });
    const a = buildSettlementLayout(s, "seed-1", OPEN_TERRAIN).buildings.map((b) => [b.gx, b.gy]);
    const b = buildSettlementLayout(s, "seed-2", OPEN_TERRAIN).buildings.map((b) => [b.gx, b.gy]);
    expect(b).not.toEqual(a);
  });

  it("i livelli crescono in numero di edifici e dimensione", () => {
    const layouts = TIERS.map((tier) =>
      buildSettlementLayout(
        settlement({
          tier,
          population: 400,
          buildings: { hut: 10, storehouse: 2, temple: 1, market: 1, walls: 1 },
        }),
        "seed",
        OPEN_TERRAIN,
      ),
    );
    for (let k = 1; k < layouts.length; k++) {
      expect(layouts[k]!.buildings.length).toBeGreaterThan(layouts[k - 1]!.buildings.length);
      expect(layouts[k]!.radius).toBeGreaterThan(layouts[k - 1]!.radius);
    }
    const kinds = (k: number) => new Set(layouts[k]!.buildings.map((b) => b.kind));
    expect(kinds(0).has("campfire")).toBe(true);
    expect(kinds(0).has("tent")).toBe(true);
    expect(kinds(1).has("hall")).toBe(true);
    expect(kinds(4).has("palace")).toBe(true);
    expect(kinds(4).has("tower")).toBe(true);
    expect(layouts[0]!.plaza).toBeNull();
    expect(layouts[2]!.streets.length).toBe(2);
  });

  it("gli accampamenti hanno da 2 a 5 tende, i villaggi da 5 a 12 abitazioni", () => {
    expect(houseCount("camp", 1, 0)).toBe(2);
    expect(houseCount("camp", 10_000, 0)).toBe(5);
    expect(houseCount("village", 0, 0)).toBe(5);
    expect(houseCount("village", 10_000, 50)).toBe(12);
  });

  it("gli edifici esistenti non si spostano quando l'insediamento cresce", () => {
    const small = buildSettlementLayout(
      settlement({ tier: "village", population: 60 }),
      "seed",
      OPEN_TERRAIN,
    );
    const big = buildSettlementLayout(settlement({ tier: "village", population: 200 }), "seed", OPEN_TERRAIN);
    expect(big.buildings.length).toBeGreaterThan(small.buildings.length);
    expect(big.buildings.slice(0, small.buildings.length)).toEqual(small.buildings);
  });

  it("gli edifici stanno solo su terreno edificabile e dentro il raggio", () => {
    const s = settlement({ x: 1, y: 12, tier: "city", population: 300, buildings: { hut: 12 } });
    const layout = buildSettlementLayout(s, "seed", OPEN_TERRAIN);
    for (const b of layout.buildings) {
      expect(OPEN_TERRAIN.buildable(Math.floor(b.gx), Math.floor(b.gy))).toBe(true);
      expect(Math.hypot(b.gx - layout.center.x, b.gy - layout.center.y)).toBeLessThanOrEqual(
        TIER_RADIUS.city + 0.35,
      );
    }
  });

  it("mura con torri solo se l'insediamento le ha costruite", () => {
    const walled = buildSettlementLayout(
      settlement({ tier: "city", buildings: { walls: 1 } }),
      "seed",
      OPEN_TERRAIN,
    );
    const open = buildSettlementLayout(settlement({ tier: "city", buildings: {} }), "seed", OPEN_TERRAIN);
    const palisade = buildSettlementLayout(
      settlement({ tier: "village", buildings: { palisade: 1 } }),
      "seed",
      OPEN_TERRAIN,
    );
    expect(walled.walls?.kind).toBe("walls");
    expect(walled.walls?.towers).toBe(true);
    expect(walled.walls?.gates.length).toBeGreaterThan(0);
    expect(open.walls).toBeNull();
    expect(palisade.walls?.kind).toBe("palisade");
  });

  it("miniere sulla roccia vicina e porti sull'acqua", () => {
    const s = settlement({ x: 13, y: 10, buildings: { mine: 1 } });
    const mine = buildSettlementLayout(s, "seed", OPEN_TERRAIN).buildings.find((b) => b.kind === "mine");
    expect(mine && [Math.floor(mine.gx), Math.floor(mine.gy)]).toEqual([15, 10]);
    const port = buildSettlementLayout(
      settlement({ x: 1, y: 5, buildings: { port: 1 } }),
      "seed",
      OPEN_TERRAIN,
    ).buildings.find((b) => b.kind === "port");
    expect(port).toBeDefined();
  });

  it("le rovine sostituiscono gli edifici degli insediamenti abbandonati", () => {
    const layout = buildSettlementLayout(
      settlement({ status: "abandoned", tier: "town" }),
      "seed",
      OPEN_TERRAIN,
    );
    expect(layout.buildings.length).toBeGreaterThan(0);
    expect(layout.buildings.every((b) => b.kind === "ruin")).toBe(true);
  });
});
