import { describe, expect, it } from "vitest";
import { computeBorders, countRawBorderEdges, sharedEdges } from "@/lib/map-renderer/border-renderer";
import { cellResources, clusterResources } from "@/lib/map-renderer/resource-renderer";
import { grid } from "./fixtures";

function ownerGrid(w: number, h: number, owner: (x: number, y: number) => number) {
  const o: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.push(owner(x, y));
  return { width: w, height: h, owner: o, elevation: o.map(() => 1) };
}

describe("semplificazione dei confini", () => {
  it("un territorio quadrato diventa quattro tratti", () => {
    const g = ownerGrid(12, 12, (x, y) => (x >= 2 && x < 10 && y >= 2 && y < 10 ? 0 : -1));
    expect(countRawBorderEdges(g)).toBe(32);
    const borders = computeBorders(g);
    expect(borders.length).toBe(4);
    const lengths = borders.map(
      (b) => Math.abs(b.points[1]!.x - b.points[0]!.x) + Math.abs(b.points[1]!.y - b.points[0]!.y),
    );
    expect(lengths).toEqual([8, 8, 8, 8]);
  });

  it("due regioni confinanti: ogni lato è disegnato una volta per regione, verso l'interno", () => {
    const g = ownerGrid(10, 6, (x) => (x < 5 ? 0 : 1));
    const borders = computeBorders(g);
    const shared = borders.filter((b) => b.points[0]!.x === 5 && b.points[1]!.x === 5);
    expect(shared.map((b) => [b.region, b.side]).sort()).toEqual([
      [0, -1],
      [1, 1],
    ]);
    expect(borders.length).toBeLessThan(countRawBorderEdges(g));
  });

  it("segna come conteso il confine tra regioni in guerra", () => {
    const g = ownerGrid(10, 6, (x) => (x < 5 ? 0 : 1));
    const borders = computeBorders(g, (a, b) => a + b === 1);
    expect(borders.filter((b) => b.contested).length).toBe(2);
  });

  it("il fronte contiene solo i lati condivisi dai due contendenti", () => {
    const g = ownerGrid(10, 6, (x) => (x < 5 ? 0 : x < 8 ? 1 : 2));
    const front = sharedEdges(g, 0, 1);
    expect(front.length).toBe(1);
    expect(front[0]!.points.every((p) => p.x === 5)).toBe(true);
    expect(sharedEdges(g, 0, 2)).toEqual([]);
  });
});

describe("risorse", () => {
  it("segna solo le risorse notevoli", () => {
    const [plain, iron, game] = grid(3, 1, (x) =>
      x === 1 ? { iron: 40, biome: "hills" } : x === 2 ? { fauna: 28 } : {},
    );
    expect(cellResources(plain!)).toEqual([]);
    expect(cellResources(iron!)).toEqual(["iron"]);
    expect(cellResources(game!)).toEqual(["food"]);
  });

  it("il clustering riduce le icone e conserva i conteggi dei giacimenti rari", () => {
    const cells = grid(8, 8, (x, y) => ((x + y) % 3 === 0 ? { copper: 50, fauna: 28 } : {}));
    const perCell = clusterResources(cells, 8, 1);
    const clustered = clusterResources(cells, 8, 4);
    const copperCells = cells.filter((c) => c.copper > 0).length;
    expect(clustered.length).toBeLessThan(perCell.length);
    expect(clustered.filter((m) => m.kind === "copper").reduce((s, m) => s + m.count, 0)).toBe(copperCells);
    // Common resources are only shown cell by cell.
    expect(clustered.some((m) => m.kind === "food")).toBe(false);
    expect(perCell.some((m) => m.kind === "food")).toBe(true);
  });

  it("al massimo due icone per cella", () => {
    const cells = grid(1, 1, () => ({ iron: 1, copper: 1, tin: 1, coal: 1 }));
    expect(clusterResources(cells, 1, 1).length).toBe(2);
  });
});
