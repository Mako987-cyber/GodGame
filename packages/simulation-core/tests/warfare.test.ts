import { describe, expect, it } from "vitest";
import { resolveBattle, Rng, type CombatSide } from "../src/index";

const side = (warriors: number, overrides: Partial<CombatSide> = {}): CombatSide => ({
  warriors,
  health: 1,
  morale: 1,
  technology: 1,
  defense: 1,
  terrain: 1,
  logistics: 1,
  leadership: 1,
  ...overrides,
});

describe("conflitti", () => {
  it("con seed noto il risultato è deterministico", () => {
    const a = resolveBattle(side(30), side(25), Rng.fromSeed("battaglia"));
    const b = resolveBattle(side(30), side(25), Rng.fromSeed("battaglia"));
    expect(a).toEqual(b);
    expect(a).toMatchInlineSnapshot(`
      {
        "attackerLossRate": 0.077,
        "attackerPower": 30,
        "attackerWins": true,
        "defenderLossRate": 0.22,
        "defenderPower": 25,
        "margin": 1.71,
      }
    `);
  });

  it("forza, tecnologia e difese contano", () => {
    const rng = Rng.fromSeed("statistica");
    let strongWins = 0;
    let fortifiedHolds = 0;
    for (let i = 0; i < 200; i++) {
      if (resolveBattle(side(40, { technology: 1.3 }), side(20), rng).attackerWins) strongWins++;
      if (!resolveBattle(side(30), side(25, { defense: 1.5, terrain: 1.15 }), rng).attackerWins)
        fortifiedHolds++;
    }
    expect(strongWins).toBeGreaterThan(190);
    expect(fortifiedHolds).toBeGreaterThan(150);
  });

  it("le perdite del perdente superano quelle del vincitore", () => {
    const outcome = resolveBattle(side(50), side(10), Rng.fromSeed("x"));
    expect(outcome.attackerWins).toBe(true);
    expect(outcome.defenderLossRate).toBeGreaterThan(outcome.attackerLossRate);
  });
});
