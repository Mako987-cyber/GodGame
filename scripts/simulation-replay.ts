/**
 * Replays history from a snapshot and checks it comes out identical.
 *
 *   npm run simulation:replay -- [--scenario baseline] [--seed test-003] [--snapshot 100] [--ticks 100]
 *
 * Headless: it takes its own snapshot mid-run, exactly as `world_snapshots` stores one, and
 * re-runs the rest from it. Exits with status 1 if the replay diverges.
 */
import { buildScenario, verifyReplay } from "../packages/simulation-core/src/index";
import { arg, numberArg, scenarioArg } from "./scenario-cli";

const scenario = scenarioArg();
const seed = arg("seed", "test-003")!;
const snapshotAt = numberArg("snapshot", 100);
const ticks = numberArg("ticks", 100);
const size = arg("size") ? numberArg("size", 64) : undefined;

console.log(`Replay di «${scenario}», seme ${seed}: snapshot al tick ${snapshotAt}, poi ${ticks} tick.`);
const result = verifyReplay(() => buildScenario(scenario, seed, size), snapshotAt, ticks);
console.log(`  eventi originali ${result.originalEvents}, rigiocati ${result.replayedEvents}`);
console.log(`  hash originale ${result.originalHash}, rigiocato ${result.replayedHash}`);
if (result.identical) {
  console.log("La storia rigiocata coincide con l'originale.");
} else {
  console.error("Il replay diverge dall'originale.");
  if (result.divergence) {
    console.error(
      `  primo scostamento all'evento ${result.divergence.index} (tick ${result.divergence.tick})`,
    );
    console.error(`    originale: ${result.divergence.original}`);
    console.error(`    rigiocato: ${result.divergence.replayed}`);
  }
  process.exit(1);
}
