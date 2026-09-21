/**
 * Runs one scenario and prints what came out of it.
 *
 *   npm run simulation:run -- --scenario fertile-valley --seed test-001 --ticks 200 [--size 64] [--profile]
 */
import {
  SCENARIOS,
  buildScenario,
  measureRun,
  runAndMeasure,
  runSimulation,
  type RunMetrics,
  type WorldState,
} from "../packages/simulation-core/src/index";
import { arg, numberArg, printTable, scenarioArg } from "./scenario-cli";

const scenario = scenarioArg();
const seed = arg("seed", "test-001")!;
const ticks = numberArg("ticks", 200);
const size = arg("size") ? numberArg("size", 64) : undefined;

const state = buildScenario(scenario, seed, size);
console.log(`Scenario «${scenario}» — ${SCENARIOS[scenario].purpose}`);
console.log(`Seme ${seed}, ${state.width}×${state.height}, ${state.tribes.length} popoli, ${ticks} tick\n`);
const profile = process.argv.includes("--profile");
const phases: Record<string, number> = {};
const metrics = profile ? measureProfiled(state, ticks, phases) : runAndMeasure(state, ticks);
printTable([{ title: scenario, metrics }]);
if (profile) {
  const total = Object.values(phases).reduce((a, b) => a + b, 0);
  console.log(`\nTempo per fase (ms per tick, su ${ticks} tick):`);
  for (const [name, ms] of Object.entries(phases).sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${name.padEnd(24)} ${(ms / ticks).toFixed(3).padStart(8)}  ${((ms / total) * 100).toFixed(1).padStart(5)}%`,
    );
  }
}
if (metrics.invariantProblems > 0) {
  console.error(`\n${metrics.invariantProblems} problemi di invarianti: il run non è valido.`);
  process.exit(1);
}

function measureProfiled(world: WorldState, n: number, into: Record<string, number>): RunMetrics {
  const started = Date.now();
  const result = runSimulation(world, n, { profile: into });
  return measureRun(world, result.events, n, Date.now() - started);
}
