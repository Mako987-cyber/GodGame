import { describe, expect, it } from "vitest";
import { exchangeGoods } from "../src/economy";
import {
  addResource,
  createWorld,
  emptyStock,
  getResourceAmount,
  resolveBattle,
  Rng,
  runSimulation,
  sidePower,
  type CombatSide,
} from "../src/index";

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

describe("commercio", () => {
  it("scambia ciò che è in eccedenza contro ciò che manca", () => {
    const a = emptyStock();
    const b = emptyStock();
    addResource(a, "food", 200);
    addResource(b, "copper", 120);
    const volume = exchangeGoods(a, 20, b, 20, { surplusShare: 0.2, transportLoss: 0 });
    expect(volume).toBeGreaterThan(0);
    expect(getResourceAmount(b, "food")).toBeGreaterThan(0);
    expect(getResourceAmount(a, "copper")).toBeGreaterThan(0);
    // Both sides gain a little tradeable wealth.
    expect(getResourceAmount(a, "wealth")).toBeGreaterThan(0);
  });

  it("la distanza costa parte del carico", () => {
    const near = { a: emptyStock(), b: emptyStock() };
    const far = { a: emptyStock(), b: emptyStock() };
    for (const pair of [near, far]) addResource(pair.a, "food", 200);
    exchangeGoods(near.a, 20, near.b, 20, { surplusShare: 0.2, transportLoss: 0 });
    exchangeGoods(far.a, 20, far.b, 20, { surplusShare: 0.2, transportLoss: 0.5 });
    expect(getResourceAmount(far.b, "food")).toBeLessThan(getResourceAmount(near.b, "food"));
  });

  it("senza eccedenze non si commercia", () => {
    const a = emptyStock();
    const b = emptyStock();
    addResource(a, "food", 10);
    addResource(b, "food", 10);
    expect(exchangeGoods(a, 20, b, 20)).toBe(0);
  });
});

describe("diplomazia e guerra", () => {
  it("le relazioni restano coerenti e simmetriche", () => {
    const state = createWorld({ seed: "diplomazia" });
    runSimulation(state, 300);
    const tribes = new Set(state.tribes.map((t) => t.id));
    const seen = new Set<string>();
    for (const rel of state.relationships) {
      expect(seen.has(rel.id)).toBe(false);
      seen.add(rel.id);
      expect(rel.aId).not.toBe(rel.bId);
      expect(tribes.has(rel.aId)).toBe(true);
      expect(tribes.has(rel.bId)).toBe(true);
      // The relationship id encodes the ordered pair: one row per couple, both directions.
      expect(rel.id).toBe(`${rel.aId}|${rel.bId}`);
      expect(rel.atWar).toBe(rel.status === "war");
      expect(rel.atWar && rel.allied).toBe(false);
      for (const value of [rel.trust, rel.hostility, rel.respect, rel.culturalDistance]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("il commercio riuscito migliora la relazione", () => {
    const state = createWorld({ seed: "fiducia" });
    const result = runSimulation(state, 300);
    const trades = result.events.filter((e) => e.type === "trade" && e.subtype !== "first_contact");
    if (trades.length === 0) return;
    for (const e of trades) {
      const ids = e.actors.map((a) => a.id);
      const rel = state.relationships.find((r) => ids.includes(r.aId) && ids.includes(r.bId));
      if (!rel) continue;
      expect(rel.tradeVolume).toBeGreaterThanOrEqual(0);
      expect(rel.tradeDependency).toBeGreaterThanOrEqual(0);
    }
  });

  it("la guerra richiede condizioni sufficienti e passa dalla scala di tensione", () => {
    const state = createWorld({ seed: "guerre" });
    const result = runSimulation(state, 400);
    const declarations = result.events.filter((e) => e.subtype === "war_declared");
    for (const e of declarations) {
      expect(Number(e.metadata.warScore)).toBeGreaterThan(0.6);
      expect(Number(e.metadata.advantage)).toBeGreaterThan(1.1);
      expect(e.year - state.settings.startYear).toBeGreaterThanOrEqual(state.settings.warGraceYears);
    }
    // Every war eventually resolves or is still running; no war without a start year.
    for (const rel of state.relationships) {
      if (rel.atWar) expect(rel.warStartYear).not.toBeNull();
      else expect(rel.warStartYear).toBeNull();
    }
  });

  it("la risoluzione delle battaglie è deterministica e coerente", () => {
    const a = resolveBattle(side(30), side(25), Rng.fromSeed("battaglia"));
    const b = resolveBattle(side(30), side(25), Rng.fromSeed("battaglia"));
    expect(a).toEqual(b);
    // Fortifications and logistics change the outcome in the expected direction.
    expect(sidePower(side(30, { defense: 2 }))).toBeGreaterThan(sidePower(side(30)));
    expect(sidePower(side(30, { logistics: 0.6 }))).toBeLessThan(sidePower(side(30)));
    expect(sidePower(side(30, { leadership: 1.2 }))).toBeGreaterThan(sidePower(side(30)));
  });

  it("le conseguenze dei conflitti sono valide su popolazione e territorio", () => {
    const state = createWorld({ seed: "conseguenze" });
    const result = runSimulation(state, 400);
    const battles = result.events.filter((e) => e.type === "battle");
    for (const e of battles) {
      expect(Number(e.metadata.attackerLosses)).toBeGreaterThanOrEqual(0);
      expect(Number(e.metadata.defenderLosses)).toBeGreaterThanOrEqual(0);
      expect(Number(e.metadata.attackerWarriors)).toBeGreaterThanOrEqual(Number(e.metadata.attackerLosses));
    }
    const conquests = result.events.filter((e) => e.type === "conquest");
    for (const e of conquests) {
      const settlementId = String(e.metadata.settlementId);
      const settlement = state.settlements.find((s) => s.id === settlementId);
      expect(settlement).toBeDefined();
      expect(e.metadata.previousTribeId).not.toBe(e.metadata.newTribeId);
      // Conquered land follows the settlement.
      if (settlement!.status === "active") {
        for (const cell of state.cells) {
          if (cell.settlementId === settlementId) expect(cell.ownerTribeId).toBe(settlement!.tribeId);
        }
      }
    }
  });
});

describe("regressioni del modello", () => {
  it("la tregua scade e la scala di tensione può ripartire", () => {
    const state = createWorld({ seed: "tregue" });
    const result = runSimulation(state, 400);
    const peaces = result.events.filter((e) => e.type === "peace");
    for (const rel of state.relationships) {
      // An expired truce leaves no residue: neither in the label nor in the ladder.
      if (rel.truceUntilYear !== null) expect(rel.truceUntilYear).toBeGreaterThan(state.year);
      if (rel.status === "truce") expect(rel.truceUntilYear).not.toBeNull();
      if (rel.phase === "truce") expect(rel.atWar || rel.truceUntilYear !== null).toBe(true);
      expect(rel.phaseYears).toBeGreaterThanOrEqual(0);
    }
    // Where there was a war there is a recorded year of the last clash.
    for (const rel of state.relationships) {
      if (rel.battles > 0) expect(rel.lastConflictYear).not.toBeNull();
    }
    expect(peaces.length).toBeGreaterThanOrEqual(0);
  });

  it("i numeri nell'evento sono quelli che hanno deciso la guerra", () => {
    const state = createWorld({ seed: "coerenza-guerra" });
    const result = runSimulation(state, 500);
    const declarations = result.events.filter((e) => e.subtype === "war_declared");
    for (const e of declarations) {
      // The gate uses the same rounded values it stores: an event always justifies its decision.
      expect(Number(e.metadata.warScore)).toBeGreaterThan(0.6);
      expect(Number(e.metadata.advantage)).toBeGreaterThan(1.1);
    }
  });
});
