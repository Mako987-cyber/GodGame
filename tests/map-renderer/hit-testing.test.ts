import { describe, expect, it } from "vitest";
import { pickCell, pickRegion, targetKey, type HitRegion } from "@/lib/map-renderer/hit-testing";
import { createProjection, gridToScreen } from "@/lib/map-renderer/projection";

const config = createProjection(10, 10);

describe("hit testing delle celle", () => {
  it("trova la cella sotto il punto su terreno piatto", () => {
    const flat = () => 0;
    for (const [x, y] of [
      [0, 0],
      [4, 7],
      [9, 9],
    ] as const) {
      const p = gridToScreen(x + 0.5, y + 0.5, 0, config);
      expect(pickCell(p, 10, 10, flat, config)).toEqual({ x, y });
    }
  });

  it("una cella rialzata davanti copre quella dietro", () => {
    // Cell (5,5) is raised by 6 levels: its top face covers the ground where (3,3)/(4,4) lie.
    const elev = (x: number, y: number) => (x === 5 && y === 5 ? 6 : 0);
    const top = gridToScreen(5.5, 5.5, 6, config);
    expect(pickCell(top, 10, 10, elev, config)).toEqual({ x: 5, y: 5 });
    // Without the elevation the same point belongs to a cell further back.
    expect(pickCell(top, 10, 10, () => 0, config)).not.toEqual({ x: 5, y: 5 });
  });

  it("restituisce null fuori dalla mappa", () => {
    const p = gridToScreen(-3, 5, 0, config);
    expect(pickCell(p, 10, 10, () => 0, config)).toBeNull();
  });
});

describe("priorità di selezione", () => {
  const region = (target: HitRegion["target"], depth = 0): HitRegion => ({
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    depth,
    target,
  });

  it("edificio > insediamento > conflitto > cella", () => {
    const regions = [
      region({ type: "conflict", id: "w" }),
      region({ type: "settlement", id: "s" }),
      region({ type: "building", settlementId: "s", label: "Casa" }),
    ];
    expect(pickRegion(regions, 10, 10)?.target.type).toBe("building");
    expect(pickRegion(regions.slice(0, 2), 10, 10)?.target.type).toBe("settlement");
    expect(pickRegion(regions.slice(0, 1), 10, 10)?.target.type).toBe("conflict");
  });

  it("a parità di priorità vince l'elemento davanti", () => {
    const regions = [
      region({ type: "settlement", id: "front" }, 20),
      region({ type: "settlement", id: "back" }, 5),
    ];
    expect(targetKey(pickRegion(regions, 10, 10)?.target)).toBe("settlement:front");
  });

  it("le icone circolari ignorano gli angoli del rettangolo", () => {
    const r: HitRegion = {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      circle: true,
      depth: 0,
      target: { type: "trade", id: "r" },
    };
    expect(pickRegion([r], 10, 10)).not.toBeNull();
    expect(pickRegion([r], 1, 1)).toBeNull();
  });
});
