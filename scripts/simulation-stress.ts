/**
 * Stress and balance run: many seeds, several map sizes, every scenario, with the checks the
 * milestone asked for. Exits with status 1 if a guarantee (invariants, determinism) breaks;
 * balance warnings are printed but do not fail the run.
 *
 *   npm run simulation:stress -- [--seeds 20] [--ticks 200] [--scenario-seeds 3]
 */
import {
  SCENARIO_NAMES,
  buildScenario,
  checkDeterminism,
  checkRuns,
  createWorld,
  runAndMeasure,
  type RunMetrics,
} from "../packages/simulation-core/src/index";
import { numberArg } from "./scenario-cli";

const seeds = numberArg("seeds", 20);
const ticks = numberArg("ticks", 200);
const scenarioSeeds = numberArg("scenario-seeds", 3);
const sizes = [
  { label: "piccola", size: 32 },
  { label: "media", size: 48 },
  { label: "grande", size: 72 },
];

const started = Date.now();
let failed = false;

console.log(`Baseline: ${seeds} semi × ${sizes.length} dimensioni × ${ticks} tick`);
const baselineRuns: RunMetrics[] = [];
for (const { label, size } of sizes) {
  const runs: RunMetrics[] = [];
  for (let i = 0; i < seeds; i++) {
    const seed = `stress-${String(i + 1).padStart(3, "0")}`;
    runs.push(runAndMeasure(createWorld({ seed, width: size, height: size }), ticks));
  }
  baselineRuns.push(...runs);
  const peoples = runs.map((r) => r.peoplesEver);
  const ms = runs.map((r) => r.msPerTick);
  console.log(
    `  mappa ${label} (${size}×${size}): popoli ${Math.min(...peoples)}–${Math.max(...peoples)}, ` +
      `tech max ${Math.max(...runs.map((r) => r.techMax))}, ms/tick ${Math.min(...ms)}–${Math.max(...ms)}`,
  );
}
const determinism = checkDeterminism(
  () => createWorld({ seed: "stress-determinismo", width: 48, height: 48 }),
  ticks,
);
console.log("\nControlli sulla baseline:");
for (const check of checkRuns(baselineRuns, determinism)) {
  const mark = check.passed ? "ok " : check.severity === "error" ? "ERR" : "avv";
  console.log(`  [${mark}] ${check.label}: ${check.detail}`);
  if (!check.passed && check.severity === "error") failed = true;
}

console.log(`\nScenari: ${SCENARIO_NAMES.length} × ${scenarioSeeds} semi × ${ticks} tick`);
for (const scenario of SCENARIO_NAMES) {
  const runs: RunMetrics[] = [];
  for (let i = 0; i < scenarioSeeds; i++) {
    runs.push(runAndMeasure(buildScenario(scenario, `scenario-${scenario}-${i + 1}`), ticks));
  }
  const avg = (pick: (r: RunMetrics) => number) =>
    Math.round((runs.reduce((a, r) => a + pick(r), 0) / runs.length) * 10) / 10;
  const broken = runs.filter((r) => r.invariantProblems > 0).length;
  if (broken > 0) failed = true;
  console.log(
    `  ${scenario.padEnd(20)} pop ${String(avg((r) => r.population)).padStart(6)}  ` +
      `tech ${String(avg((r) => r.techMax)).padStart(4)}  set ${String(avg((r) => r.distinctTechSets)).padStart(4)}  ` +
      `diffusione ${String(avg((r) => r.diffusions)).padStart(5)}  guerre ${String(avg((r) => r.wars)).padStart(5)}  ` +
      `fusioni ${avg((r) => r.fusions)}  ${broken ? `INVARIANTI ROTTE in ${broken}` : ""}`,
  );
}

console.log(`\nDurata: ${Math.round((Date.now() - started) / 1000)} s`);
if (failed) {
  console.error("Una garanzia è stata violata (invarianti o determinismo).");
  process.exit(1);
}
