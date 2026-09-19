import { describe, expect, it } from "vitest";
import { clampCameraToRect, createFittedCamera, pan, zoomAt } from "@/lib/map-renderer/camera";
import {
  computeHexBorders,
  hexBoundaryEdges,
  hexSharedEdges,
  insetPolyline,
} from "@/lib/map-renderer/hex/borders";
import {
  AXIAL_DIRECTIONS,
  HexGrid,
  axialNeighbors,
  axialRound,
  axialToCube,
  axialToOffset,
  axialToWorld,
  hexCorners,
  hexDistance,
  offsetToAxial,
  worldToAxial,
  type OffsetLayout,
} from "@/lib/map-renderer/hex/geometry";
import { hexChunkGrid, HEX_CHUNK_SIZE } from "@/lib/map-renderer/hex/hex-terrain";
import { frameToWorld, buildHexSettlementLayout } from "@/lib/map-renderer/hex/hex-settlements";
import { screenToWorld, worldToScreen } from "@/lib/map-renderer/projection";
import { grid as cellGrid, settlement } from "./fixtures";

const LAYOUTS: OffsetLayout[] = ["odd-r", "even-r", "odd-q", "even-q"];

describe("coordinate esagonali: offset ↔ assiali", () => {
  it("andata e ritorno sono l'identità per tutti i layout, anche con indici negativi", () => {
    for (const layout of LAYOUTS) {
      for (let row = -5; row <= 5; row++) {
        for (let col = -5; col <= 5; col++) {
          expect(axialToOffset(offsetToAxial(col, row, layout), layout)).toEqual({ col, row });
        }
      }
    }
  });

  it("odd-r: le righe dispari sono spostate a destra di mezza cella", () => {
    expect(offsetToAxial(0, 0, "odd-r")).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial(0, 1, "odd-r")).toEqual({ q: 0, r: 1 });
    expect(offsetToAxial(0, 2, "odd-r")).toEqual({ q: -1, r: 2 });
    expect(offsetToAxial(3, 3, "odd-r")).toEqual({ q: 2, r: 3 });
  });

  it("le coordinate cubiche sommano a zero", () => {
    for (const layout of LAYOUTS) {
      const c = axialToCube(offsetToAxial(4, 7, layout));
      expect(c.x + c.y + c.z).toBe(0);
    }
  });
});

describe("coordinate esagonali: mondo ↔ assiali", () => {
  for (const orientation of ["pointy", "flat"] as const) {
    it(`il centro di ogni esagono torna all'esagono stesso (${orientation})`, () => {
      for (let r = -4; r <= 4; r++) {
        for (let q = -4; q <= 4; q++) {
          const w = axialToWorld({ q, r }, 30, orientation);
          expect(worldToAxial(w.x, w.y, 30, orientation)).toEqual({ q, r });
        }
      }
    });

    it(`i punti vicini ai vertici restano nell'esagono giusto (${orientation})`, () => {
      const size = 30;
      const c = axialToWorld({ q: 2, r: -1 }, size, orientation);
      const corners = hexCorners(c, size);
      for (const k of corners) {
        // 90% of the way to a corner: still inside.
        const p = { x: c.x + (k.x - c.x) * 0.9, y: c.y + (k.y - c.y) * 0.9 };
        if (orientation === "pointy")
          expect(worldToAxial(p.x, p.y, size, orientation)).toEqual({ q: 2, r: -1 });
      }
    });
  }

  it("arrotondamento cubico: risultati interi e distanza minima", () => {
    expect(axialRound(0.3, 0.2)).toEqual({ q: 0, r: 0 });
    // (0.4, 0.4) is closer to the neighbour (0, 1) than to the origin in cube distance.
    expect(axialRound(0.4, 0.4)).toEqual({ q: 0, r: 1 });
    expect(axialRound(0.6, 0.1)).toEqual({ q: 1, r: 0 });
    expect(axialRound(-0.1, -0.1)).toEqual({ q: 0, r: 0 });
  });
});

describe("distanza e vicini", () => {
  it("distanza hex: 0 da sé, 1 dai vicini, simmetrica", () => {
    const o = { q: 3, r: -2 };
    expect(hexDistance(o, o)).toBe(0);
    for (const n of axialNeighbors(o)) expect(hexDistance(o, n)).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: 3, r: -1 }, { q: 0, r: 0 })).toBe(3);
    expect(hexDistance({ q: -2, r: 4 }, { q: 1, r: 0 })).toBe(4);
  });

  it("sei direzioni distinte, ognuna con il suo opposto", () => {
    expect(new Set(AXIAL_DIRECTIONS.map((d) => `${d.q},${d.r}`)).size).toBe(6);
    AXIAL_DIRECTIONS.forEach((d, i) => {
      const opposite = AXIAL_DIRECTIONS[(i + 3) % 6]!;
      expect(d.q + opposite.q).toBe(0);
      expect(d.r + opposite.r).toBe(0);
    });
  });

  it("HexGrid: i vicini in bordo mappa sono filtrati, ogni vicino è a distanza 1", () => {
    const g = new HexGrid(10, 8);
    expect(g.neighbors(0, 0).length).toBeLessThan(6);
    expect(g.neighbors(5, 4)).toHaveLength(6);
    for (const n of g.neighbors(5, 4)) expect(g.distance({ x: 5, y: 4 }, n)).toBe(1);
    // Neighbour d and the edge d face each other: the edge midpoint is halfway between the centres.
    for (let d = 0; d < 6; d++) {
      const n = g.neighbor(5, 4, d);
      const [a, b] = g.edge(5, 4, d);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const c0 = g.center(5, 4);
      const c1 = g.center(n.x, n.y);
      expect(mid.x).toBeCloseTo((c0.x + c1.x) / 2, 6);
      expect(mid.y).toBeCloseTo((c0.y + c1.y) / 2, 6);
    }
  });

  it("range: 1 + 3r(r+1) celle lontano dai bordi", () => {
    const g = new HexGrid(20, 20);
    expect(g.range(10, 10, 0)).toHaveLength(1);
    expect(g.range(10, 10, 1)).toHaveLength(7);
    expect(g.range(10, 10, 2)).toHaveLength(19);
    for (const p of g.range(10, 10, 2)) expect(g.distance({ x: 10, y: 10 }, p)).toBeLessThanOrEqual(2);
  });
});

describe("hit testing esagonale", () => {
  const g = new HexGrid(12, 9);

  it("il centro di ogni cella seleziona la cella stessa", () => {
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        const c = g.center(x, y);
        expect(g.cellAt(c.x, c.y)).toEqual({ x, y });
        expect(g.contains(c.x, c.y, x, y)).toBe(true);
      }
  });

  it("vicino ai bordi di un esagono sceglie la cella che contiene davvero il punto", () => {
    for (const [x, y] of [
      [3, 3],
      [4, 4],
      [0, 1],
    ] as const) {
      const c = g.center(x, y);
      for (const k of g.corners) {
        const p = { x: c.x + k.x * 0.92, y: c.y + k.y * 0.92 };
        expect(g.cellAt(p.x, p.y)).toEqual({ x, y });
      }
      // Just outside an edge: a different cell that contains the point.
      const [a, b] = g.edge(x, y, 0);
      const out = { x: (a.x + b.x) / 2 + 2, y: (a.y + b.y) / 2 };
      const picked = g.cellAt(out.x, out.y);
      if (picked) expect(g.contains(out.x, out.y, picked.x, picked.y)).toBe(true);
      expect(picked).not.toEqual({ x, y });
    }
  });

  it("fuori dalla mappa restituisce null", () => {
    const b = g.bounds();
    expect(g.cellAt(-40, -40)).toBeNull();
    expect(g.cellAt(b.width + 50, b.height + 50)).toBeNull();
  });

  it("i limiti del mondo contengono tutti gli esagoni", () => {
    const b = g.bounds();
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++)
        for (const p of g.cellCorners(x, y)) {
          expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(b.y - 1e-6);
          expect(p.x).toBeLessThanOrEqual(b.x + b.width + 1e-6);
          expect(p.y).toBeLessThanOrEqual(b.y + b.height + 1e-6);
        }
  });
});

describe("confini esagonali", () => {
  const g = new HexGrid(8, 8);

  it("una regione di una sola cella ha 6 lati di confine, fusi in un anello chiuso", () => {
    const owner = new Array(64).fill(-1);
    owner[g.index(3, 3)] = 0;
    expect(hexBoundaryEdges(g, owner)).toHaveLength(6);
    const runs = computeHexBorders(g, owner);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.closed).toBe(true);
    expect(runs[0]!.points).toHaveLength(6);
  });

  it("nessun lato interno: solo dove cambia il proprietario", () => {
    const owner = new Array(64).fill(0);
    // The whole map belongs to region 0: only the map edge is a border.
    const edges = hexBoundaryEdges(g, owner);
    for (const e of edges) expect(e.other).toBe(-1);
    // Two regions side by side share edges from both sides.
    const split = Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 0 : 1));
    const between = hexBoundaryEdges(g, split).filter((e) => e.other >= 0);
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((e) => e.region !== e.other)).toBe(true);
  });

  it("i lati adiacenti sono fusi in poche polilinee", () => {
    const owner = new Array(64).fill(-1);
    for (const p of g.range(4, 4, 2)) owner[g.index(p.x, p.y)] = 2;
    const edges = hexBoundaryEdges(g, owner);
    const runs = computeHexBorders(g, owner);
    expect(edges.length).toBe(30);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.points).toHaveLength(30);
  });

  it("confini contesi e fronti di guerra tra due proprietari", () => {
    const owner = Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 0 : 1));
    const runs = computeHexBorders(g, owner, (a, b) => a + b === 1);
    expect(runs.some((r) => r.contested)).toBe(true);
    expect(runs.filter((r) => r.contested).every((r) => r.other >= 0)).toBe(true);
    const front = hexSharedEdges(g, owner, 0, 1);
    expect(front.length).toBeGreaterThan(0);
    expect(front.every((r) => r.region === 0)).toBe(true);
  });

  it("insetPolyline sposta la linea verso l'interno della regione (a destra)", () => {
    const owner = new Array(64).fill(-1);
    owner[g.index(3, 3)] = 0;
    const [run] = computeHexBorders(g, owner);
    const c = g.center(3, 3);
    const inset = insetPolyline(run!.points, true, 3);
    for (let i = 0; i < inset.length; i++) {
      const before = Math.hypot(run!.points[i]!.x - c.x, run!.points[i]!.y - c.y);
      const after = Math.hypot(inset[i]!.x - c.x, inset[i]!.y - c.y);
      expect(after).toBeLessThan(before);
    }
  });
});

describe("camera sulla mappa esagonale", () => {
  const g = new HexGrid(48, 40);
  const viewport = { width: 1280, height: 800 };

  it("la vista iniziale contiene tutta la mappa", () => {
    const cam = createFittedCamera(g.bounds(), viewport);
    const b = g.bounds();
    const tl = worldToScreen(b.x, b.y, cam);
    const br = worldToScreen(b.x + b.width, b.y + b.height, cam);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(viewport.width);
    expect(br.y).toBeLessThanOrEqual(viewport.height);
  });

  it("zoom sul cursore: il punto sotto il cursore resta fermo", () => {
    const cam = createFittedCamera(g.bounds(), viewport);
    const before = screenToWorld(300, 200, cam);
    const after = screenToWorld(300, 200, zoomAt(cam, 2, 300, 200));
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("il pan non può portare il centro della vista fuori dalla mappa", () => {
    const cam = createFittedCamera(g.bounds(), viewport);
    const far = clampCameraToRect(pan(cam, 1e6, 1e6), viewport, g.bounds());
    const centre = screenToWorld(viewport.width / 2, viewport.height / 2, far);
    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(centre.y).toBeGreaterThanOrEqual(0);
    // Inside: unchanged.
    expect(clampCameraToRect(cam, viewport, g.bounds())).toBe(cam);
  });

  it("selezione dopo zoom e pan: il click sullo schermo trova la cella giusta", () => {
    let cam = createFittedCamera(g.bounds(), viewport);
    cam = pan(zoomAt(cam, 3, 640, 400), -120, 80);
    const target = g.center(20, 17);
    const s = worldToScreen(target.x, target.y, cam);
    const w = screenToWorld(s.x, s.y, cam);
    expect(g.cellAt(w.x, w.y)).toEqual({ x: 20, y: 17 });
  });
});

describe("chunk e insediamenti sulla mappa esagonale", () => {
  it("i chunk coprono tutte le celle una volta sola", () => {
    const g = new HexGrid(40, 35);
    const chunks = hexChunkGrid(g);
    let cells = 0;
    for (const c of chunks) cells += (c.x1 - c.x0) * (c.y1 - c.y0);
    expect(cells).toBe(40 * 35);
    expect(chunks).toHaveLength(Math.ceil(40 / HEX_CHUNK_SIZE) * Math.ceil(35 / HEX_CHUNK_SIZE));
  });

  it("il layout di un insediamento è centrato sul suo esagono e deterministico", () => {
    const g = new HexGrid(24, 24);
    const cells = cellGrid(24, 24);
    const s = settlement({
      x: 10,
      y: 11,
      tier: "town",
      population: 400,
      buildings: { hut: 6, temple: 1, market: 1 },
    });
    const a = buildHexSettlementLayout(s, "seed", g, cells);
    const b = buildHexSettlementLayout(s, "seed", g, cells);
    expect(a.layout.buildings).toEqual(b.layout.buildings);
    const origin = frameToWorld(a.frame, a.frame.cx, a.frame.cy);
    expect(origin).toEqual(g.center(10, 11));
    expect(a.cells).toContain(g.index(10, 11));
    // A town spills over into neighbouring hexes, but stays within two steps.
    for (const i of a.cells) {
      const p = { x: i % 24, y: Math.floor(i / 24) };
      expect(g.distance(p, { x: 10, y: 11 })).toBeLessThanOrEqual(2);
    }
  });

  it("gli edifici non finiscono sull'acqua", () => {
    const g = new HexGrid(24, 24);
    const cells = cellGrid(24, 24, (x) => (x >= 12 ? { biome: "ocean", elevation: 0 } : {}));
    const s = settlement({ x: 11, y: 10, tier: "city", population: 900 });
    const h = buildHexSettlementLayout(s, "seed", g, cells);
    for (const b of h.layout.buildings) {
      if (b.kind === "port") continue;
      const p = frameToWorld(h.frame, b.gx, b.gy);
      const c = g.cellAt(p.x, p.y);
      expect(c).not.toBeNull();
      // The layout tests the centre of the local cell a building stands in.
      const v = frameToWorld(h.frame, Math.floor(b.gx) + 0.5, Math.floor(b.gy) + 0.5);
      const under = g.cellAt(v.x, v.y)!;
      expect(cells[g.index(under.x, under.y)]?.biome).not.toBe("ocean");
    }
  });
});

describe("fiumi e strade sugli esagoni", () => {
  it("le strade formano un albero: nessun triangolo tra celle vicine", async () => {
    const { roadLinks, linkDirections } = await import("@/lib/map-renderer/hex/hex-links");
    const g = new HexGrid(10, 10);
    // A compact 7-cell blob of roads: every cell has several road neighbours.
    const blob = new Set(g.range(5, 5, 1).map((p) => g.index(p.x, p.y)));
    const cells = cellGrid(10, 10, (x, y) => ({ road: blob.has(g.index(x, y)) }));
    const mask = roadLinks(g, cells);
    let halfEdges = 0;
    for (const i of blob) halfEdges += linkDirections(mask[i] ?? 0).length;
    // A spanning tree over n nodes has n − 1 edges (each counted from both ends).
    expect(halfEdges / 2).toBe(blob.size - 1);
    // Symmetric: if a links to b, b links back.
    for (const i of blob) {
      const x = i % 10;
      const y = Math.floor(i / 10);
      for (const d of linkDirections(mask[i] ?? 0)) {
        const n = g.neighbor(x, y, d);
        expect((mask[g.index(n.x, n.y)] ?? 0) & (1 << ((d + 3) % 6))).not.toBe(0);
      }
    }
  });

  it("ogni cella di fiume scorre verso un solo vicino più basso o verso il mare", async () => {
    const { riverLinks } = await import("@/lib/map-renderer/hex/hex-links");
    const g = new HexGrid(10, 10);
    // A river descending towards the sea on column 9.
    const cells = cellGrid(10, 10, (x, y) =>
      x === 9
        ? { biome: "ocean", altitude: 0.2 }
        : y === 5 && x >= 3
          ? { river: true, altitude: 0.9 - x * 0.05 }
          : {},
    );
    const mask = riverLinks(g, cells);
    for (let x = 3; x < 9; x++) {
      const i = g.index(x, 5);
      expect(mask[i]).toBeGreaterThan(0);
    }
    // The source has exactly one link (downstream), a middle cell two (upstream + downstream).
    expect((mask[g.index(3, 5)] ?? 0).toString(2).replace(/0/g, "")).toHaveLength(1);
    expect((mask[g.index(5, 5)] ?? 0).toString(2).replace(/0/g, "")).toHaveLength(2);
  });
});
