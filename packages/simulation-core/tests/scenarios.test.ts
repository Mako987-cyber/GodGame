import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  SCENARIO_NAMES,
  buildScenario,
  checkDeterminism,
  checkInvariants,
  checkRuns,
  createWorld,
  hashWorld,
  measureRun,
  runAndMeasure,
  runSimulation,
  type RunMetrics,
} from "../src/index";

describe("scenari", () => {
  it("ogni scenario ha uno scopo dichiarato e produce un mondo valido", () => {
    for (const name of SCENARIO_NAMES) {
      expect(SCENARIOS[name].purpose, name).toBeTruthy();
      const state = buildScenario(name, `valido-${name}`, 32);
      expect(checkInvariants(state), name).toEqual([]);
      expect(state.tribes.length, name).toBeGreaterThan(0);
      // Every band stands on land it can live on.
      for (const tribe of state.tribes) {
        const cell = state.cells[tribe.y * state.width + tribe.x]!;
        expect(cell.biome, `${name}/${tribe.id}`).not.toBe("ocean");
      }
    }
  });

  it("sono deterministici: stesso seme, stesso mondo", () => {
    for (const name of SCENARIO_NAMES) {
      expect(hashWorld(buildScenario(name, "stesso", 32)), name).toBe(
        hashWorld(buildScenario(name, "stesso", 32)),
      );
    }
  });

  it("rimodellano davvero la terra che promettono", () => {
    const island = buildScenario("island", "isola", 40);
    const edge = island.cells.filter((c) => c.x === 0 || c.y === 0 || c.x === 39 || c.y === 39);
    expect(edge.every((c) => c.biome === "ocean")).toBe(true);
    expect(island.cells.some((c) => c.coastal)).toBe(true);

    const desert = buildScenario("desert", "deserto", 40);
    const landCells = desert.cells.filter((c) => c.biome !== "ocean");
    expect(landCells.filter((c) => c.biome === "desert").length).toBeGreaterThan(landCells.length / 2);

    const valley = buildScenario("fertile-valley", "valle", 40);
    expect(valley.cells.some((c) => c.river)).toBe(true);

    const mines = buildScenario("mining-region", "miniere", 40);
    const t = mines.tribes[0]!;
    expect(mines.cells[t.y * mines.width + t.x]!.copper).toBeGreaterThan(0);

    const rivals = buildScenario("rival-powers", "rivali", 40);
    expect(rivals.tribes).toHaveLength(2);
    expect(rivals.tribes.every((x) => x.culture.militarism >= 80)).toBe(true);

    const modern = buildScenario("modern-identities", "moderno", 48);
    expect(modern.tribes.every((x) => x.identityType === "historical")).toBe(true);
    // Modern identities start exactly like everybody else: no technology from the name.
    expect(new Set(modern.tribes.map((x) => x.techs.join(","))).size).toBe(1);
  });

  it("gli spostamenti non toccano il generatore della simulazione", () => {
    const plain = createWorld({ seed: "rng-scenario", width: 40, height: 40 });
    const valley = buildScenario("fertile-valley", "rng-scenario", 40);
    expect(valley.rng).toEqual(plain.rng);
  });
});

describe("misure e controlli", () => {
  it("le misure di un run sono coerenti", () => {
    const state = buildScenario("baseline", "misure", 40);
    const result = runSimulation(state, 60);
    const m = measureRun(state, result.events, 60, 120);
    expect(m.ticks).toBe(60);
    expect(m.msPerTick).toBe(2);
    expect(m.techMax).toBeGreaterThanOrEqual(m.techMin);
    expect(m.distinctTechSets).toBeLessThanOrEqual(Math.max(1, m.peoplesAlive));
    expect(m.largestShare).toBeGreaterThanOrEqual(0);
    expect(m.largestShare).toBeLessThanOrEqual(1);
    expect(m.invariantProblems).toBe(0);
    expect(m.stateHash).toBe(hashWorld(state));
  });

  it("il tempo è iniettabile, quindi le misure restano deterministiche nei test", () => {
    let clock = 0;
    const m = runAndMeasure(buildScenario("baseline", "orologio", 32), 10, () => (clock += 50));
    expect(m.msPerTick).toBe(5);
  });

  it("misurare le fasi del tick non cambia la simulazione", () => {
    const plain = buildScenario("baseline", "profilo", 40);
    const timed = buildScenario("baseline", "profilo", 40);
    runSimulation(plain, 40);
    const phases: Record<string, number> = {};
    runSimulation(timed, 40, { profile: phases });
    expect(hashWorld(timed)).toBe(hashWorld(plain));
    expect(Object.keys(phases).length).toBeGreaterThan(10);
    for (const ms of Object.values(phases)) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("il determinismo regge anche a lotti irregolari", () => {
    const check = checkDeterminism(() => buildScenario("trade-corridor", "lotti", 40), 60);
    expect(check.stable).toBe(true);
  });

  it("i controlli segnalano quello che devono segnalare", () => {
    const run = (overrides: Partial<RunMetrics>): RunMetrics => ({
      seed: "x",
      ticks: 100,
      population: 100,
      peoplesAlive: 3,
      peoplesEver: 3,
      settlements: 1,
      civilizations: 0,
      techMax: 5,
      techMin: 3,
      distinctTechSets: 2,
      distinctTechOrders: 2,
      firstDiscoveryYear: 0,
      lastAdoptionYear: 0,
      inventions: 10,
      diffusions: 3,
      techLost: 1,
      rediscoveries: 0,
      dynasties: 1,
      wars: 1,
      battles: 1,
      vassalages: 0,
      occupations: 0,
      fusions: 0,
      famines: 0,
      collapses: 0,
      beliefs: 0,
      agreements: 0,
      cultureSpread: 8,
      largestShare: 0.4,
      invariantProblems: 0,
      msPerTick: 1,
      stateHash: "h",
      ...overrides,
    });
    const healthy = checkRuns([run({}), run({})], { stable: true, detail: "" });
    expect(healthy.every((c) => c.passed)).toBe(true);

    const bad = checkRuns(
      [
        run({
          distinctTechOrders: 1,
          inventions: 0,
          diffusions: 50,
          invariantProblems: 2,
          cultureSpread: 1,
          largestShare: 0.95,
        }),
      ],
      { stable: false, detail: "" },
    );
    const failed = new Set(bad.filter((c) => !c.passed).map((c) => c.id));
    for (const id of [
      "invariants",
      "determinism",
      "same-order",
      "no-discovery",
      "instant-diffusion",
      "runaway",
      "culture-convergence",
    ]) {
      expect(failed.has(id), id).toBe(true);
    }
    // Broken guarantees are errors; balance smells are warnings.
    expect(bad.find((c) => c.id === "invariants")!.severity).toBe("error");
    expect(bad.find((c) => c.id === "runaway")!.severity).toBe("warning");
  });
});
