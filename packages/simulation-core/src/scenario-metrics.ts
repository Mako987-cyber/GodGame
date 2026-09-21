import { CULTURE_TRAITS } from "./culture";
import { checkInvariants } from "./invariants";
import { hashWorld } from "./serialization";
import { runSimulation } from "./simulation-engine";
import type { HistoricalEvent, WorldState } from "./types";

/**
 * What a scenario run produced, and the checks the milestone asked to watch for.
 *
 * Pure measurement over a finished run: no randomness, no side effects. Used by the scenario
 * scripts (`simulation:run`, `simulation:stress`, `simulation:compare`) and by the tests.
 */

export interface RunMetrics {
  seed: string;
  ticks: number;
  population: number;
  peoplesAlive: number;
  peoplesEver: number;
  settlements: number;
  civilizations: number;
  /** Technologies held by the most and least advanced peoples alive. */
  techMax: number;
  techMin: number;
  /** Distinct technology sets and discovery orders among the living. */
  distinctTechSets: number;
  distinctTechOrders: number;
  /** Year of the first independent discovery, and of the last adoption event. */
  firstDiscoveryYear: number | null;
  lastAdoptionYear: number | null;
  inventions: number;
  diffusions: number;
  techLost: number;
  rediscoveries: number;
  dynasties: number;
  wars: number;
  battles: number;
  vassalages: number;
  occupations: number;
  fusions: number;
  famines: number;
  collapses: number;
  beliefs: number;
  agreements: number;
  /** Mean standard deviation of the culture traits among the living, 0..~30. */
  cultureSpread: number;
  /** Share of the living population held by the largest people, 0..1. */
  largestShare: number;
  invariantProblems: number;
  msPerTick: number;
  stateHash: string;
}

const count = (events: HistoricalEvent[], pick: (e: HistoricalEvent) => boolean) =>
  events.filter(pick).length;

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

export function measureRun(
  state: WorldState,
  events: HistoricalEvent[],
  ticks: number,
  ms: number,
): RunMetrics {
  const alive = state.tribes.filter((t) => t.status !== "extinct");
  const population = state.people.filter((p) => p.alive).length;
  const byTribe = new Map<string, number>();
  for (const p of state.people) if (p.alive) byTribe.set(p.tribeId, (byTribe.get(p.tribeId) ?? 0) + 1);
  const techCounts = alive.map((t) => t.techs.length);
  const discoveries = events.filter((e) => e.type === "tech_discovered");
  const inventions = discoveries.filter((e) => e.subtype === "invention");
  const adoptions = discoveries.filter((e) => e.subtype === "adopted");
  return {
    seed: state.seed,
    ticks,
    population,
    peoplesAlive: alive.length,
    peoplesEver: state.tribes.length,
    settlements: state.settlements.filter((s) => s.status === "active").length,
    civilizations: state.civilizations.filter((c) => c.status === "active").length,
    techMax: techCounts.length ? Math.max(...techCounts) : 0,
    techMin: techCounts.length ? Math.min(...techCounts) : 0,
    distinctTechSets: new Set(alive.map((t) => [...t.techs].sort().join(","))).size,
    distinctTechOrders: new Set(alive.map((t) => t.techs.join(">"))).size,
    firstDiscoveryYear: inventions[0]?.year ?? null,
    lastAdoptionYear: adoptions.at(-1)?.year ?? null,
    inventions: inventions.length,
    diffusions: count(discoveries, (e) => e.subtype === "diffusion"),
    techLost: count(discoveries, (e) => e.subtype === "lost"),
    rediscoveries: count(discoveries, (e) => e.subtype === "rediscovery"),
    dynasties: state.dynasties.length,
    wars: count(events, (e) => e.subtype === "war_declared"),
    battles: count(events, (e) => e.type === "battle"),
    vassalages: state.vassalages.length,
    occupations: state.occupations.length,
    fusions: state.composites.length,
    famines: count(events, (e) => e.type === "famine"),
    collapses: count(events, (e) => e.type === "settlement_collapse"),
    beliefs: state.beliefs.length,
    agreements: state.agreements.length,
    cultureSpread:
      Math.round(
        (CULTURE_TRAITS.reduce((acc, trait) => acc + stdev(alive.map((t) => t.culture[trait])), 0) /
          CULTURE_TRAITS.length) *
          10,
      ) / 10,
    largestShare:
      population === 0 ? 0 : Math.round((Math.max(0, ...byTribe.values()) / population) * 1000) / 1000,
    invariantProblems: checkInvariants(state).length,
    msPerTick: Math.round((ms / Math.max(1, ticks)) * 100) / 100,
    stateHash: hashWorld(state),
  };
}

/** Runs a world for `ticks` and measures it. `now` is injectable so timing stays out of tests. */
export function runAndMeasure(state: WorldState, ticks: number, now: () => number = Date.now): RunMetrics {
  const started = now();
  const result = runSimulation(state, ticks);
  return measureRun(state, result.events, ticks, now() - started);
}

export type CheckSeverity = "error" | "warning";

export interface CheckResult {
  id: string;
  /** What the milestone asked to watch for, in its own words. */
  label: string;
  passed: boolean;
  severity: CheckSeverity;
  detail: string;
}

/**
 * The checks the milestone listed, over a set of runs of the same scenario. Errors are broken
 * guarantees (invariants, determinism); warnings are balance smells worth a human look.
 */
export function checkRuns(
  runs: RunMetrics[],
  determinism: { stable: boolean; detail: string },
): CheckResult[] {
  const living = runs.filter((r) => r.peoplesAlive >= 2);
  const share = (pick: (r: RunMetrics) => boolean) =>
    living.length === 0 ? 0 : living.filter(pick).length / living.length;
  const sum = (pick: (r: RunMetrics) => number) => runs.reduce((acc, r) => acc + pick(r), 0);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const results: CheckResult[] = [];
  const add = (id: string, label: string, passed: boolean, severity: CheckSeverity, detail: string) =>
    results.push({ id, label, passed, severity, detail });

  const broken = runs.filter((r) => r.invariantProblems > 0);
  add(
    "invariants",
    "nessun NaN, riferimento orfano, leader o fusione duplicati",
    broken.length === 0,
    "error",
    broken.length === 0
      ? `${runs.length} run puliti`
      : `${broken.length} run con problemi (semi ${broken.map((r) => r.seed).join(", ")})`,
  );
  add(
    "determinism",
    "stesso seme e stesso stato producono lo stesso risultato",
    determinism.stable,
    "error",
    determinism.detail,
  );

  const sameOrder = share((r) => r.distinctTechOrders <= 1);
  add(
    "same-order",
    "non tutte le civiltà scoprono tutto nello stesso ordine",
    sameOrder < 0.5,
    "warning",
    `${pct(sameOrder)} dei run con almeno due popoli ha un solo ordine di scoperta`,
  );
  const noInventions = runs.filter((r) => r.inventions === 0).length;
  add(
    "no-discovery",
    "qualcuno scopre davvero qualcosa",
    noInventions === 0,
    "warning",
    `${sum((r) => r.inventions)} invenzioni, ${noInventions} run senza alcuna`,
  );
  const diffusion = sum((r) => r.diffusions);
  const invention = sum((r) => r.inventions);
  add(
    "instant-diffusion",
    "la diffusione non è istantanea né dominante",
    diffusion <= invention * 3,
    "warning",
    `${diffusion} acquisizioni per diffusione contro ${invention} scoperte autonome`,
  );
  const lostRate = invention + diffusion === 0 ? 0 : sum((r) => r.techLost) / (invention + diffusion);
  add(
    "loss-frequency",
    "la perdita tecnologica non è troppo frequente",
    lostRate <= 0.5,
    "warning",
    `${sum((r) => r.techLost)} perdite su ${invention + diffusion} acquisizioni (${pct(lostRate)})`,
  );
  const runaway = share((r) => r.largestShare >= 0.85);
  add(
    "runaway",
    "nessun popolo diventa irrecuperabile",
    runaway <= 0.25,
    "warning",
    `${pct(runaway)} dei run con un popolo sopra l'85% della popolazione`,
  );
  const flat = share((r) => r.cultureSpread < 3);
  add(
    "culture-convergence",
    "le culture non convergono tutte sugli stessi valori",
    flat <= 0.25,
    "warning",
    `${pct(flat)} dei run con dispersione culturale media sotto 3 punti`,
  );
  return results;
}

/** Runs the same seed twice, the second time in uneven batches, and compares the final state. */
export function checkDeterminism(
  build: () => WorldState,
  ticks: number,
): { stable: boolean; detail: string } {
  const a = build();
  runSimulation(a, ticks);
  const b = build();
  let done = 0;
  const batches = [1, 7, 13, 29];
  for (let i = 0; done < ticks; i++) {
    const step = Math.min(batches[i % batches.length]!, ticks - done);
    runSimulation(b, step);
    done += step;
  }
  const ha = hashWorld(a);
  const hb = hashWorld(b);
  return {
    stable: ha === hb,
    detail:
      ha === hb ? `hash ${ha} identico in un colpo e a lotti irregolari` : `hash diversi: ${ha} contro ${hb}`,
  };
}
