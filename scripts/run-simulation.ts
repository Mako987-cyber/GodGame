/**
 * Headless run of the simulation core (no DB): useful to tune parameters.
 * Usage: npm run sim:run -- <seed> <years> [reportEvery]
 */
import { EVENT_TYPE_LABELS, createWorld, runSimulation } from "../packages/simulation-core/src/index";

const seed = process.argv[2] ?? "genesis";
const years = Number(process.argv[3] ?? 500);
const every = Number(process.argv[4] ?? 50);

const state = createWorld({ seed });
console.log(`Seed "${seed}": ${state.tribes.length} tribù, ${state.people.length} persone`);
const started = Date.now();
const eventCounts = new Map<string, number>();
for (let done = 0; done < years; done += every) {
  const result = runSimulation(state, Math.min(every, years - done));
  for (const e of result.events) eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
  const last = result.stats.at(-1);
  if (!last) break;
  const births = result.stats.reduce((a, s) => a + s.births, 0);
  const deaths = result.stats.reduce((a, s) => a + s.deaths, 0);
  const starv = result.stats.reduce((a, s) => a + s.starvationDeaths, 0);
  const battles = result.stats.reduce((a, s) => a + s.battles, 0);
  console.log(
    `anno ${last.year} pop ${last.population} tribù ${last.tribes} ins ${last.settlements} civ ${last.civilizations} tech ${last.technologies} guerre ${last.wars} | nati ${births} morti ${deaths} (fame ${starv}) battaglie ${battles} | cibo prod ${last.foodProduced} stock ${last.foodStored}`,
  );
  for (const e of result.events.filter((e) => e.importance >= 4))
    console.log(`   [${EVENT_TYPE_LABELS[e.type]}] ${e.description}`);
}
console.log(`Durata: ${Date.now() - started} ms`);
console.log(Object.fromEntries(eventCounts));
