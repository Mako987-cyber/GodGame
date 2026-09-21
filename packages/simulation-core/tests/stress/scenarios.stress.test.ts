import { describe, expect, it } from "vitest";
import {
  SCENARIO_NAMES,
  buildScenario,
  checkDeterminism,
  checkRuns,
  createWorld,
  runAndMeasure,
  type RunMetrics,
} from "../../src/index";

/**
 * The balance checks the milestone listed, run on enough seeds to mean something but few
 * enough to stay in the stress suite's budget. The full harness is `npm run simulation:stress`.
 */
describe("stress: scenari e controlli di bilanciamento", () => {
  it("baseline su 8 semi e tre dimensioni: nessuna garanzia violata, nessun odore di bilanciamento", () => {
    const runs: RunMetrics[] = [];
    for (const size of [32, 48, 64]) {
      for (let i = 0; i < 8; i++) {
        runs.push(runAndMeasure(createWorld({ seed: `stress-ci-${i}`, width: size, height: size }), 150));
      }
    }
    const determinism = checkDeterminism(
      () => createWorld({ seed: "stress-ci-det", width: 40, height: 40 }),
      120,
    );
    const results = checkRuns(runs, determinism);
    for (const check of results) expect(check.passed, `${check.label}: ${check.detail}`).toBe(true);
  }, 600_000);

  it("ogni scenario gira senza violare invarianti", () => {
    for (const name of SCENARIO_NAMES) {
      const metrics = runAndMeasure(buildScenario(name, `stress-scenario-${name}`, 40), 120);
      expect(metrics.invariantProblems, name).toBe(0);
      expect(Number.isFinite(metrics.population), name).toBe(true);
    }
  }, 600_000);

  it("la geografia conta: il deserto resta indietro rispetto alla valle fertile", () => {
    const avg = (name: "desert" | "fertile-valley", pick: (m: RunMetrics) => number) => {
      let total = 0;
      for (let i = 0; i < 3; i++) total += pick(runAndMeasure(buildScenario(name, `geo-${i}`, 48), 150));
      return total / 3;
    };
    expect(avg("desert", (m) => m.population)).toBeLessThan(avg("fertile-valley", (m) => m.population));
    expect(avg("desert", (m) => m.techMax)).toBeLessThanOrEqual(avg("fertile-valley", (m) => m.techMax));
  }, 600_000);

  it("l'isolamento riduce la diffusione rispetto a un mondo di popoli vicini e aperti", () => {
    const diffusion = (name: "isolated" | "tech-diffusion") => {
      let total = 0;
      for (let i = 0; i < 3; i++) total += runAndMeasure(buildScenario(name, `diff-${i}`), 150).diffusions;
      return total;
    };
    expect(diffusion("isolated")).toBeLessThan(diffusion("tech-diffusion"));
  }, 600_000);
});
