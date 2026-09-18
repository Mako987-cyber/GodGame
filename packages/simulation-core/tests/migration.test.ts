import { describe, expect, it } from "vitest";
import { cellAt, distance, runSimulation } from "../src/index";
import { makeBarren, world } from "./helpers";

describe("migrazione", () => {
  it("una tribù abbandona una zona inospitale verso celle migliori", () => {
    const state = world("migrazione");
    const tribe = state.tribes[0]!;
    const start = { x: tribe.x, y: tribe.y };
    makeBarren(state, start.x, start.y, 3);
    tribe.stock.food = 5;
    const result = runSimulation(state, 12);
    const moved = distance(start.x, start.y, tribe.x, tribe.y);
    expect(moved).toBeGreaterThan(0);
    expect(cellAt(state, tribe.x, tribe.y).habitability).toBeGreaterThan(0);
    expect(result.events.some((e) => e.type === "migration" && e.actors.some((a) => a.id === tribe.id))).toBe(
      true,
    );
    for (const p of state.people.filter((p) => p.tribeId === tribe.id && !p.settlementId)) {
      expect([p.x, p.y]).toEqual([tribe.x, tribe.y]);
    }
  });
});
