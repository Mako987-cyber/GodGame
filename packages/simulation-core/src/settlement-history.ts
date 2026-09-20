import type { SimContext } from "./context";
import { clamp, round } from "./grid";
import type {
  Cell,
  Settlement,
  SettlementFoundingReason,
  SettlementHistory,
  SettlementSpecialization,
  Tribe,
} from "./types";

/**
 * What a place remembers about itself.
 *
 * The chronicle of a world already lives in `historical_events`, and it is queried on demand.
 * What follows is the small, always-loaded summary a settlement carries with it: why it was
 * founded, what it became known for, how big it ever got, how many times it was emptied and
 * refilled, when it was a capital. It is deliberately bounded — a settlement that lives a
 * thousand years must not grow an unbounded payload.
 */

/** Most events a settlement keeps pinned to itself; older ones stay in the chronicle only. */
export const MAX_NOTABLE_EVENTS = 12;

export const FOUNDING_REASON_LABELS: Record<SettlementFoundingReason, string> = {
  migration: "approdo di una migrazione",
  agriculture: "terra da coltivare",
  trade: "posizione di scambio",
  military: "punto da presidiare",
  religious: "luogo di culto",
  resource: "giacimento da sfruttare",
  administrative: "sede di governo",
  refuge: "rifugio",
};

export const SPECIALIZATION_LABELS: Record<SettlementSpecialization, string> = {
  agricultural: "agricola",
  mining: "mineraria",
  military: "militare",
  commercial: "commerciale",
  harbour: "portuale",
  religious: "religiosa",
  administrative: "amministrativa",
  craft: "artigiana",
};

const sum = (cells: Cell[], pick: (c: Cell) => number) => cells.reduce((acc, c) => acc + pick(c), 0);
const mean = (cells: Cell[], pick: (c: Cell) => number) =>
  cells.length === 0 ? 0 : sum(cells, pick) / cells.length;

/**
 * Why a band stopped here. Read from the land and the moment, once, at foundation: the answer
 * is part of the place's identity and is never recomputed.
 */
export function foundingReasonFor(
  tribe: Tribe,
  area: Cell[],
  context: { threatened: boolean; hungry: boolean; tradePartners: number; settlementsOwned: number },
): SettlementFoundingReason {
  if (context.threatened) return tribe.culture.militarism >= 55 ? "military" : "refuge";
  if (context.hungry) return "refuge";
  if (sum(area, (c) => c.copper + c.iron + c.tin + c.coal) >= 12) return "resource";
  if (mean(area, (c) => c.baseFertility) >= 0.55 && tribe.techs.includes("agriculture")) {
    return "agriculture";
  }
  if (context.tradePartners >= 1 && area.some((c) => c.coastal || c.river)) return "trade";
  if (context.settlementsOwned >= 2 && tribe.culture.centralization >= 55) return "administrative";
  if (tribe.culture.spirituality >= 65) return "religious";
  return "migration";
}

export function emptyHistory(
  reason: SettlementFoundingReason,
  founderName: string | null,
  year: number,
): SettlementHistory {
  return {
    foundingReason: reason,
    founderName,
    specializations: [],
    peakPopulation: 0,
    peakYear: year,
    destructions: 0,
    reconstructions: 0,
    occupiedYears: 0,
    capitalPeriods: [],
    notableEventIds: [],
  };
}

/** What a place is actually known for, recomputed from what it has and what it does. */
export function specializationsOf(
  settlement: Settlement,
  area: Cell[],
  isCapital: boolean,
): SettlementSpecialization[] {
  const b = settlement.buildings;
  const found: SettlementSpecialization[] = [];
  const owned = area.filter((c) => c.settlementId === settlement.id);
  if (owned.reduce((acc, c) => acc + c.fields + c.pastures, 0) >= 4 || b.farm >= 2) {
    found.push("agricultural");
  }
  if (b.mine >= 1 || b.quarry >= 2) found.push("mining");
  if (b.barracks >= 1 || b.walls >= 1 || b.palisade >= 2) found.push("military");
  if (b.market >= 1) found.push("commercial");
  if (b.port >= 1) found.push("harbour");
  if (b.temple >= 1) found.push("religious");
  if (isCapital) found.push("administrative");
  if (b.kiln >= 1 || b.foundry >= 1) found.push("craft");
  return found;
}

/**
 * Step 10b: one year of a settlement's memory. Cheap by design — it touches counters and a
 * capped list, never the chronicle.
 */
export function updateSettlementHistory(
  ctx: SimContext,
  settlement: Settlement,
  area: Cell[],
  options: { isCapital: boolean; occupied: boolean },
) {
  const history = settlement.history;
  if (!history) return;
  if (settlement.population > history.peakPopulation) {
    history.peakPopulation = settlement.population;
    history.peakYear = ctx.state.year;
  }
  if (options.occupied) history.occupiedYears += 1;
  history.specializations = specializationsOf(settlement, area, options.isCapital);

  const current = history.capitalPeriods[history.capitalPeriods.length - 1];
  if (options.isCapital) {
    // A new spell as capital starts only if the place is not already in one.
    if (!current || current.toYear !== null) {
      history.capitalPeriods.push({ fromYear: ctx.state.year, toYear: null });
    }
  } else if (current && current.toYear === null) {
    current.toYear = ctx.state.year;
  }
}

/** Pins an event to the place that lived it, keeping only the most recent ones. */
export function rememberEvent(settlement: Settlement, eventId: string) {
  const history = settlement.history;
  if (!history || eventId.length === 0) return;
  if (history.notableEventIds.includes(eventId)) return;
  history.notableEventIds.push(eventId);
  if (history.notableEventIds.length > MAX_NOTABLE_EVENTS) history.notableEventIds.shift();
}

/** The place was emptied: the count goes up, everything else it was stays on record. */
export function recordDestruction(settlement: Settlement, eventId: string | null) {
  const history = settlement.history;
  if (!history) return;
  history.destructions += 1;
  const open = history.capitalPeriods[history.capitalPeriods.length - 1];
  if (open && open.toYear === null) open.toYear = settlement.abandonedYear;
  if (eventId) rememberEvent(settlement, eventId);
}

/**
 * People came back to a place that had been left. The settlement keeps its name, its founding
 * year and everything it had been: a rebirth is a new chapter, not a new town.
 */
export function recordReconstruction(settlement: Settlement, eventId: string | null) {
  const history = settlement.history;
  if (!history) return;
  history.reconstructions += 1;
  if (eventId) rememberEvent(settlement, eventId);
}

/** How much of what a place was survives being emptied, 0..1: walls and fields outlast people. */
export function survivingInfrastructure(settlement: Settlement, yearsEmpty: number): number {
  // Every year unattended takes a bite out of what was left standing.
  return round(clamp(1 - yearsEmpty * 0.03, 0, 1), 3);
}
