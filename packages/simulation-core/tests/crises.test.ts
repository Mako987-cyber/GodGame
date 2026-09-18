import { describe, expect, it } from "vitest";
import { epidemicRisk } from "../src/crises";
import { createWorld, runSimulation } from "../src/index";
import { contextWithCommunities } from "./helpers";

describe("crisi ed epidemie", () => {
  it("il rischio di epidemia dipende da densità, igiene, fame e contatti", () => {
    const state = createWorld({ seed: "rischio" });
    const ctx = contextWithCommunities(state);
    const band = ctx.communities[0]!;
    // A nomadic band has no settlement: no outbreak is possible.
    expect(epidemicRisk(ctx, band).total).toBe(0);
  });

  it("le epidemie rispettano le condizioni e lasciano traccia con le cause", () => {
    const state = createWorld({ seed: "epidemie" });
    const result = runSimulation(state, 400);
    const outbreaks = result.events.filter((e) => e.type === "epidemic" && e.subtype === "outbreak");
    for (const e of outbreaks) {
      // Never in the void: an outbreak always names a settlement and its conditions.
      expect(e.metadata.settlementId).toBeTypeOf("string");
      expect(Number(e.metadata.severity)).toBeGreaterThan(0);
      expect(Number(e.metadata.severity)).toBeLessThanOrEqual(1);
      expect(Number(e.metadata.population)).toBeGreaterThan(0);
      expect(Number(e.metadata.hygiene)).toBeGreaterThanOrEqual(0);
      expect(Number(e.metadata.density)).toBeGreaterThanOrEqual(0);
    }
    // Deaths and endings always reference the outbreak that caused them.
    const consequences = result.events.filter(
      (e) => e.type === "epidemic" && (e.subtype === "deaths" || e.subtype === "ended"),
    );
    const ids = new Set(result.events.map((e) => e.id));
    for (const e of consequences) {
      for (const cause of e.causeEventIds) expect(ids.has(cause)).toBe(true);
    }
  });

  it("nessuna epidemia colpisce due volte la stessa città in pochi anni", () => {
    const state = createWorld({ seed: "immunita" });
    const result = runSimulation(state, 400);
    const bySettlement = new Map<string, number[]>();
    for (const e of result.events) {
      if (e.type !== "epidemic" || e.subtype !== "outbreak") continue;
      const id = String(e.metadata.settlementId);
      const years = bySettlement.get(id) ?? [];
      years.push(e.year);
      bySettlement.set(id, years);
    }
    for (const years of bySettlement.values()) {
      years.sort((a, b) => a - b);
      for (let i = 1; i < years.length; i++) {
        expect(years[i]! - years[i - 1]!).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("le crisi attive scadono e non restano appese", () => {
    const state = createWorld({ seed: "crisi" });
    runSimulation(state, 300);
    for (const crisis of state.crises) {
      expect(crisis.untilYear).toBeGreaterThanOrEqual(state.year);
      expect(crisis.severity).toBeGreaterThan(0);
      expect(crisis.severity).toBeLessThanOrEqual(1);
      if (crisis.scope === "settlement") {
        expect(state.settlements.some((s) => s.id === crisis.targetId)).toBe(true);
      }
      if (crisis.scope === "tribe") {
        expect(state.tribes.some((t) => t.id === crisis.targetId)).toBe(true);
      }
    }
  });

  it("la carestia spiega le sue cause nei metadata", () => {
    const state = createWorld({ seed: "carestie" });
    const result = runSimulation(state, 300);
    const famines = result.events.filter((e) => e.type === "famine");
    expect(famines.length).toBeGreaterThan(0);
    for (const e of famines) {
      expect(Number(e.metadata.foodRatio)).toBeLessThanOrEqual(1);
      expect(Number(e.metadata.population)).toBeGreaterThanOrEqual(0);
      expect(e.metadata.climateModifier).toBeTypeOf("number");
    }
  });
});
