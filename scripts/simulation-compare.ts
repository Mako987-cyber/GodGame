/**
 * Runs a scenario and the unmodified baseline on the same seed, side by side.
 *
 *   npm run simulation:compare -- --scenario trade-corridor --seed test-002 [--ticks 200] [--size 64]
 */
import { buildScenario, runAndMeasure, SCENARIOS } from "../packages/simulation-core/src/index";
import { arg, numberArg, printTable, scenarioArg } from "./scenario-cli";

const scenario = scenarioArg("trade-corridor");
const seed = arg("seed", "test-002")!;
const ticks = numberArg("ticks", 200);
const size = arg("size") ? numberArg("size", 64) : undefined;

console.log(`«${scenario}» contro «baseline», seme ${seed}, ${ticks} tick`);
console.log(`${SCENARIOS[scenario].purpose}\n`);
const baseline = runAndMeasure(buildScenario("baseline", seed, size), ticks);
const variant = runAndMeasure(buildScenario(scenario, seed, size), ticks);
printTable([
  { title: "baseline", metrics: baseline },
  { title: scenario, metrics: variant },
]);
