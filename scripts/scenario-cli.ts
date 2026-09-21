/**
 * Shared argument parsing and printing for the scenario scripts. Headless: no database.
 */
import {
  SCENARIO_NAMES,
  isScenarioName,
  type RunMetrics,
  type ScenarioName,
} from "../packages/simulation-core/src/index";

export function arg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
}

export function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} deve essere un numero positivo`);
  return value;
}

export function scenarioArg(fallback: ScenarioName = "baseline"): ScenarioName {
  const raw = arg("scenario", fallback)!;
  if (!isScenarioName(raw)) {
    throw new Error(`Scenario sconosciuto «${raw}». Disponibili: ${SCENARIO_NAMES.join(", ")}`);
  }
  return raw;
}

/** Metrics shown in the tables, in order, with an Italian label. */
export const METRIC_LABELS: [keyof RunMetrics, string][] = [
  ["population", "popolazione"],
  ["peoplesAlive", "popoli vivi"],
  ["settlements", "insediamenti"],
  ["civilizations", "civiltà"],
  ["techMax", "tecnologie (max)"],
  ["techMin", "tecnologie (min)"],
  ["distinctTechSets", "set tecnologici distinti"],
  ["distinctTechOrders", "ordini di scoperta distinti"],
  ["firstDiscoveryYear", "prima scoperta (anno)"],
  ["lastAdoptionYear", "ultima adozione (anno)"],
  ["inventions", "scoperte autonome"],
  ["diffusions", "acquisite per diffusione"],
  ["techLost", "tecnologie perse"],
  ["rediscoveries", "riscoperte"],
  ["dynasties", "dinastie"],
  ["wars", "guerre"],
  ["battles", "battaglie"],
  ["vassalages", "vassallaggi"],
  ["occupations", "occupazioni"],
  ["fusions", "fusioni"],
  ["famines", "carestie"],
  ["collapses", "collassi"],
  ["beliefs", "credenze"],
  ["agreements", "accordi"],
  ["cultureSpread", "dispersione culturale"],
  ["largestShare", "quota del popolo più grande"],
  ["invariantProblems", "problemi di invarianti"],
  ["msPerTick", "ms per tick"],
];

export function printTable(columns: { title: string; metrics: RunMetrics }[]) {
  const width = Math.max(...METRIC_LABELS.map(([, label]) => label.length)) + 2;
  const header = "".padEnd(width) + columns.map((c) => c.title.padStart(18)).join("");
  console.log(header);
  for (const [key, label] of METRIC_LABELS) {
    const cells = columns.map((c) => String(c.metrics[key] ?? "—").padStart(18)).join("");
    console.log(label.padEnd(width) + cells);
  }
}
