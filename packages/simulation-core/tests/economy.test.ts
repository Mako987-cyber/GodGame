import { describe, expect, it } from "vitest";
import { consume, produce } from "../src/economy";
import { runSimulation, techEffects } from "../src/index";
import { bandOf, contextWithCommunities, makeBarren, world } from "./helpers";

describe("economia", () => {
  it("la produzione dipende dai lavoratori e consuma le risorse naturali", () => {
    const state = world("economia");
    const ctx = contextWithCommunities(state);
    const tribe = state.tribes[0]!;
    const band = bandOf(ctx, tribe.id);
    for (const p of band.members) p.action = p.age >= 16 ? "gather" : "rest";
    const faunaBefore = band.area.reduce((a, c) => a + c.fauna, 0);
    const result = produce(ctx, band, techEffects([]));
    expect(result.food).toBeGreaterThan(0);
    expect(band.area.reduce((a, c) => a + c.fauna, 0)).toBeLessThan(faunaBefore);

    const idle = contextWithCommunities(world("economia"));
    const idleBand = bandOf(idle, idle.state.tribes[0]!.id);
    for (const p of idleBand.members) p.action = "rest";
    expect(produce(idle, idleBand, techEffects([])).food).toBe(0);
  });

  it("il consumo dipende dalla popolazione e aggiorna fame e scorte", () => {
    const state = world("consumo");
    const ctx = contextWithCommunities(state);
    const band = bandOf(ctx, state.tribes[0]!.id);
    band.stock.food = 1000;
    const plenty = consume(ctx, band, techEffects([]));
    expect(plenty.ratio).toBe(1);
    expect(plenty.eaten).toBeCloseTo(plenty.needed, 5);
    expect(band.members.every((p) => p.hunger === 0)).toBe(true);

    band.stock.food = plenty.needed * 0.3;
    const scarce = consume(ctx, band, techEffects([]));
    expect(scarce.ratio).toBeLessThan(0.35);
    expect(band.stock.food).toBe(0);
    expect(band.members.some((p) => p.hunger > 0)).toBe(true);
  });

  it("in condizioni estreme le persone muoiono di fame", () => {
    const state = world("carestia");
    const tribe = state.tribes[0]!;
    makeBarren(state, tribe.x, tribe.y, 12);
    tribe.stock.food = 0;
    const initial = state.people.filter((p) => p.tribeId === tribe.id).length;
    const result = runSimulation(state, 15);
    const starvation = state.archive.people.filter(
      (p) => p.tribeId === tribe.id && p.deathCause === "starvation",
    );
    expect(result.stats.reduce((a, s) => a + s.starvationDeaths, 0)).toBeGreaterThan(0);
    expect(starvation.length).toBeGreaterThan(0);
    const alive = state.people.filter((p) => p.tribeId === tribe.id).length;
    expect(alive).toBeLessThan(initial);
  });
});
