import { describe, expect, it } from "vitest";
import {
  FOUNDING_REASON_LABELS,
  MAX_NOTABLE_EVENTS,
  RUINS_FORGOTTEN_AFTER,
  SPECIALIZATION_LABELS,
  createWorld,
  deserializeState,
  emptyHistory,
  foundingReasonFor,
  recordDestruction,
  recordReconstruction,
  rememberEvent,
  runSimulation,
  serializeWorld,
  specializationsOf,
  survivingInfrastructure,
  type Cell,
  type Settlement,
  type WorldState,
} from "../src/index";
import { createSettlement, ruinsAt } from "../src/settlements";
import { createContext } from "../src/simulation-engine";
import { world } from "./helpers";

function land(state: WorldState, patch: Partial<Cell> = {}): Cell[] {
  return state.cells
    .filter((c) => c.biome !== "ocean")
    .slice(0, 20)
    .map((c) => ({
      ...c,
      copper: 0,
      iron: 0,
      tin: 0,
      coal: 0,
      baseFertility: 0.2,
      coastal: false,
      river: false,
      ...patch,
    }));
}

const situation = (overrides = {}) => ({
  threatened: false,
  hungry: false,
  tradePartners: 0,
  settlementsOwned: 0,
  ...overrides,
});

describe("perché un luogo è stato scelto", () => {
  it("la ragione viene dalla terra e dal momento", () => {
    const state = world("ragioni");
    const tribe = state.tribes[0]!;
    tribe.culture = { ...tribe.culture, militarism: 70, spirituality: 30, centralization: 30 };

    expect(foundingReasonFor(tribe, land(state), situation({ threatened: true }))).toBe("military");
    tribe.culture = { ...tribe.culture, militarism: 20 };
    expect(foundingReasonFor(tribe, land(state), situation({ threatened: true }))).toBe("refuge");
    expect(foundingReasonFor(tribe, land(state), situation({ hungry: true }))).toBe("refuge");
    expect(foundingReasonFor(tribe, land(state, { copper: 3 }), situation())).toBe("resource");

    tribe.techs = ["agriculture"];
    expect(foundingReasonFor(tribe, land(state, { baseFertility: 0.7 }), situation())).toBe("agriculture");
    tribe.techs = [];
    expect(foundingReasonFor(tribe, land(state, { river: true }), situation({ tradePartners: 2 }))).toBe(
      "trade",
    );

    tribe.culture = { ...tribe.culture, centralization: 70 };
    expect(foundingReasonFor(tribe, land(state), situation({ settlementsOwned: 3 }))).toBe("administrative");
    tribe.culture = { ...tribe.culture, centralization: 20, spirituality: 80 };
    expect(foundingReasonFor(tribe, land(state), situation())).toBe("religious");
    tribe.culture = { ...tribe.culture, spirituality: 20 };
    expect(foundingReasonFor(tribe, land(state), situation())).toBe("migration");
  });

  it("ogni ragione e ogni specializzazione ha un'etichetta", () => {
    for (const label of Object.values(FOUNDING_REASON_LABELS)) expect(label).toBeTruthy();
    for (const label of Object.values(SPECIALIZATION_LABELS)) expect(label).toBeTruthy();
  });

  it("la ragione è fissata alla fondazione e non cambia più", () => {
    const state = world("fissata", 64);
    const ctx = createContext(state);
    const s = createSettlement(ctx, state.tribes[0]!, 10, 10, null, "resource");
    expect(s.history.foundingReason).toBe("resource");
    runSimulation(state, 30);
    expect(s.history.foundingReason).toBe("resource");
    expect(s.history.peakYear).toBeGreaterThanOrEqual(s.foundedYear);
  });
});

describe("cosa un luogo diventa", () => {
  it("le specializzazioni vengono da ciò che il luogo ha davvero", () => {
    const state = world("specializzazioni", 64);
    const ctx = createContext(state);
    const s = createSettlement(ctx, state.tribes[0]!, 12, 12);
    expect(specializationsOf(s, [], false)).toEqual([]);
    s.buildings.market = 1;
    s.buildings.port = 1;
    s.buildings.temple = 1;
    s.buildings.barracks = 1;
    s.buildings.mine = 1;
    s.buildings.kiln = 1;
    const found = specializationsOf(s, [], true);
    expect(found).toEqual(
      expect.arrayContaining([
        "mining",
        "military",
        "commercial",
        "harbour",
        "religious",
        "administrative",
        "craft",
      ]),
    );
    // Being the capital is what makes a place administrative, not its buildings.
    expect(specializationsOf(s, [], false)).not.toContain("administrative");
  });
});

describe("memoria di un luogo", () => {
  it("distruzioni e ricostruzioni si contano senza cancellare nulla", () => {
    const state = world("memoria", 64);
    const ctx = createContext(state);
    const s = createSettlement(ctx, state.tribes[0]!, 14, 14, null, "trade");
    const founded = s.foundedYear;
    s.abandonedYear = state.year;
    recordDestruction(s, "e1");
    recordReconstruction(s, "e2");
    recordDestruction(s, "e3");
    expect(s.history.destructions).toBe(2);
    expect(s.history.reconstructions).toBe(1);
    // Everything the place was is still on its record.
    expect(s.foundedYear).toBe(founded);
    expect(s.history.foundingReason).toBe("trade");
    expect(s.history.notableEventIds).toEqual(["e1", "e2", "e3"]);
  });

  it("la lista degli eventi resta limitata: il resto vive nella cronologia", () => {
    const history = emptyHistory("migration", null, 0);
    const s = { history } as Settlement;
    for (let i = 0; i < MAX_NOTABLE_EVENTS * 3; i++) rememberEvent(s, `e${i}`);
    expect(history.notableEventIds).toHaveLength(MAX_NOTABLE_EVENTS);
    // The most recent are the ones kept.
    expect(history.notableEventIds.at(-1)).toBe(`e${MAX_NOTABLE_EVENTS * 3 - 1}`);
    // The same event is never pinned twice.
    const before = history.notableEventIds.length;
    rememberEvent(s, history.notableEventIds[0]!);
    expect(history.notableEventIds).toHaveLength(before);
  });

  it("quello che resta in piedi si consuma con gli anni di abbandono", () => {
    const s = {} as Settlement;
    expect(survivingInfrastructure(s, 0)).toBe(1);
    expect(survivingInfrastructure(s, 10)).toBeLessThan(1);
    expect(survivingInfrastructure(s, 10)).toBeGreaterThan(survivingInfrastructure(s, 30));
    expect(survivingInfrastructure(s, 500)).toBe(0);
  });
});

describe("rinascita di un luogo", () => {
  it("le rovine recenti sono riconosciute, quelle dimenticate no", () => {
    const state = world("rovine", 64);
    const ctx = createContext(state);
    const s = createSettlement(ctx, state.tribes[0]!, 16, 16);
    expect(ruinsAt(ctx, 16, 16)).toBeUndefined();
    s.status = "abandoned";
    s.abandonedYear = state.year;
    expect(ruinsAt(ctx, 16, 16)?.id).toBe(s.id);
    state.year += RUINS_FORGOTTEN_AFTER + 1;
    expect(ruinsAt(ctx, 16, 16)).toBeUndefined();
    expect(ruinsAt(ctx, 30, 30)).toBeUndefined();
  });

  it("un luogo che rinasce è lo stesso luogo", () => {
    const state = createWorld({ seed: "rinascite", width: 64, height: 64 });
    const result = runSimulation(state, 600);
    const refounded = result.events.filter((e) => e.subtype === "refounded");
    for (const event of refounded) {
      const s = state.settlements.find((x) => x.id === event.metadata.settlementId)!;
      expect(s).toBeDefined();
      // It kept its founding year: the rebirth did not restart its history.
      expect(event.metadata.foundedYear).toBe(s.foundedYear);
      expect(s.history.reconstructions).toBeGreaterThan(0);
      expect(s.history.destructions).toBeGreaterThan(0);
      // Only part of what stood there survived the years of ruin.
      expect(event.metadata.survivingInfrastructure).toBeLessThanOrEqual(1);
    }
    // No two settlements ever share a spot while both are alive.
    const active = state.settlements.filter((s) => s.status === "active");
    const spots = active.map((s) => `${s.x},${s.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

describe("memoria in simulazione", () => {
  it("ogni insediamento ricorda coerentemente la propria storia", () => {
    const state = createWorld({ seed: "memoria-mondo", width: 64, height: 64 });
    runSimulation(state, 500);
    expect(state.settlements.length).toBeGreaterThan(0);
    for (const s of state.settlements) {
      const h = s.history;
      expect(h).toBeDefined();
      expect(FOUNDING_REASON_LABELS[h.foundingReason]).toBeTruthy();
      expect(h.peakPopulation).toBeGreaterThanOrEqual(s.population);
      expect(h.peakYear).toBeGreaterThanOrEqual(s.foundedYear);
      expect(h.destructions).toBeGreaterThanOrEqual(h.reconstructions);
      expect(h.notableEventIds.length).toBeLessThanOrEqual(MAX_NOTABLE_EVENTS);
      expect(h.occupiedYears).toBeGreaterThanOrEqual(0);
      for (const period of h.capitalPeriods) {
        expect(period.fromYear).toBeGreaterThanOrEqual(s.foundedYear);
        if (period.toYear !== null) expect(period.toYear).toBeGreaterThanOrEqual(period.fromYear);
      }
      // Only the last spell as capital can still be open.
      const open = h.capitalPeriods.filter((p) => p.toYear === null);
      expect(open.length).toBeLessThanOrEqual(1);
      if (open.length === 1) expect(h.capitalPeriods.at(-1)?.toYear).toBeNull();
    }
  });

  it("un mondo salvato prima della memoria si carica e la ricostruisce dai propri dati", () => {
    const original = createWorld({ seed: "legacy-memoria", width: 48, height: 48 });
    runSimulation(original, 200);
    const payload = JSON.parse(serializeWorld(original)) as {
      version: number;
      state: { settlements: Record<string, unknown>[] };
    };
    for (const s of payload.state.settlements) delete s.history;
    const restored = deserializeState(payload as never);
    for (const [i, s] of restored.settlements.entries()) {
      const before = original.settlements[i]!;
      expect(s.history).toBeDefined();
      // Nothing is invented: the peak is what the row proves, the year is the founding year.
      expect(s.history.peakPopulation).toBe(before.population);
      expect(s.history.peakYear).toBe(before.foundedYear);
      expect(s.history.destructions).toBe(before.status === "abandoned" ? 1 : 0);
      expect(s.history.notableEventIds).toEqual([]);
    }
    expect(() => runSimulation(restored, 20)).not.toThrow();
  });
});
