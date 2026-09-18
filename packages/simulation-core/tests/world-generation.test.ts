import { describe, expect, it } from "vitest";
import { BIOMES, createWorld, hashWorld, inBounds } from "../src/index";
import { distance } from "../src/grid";

describe("generazione del mondo", () => {
  it("è deterministica: stesso seed, stesso output", () => {
    const a = createWorld({ seed: "riproducibile" });
    const b = createWorld({ seed: "riproducibile" });
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.cells).toEqual(b.cells);
    expect(a.people).toEqual(b.people);
  });

  it("seed diversi producono mondi diversi", () => {
    expect(hashWorld(createWorld({ seed: "uno" }))).not.toBe(hashWorld(createWorld({ seed: "due" })));
  });

  it("genera una mappa completa 48x48 con biomi validi e relazioni sensate", () => {
    const state = createWorld({ seed: "mappa" });
    expect(state.cells).toHaveLength(48 * 48);
    const biomes = new Set(state.cells.map((c) => c.biome));
    for (const b of biomes) expect(BIOMES).toContain(b);
    expect(biomes.has("ocean")).toBe(true);
    for (const c of state.cells) {
      expect(inBounds(state, c.x, c.y)).toBe(true);
      if (c.biome === "ocean") expect(c.habitability).toBe(0);
      if (c.river) expect(c.water).toBe(1);
      expect(c.fertility).toBeGreaterThanOrEqual(0);
      expect(c.fertility).toBeLessThanOrEqual(1);
    }
    expect(state.cells.some((c) => c.river)).toBe(true);
    const avg = (list: typeof state.cells) =>
      list.reduce((a, c) => a + c.fertility, 0) / Math.max(1, list.length);
    const plains = state.cells.filter((c) => c.biome === "plains");
    const deserts = state.cells.filter((c) => c.biome === "desert");
    if (deserts.length > 0) expect(avg(plains)).toBeGreaterThan(avg(deserts));
  });

  it("supporta dimensioni configurabili", () => {
    const state = createWorld({ seed: "piccolo", width: 32, height: 32 });
    expect(state.cells).toHaveLength(32 * 32);
    for (const p of state.people) expect(inBounds(state, p.x, p.y)).toBe(true);
  });

  it("posiziona 3-6 tribù di 15-40 persone in celle abitabili e distanti", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const state = createWorld({ seed });
      expect(state.tribes.length).toBeGreaterThanOrEqual(3);
      expect(state.tribes.length).toBeLessThanOrEqual(6);
      for (const tribe of state.tribes) {
        const cell = state.cells[tribe.y * state.width + tribe.x];
        expect(cell?.biome).not.toBe("ocean");
        expect(cell?.habitability ?? 0).toBeGreaterThanOrEqual(0.45);
        const members = state.people.filter((p) => p.tribeId === tribe.id);
        expect(members.length).toBeGreaterThanOrEqual(15);
        expect(members.length).toBeLessThanOrEqual(40);
        expect(tribe.leaderId).not.toBeNull();
        for (const other of state.tribes) {
          if (other !== tribe) expect(distance(tribe.x, tribe.y, other.x, other.y)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
