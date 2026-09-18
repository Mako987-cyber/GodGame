import { applyActionEffects, assignRole, chooseAction, type CommunityNeeds } from "./agents";
import { buildIndexes, emptyCounters, type Community, type SimContext } from "./context";
import { buildProfiles, updateDiplomacy } from "./diplomacy";
import { consume, produce, redistributeFood, roundStock } from "./economy";
import { actor, describePlace, emitEvent } from "./events";
import { clamp, distance } from "./grid";
import { joinNearbyGroup, migrateBand, splitBand } from "./migration";
import {
  ageAndNaturalDeaths,
  births,
  checkPopulationMilestone,
  crossCommunityMarriages,
  ensureLeader,
  formHouseholds,
  householdMap,
  isPartner,
  starvationDeaths,
} from "./population";
import { Rng } from "./prng";
import { normalizeState } from "./serialization";
import { regenerateResources, updateClimate, workArea } from "./resources";
import {
  canFoundSettlement,
  checkCivilization,
  checkCollapse,
  foundSettlement,
  progressConstruction,
  trySecession,
  trySpawnDaughter,
  updateSettlementStats,
  updateTerritory,
} from "./settlements";
import { advanceResearch, techEffects } from "./technology";
import type { SimulationResult, TickStats, Tribe, WorldState } from "./types";

export interface RunOptions {
  /** Epoch ms after which no new tick is started (the batch returns as partial). */
  deadline?: number;
  now?: () => number;
}

export function createContext(state: WorldState): SimContext {
  const ctx: SimContext = {
    state,
    rng: new Rng(state.rng),
    events: [],
    counters: emptyCounters(),
    tribes: new Map(),
    settlements: new Map(),
    people: new Map(),
    communities: [],
  };
  buildIndexes(ctx);
  return ctx;
}

/**
 * Runs `ticks` years on `state` (mutated in place). The RNG state is written back
 * so the next batch continues the exact same random sequence.
 */
export function runSimulation(state: WorldState, ticks: number, options: RunOptions = {}): SimulationResult {
  const ctx = createContext(state);
  const now = options.now ?? Date.now;
  const stats: TickStats[] = [];
  let ticksRun = 0;
  let partial = false;
  for (let i = 0; i < ticks; i++) {
    if (options.deadline !== undefined && now() > options.deadline) {
      partial = true;
      break;
    }
    runTick(ctx);
    stats.push(collectStats(ctx));
    ticksRun++;
  }
  state.rng = ctx.rng.getState();
  return { ticksRun, partial, events: ctx.events, stats };
}

export function buildCommunities(ctx: SimContext) {
  const { state } = ctx;
  const communities: Community[] = [];
  const bySettlement = new Map<string, Community>();
  const byBand = new Map<string, Community>();
  for (const s of state.settlements) {
    if (s.status !== "active") continue;
    const tribe = ctx.tribes.get(s.tribeId);
    if (!tribe) continue;
    const c: Community = {
      key: s.id,
      kind: "settlement",
      tribe,
      settlement: s,
      x: s.x,
      y: s.y,
      radius: s.territoryRadius,
      area: workArea(state, s.x, s.y, s.territoryRadius),
      members: [],
      stock: s.stock,
      foodRatio: s.lastFoodRatio,
      threat: 0,
    };
    communities.push(c);
    bySettlement.set(s.id, c);
  }
  for (const p of state.people) {
    if (!p.alive) continue;
    if (p.settlementId) {
      const c = bySettlement.get(p.settlementId);
      if (c) {
        c.members.push(p);
        continue;
      }
      p.settlementId = null;
    }
    let band = byBand.get(p.tribeId);
    if (!band) {
      const tribe = ctx.tribes.get(p.tribeId);
      if (!tribe) continue;
      band = {
        key: `band:${tribe.id}`,
        kind: "band",
        tribe,
        settlement: null,
        x: tribe.x,
        y: tribe.y,
        radius: 2,
        area: workArea(state, tribe.x, tribe.y, 2),
        members: [],
        stock: tribe.stock,
        foodRatio: tribe.lastFoodRatio,
        threat: 0,
      };
      byBand.set(tribe.id, band);
      communities.push(band);
    }
    p.x = band.x;
    p.y = band.y;
    band.members.push(p);
  }
  ctx.communities = communities.filter((c) => c.members.length > 0 || c.kind === "settlement");
}

function computeThreat(ctx: SimContext) {
  for (const c of ctx.communities) {
    let threat = 0;
    for (const rel of ctx.state.relationships) {
      if (rel.aId !== c.tribe.id && rel.bId !== c.tribe.id) continue;
      const otherId = rel.aId === c.tribe.id ? rel.bId : rel.aId;
      const near = ctx.communities.some((o) => o.tribe.id === otherId && distance(o.x, o.y, c.x, c.y) <= 12);
      if (!near) continue;
      if (rel.atWar) threat = Math.max(threat, 1);
      else if (rel.hostility > 0.35) threat = Math.max(threat, rel.hostility);
    }
    c.threat = threat;
  }
}

function computeNeeds(c: Community): CommunityNeeds {
  const stockPerCapita = c.stock.food / Math.max(1, c.members.length);
  const fields = c.settlement
    ? c.area
        .filter((cell) => cell.settlementId === c.settlement?.id)
        .reduce((acc, cell) => acc + cell.fields, 0)
    : 0;
  return {
    food: clamp(0.4 + (1 - Math.min(1, c.foodRatio)) * 1.2 + Math.max(0, 0.8 - stockPerCapita) * 0.5),
    build: c.settlement ? (c.settlement.construction ? 0.7 : 0.35) : 0,
    threat: c.threat,
    migration: c.kind === "band" && c.tribe.scarcityYears >= 1 ? 0.6 : 0,
    farmSlots: fields * 4,
    canFarm: c.tribe.techs.includes("agriculture") && fields > 0,
  };
}

function tribesAlive(ctx: SimContext): Tribe[] {
  return ctx.state.tribes.filter((t) => t.status !== "extinct");
}

export function runTick(ctx: SimContext) {
  const { state, rng } = ctx;
  // Canonical ordering every tick: batch size and DB reloads must not change iteration order.
  normalizeState(state);
  state.tick += 1;
  state.year += 1;
  ctx.counters = emptyCounters();
  buildIndexes(ctx);

  // 1-2. Climate and resource regeneration.
  updateClimate(ctx);
  regenerateResources(state);
  buildCommunities(ctx);
  computeThreat(ctx);

  // 3. Leadership, roles and actions.
  const households = householdMap(ctx);
  for (const tribe of tribesAlive(ctx)) {
    ensureLeader(
      ctx,
      tribe,
      ctx.communities.filter((c) => c.tribe.id === tribe.id).flatMap((c) => c.members),
    );
  }
  for (const c of ctx.communities) {
    const needs = computeNeeds(c);
    const hasMilitary = c.tribe.techs.includes("military_org");
    for (const p of c.members) {
      p.role = assignRole(p, needs, c.tribe.leaderId === p.id, hasMilitary, rng);
      p.action = chooseAction(p, c, needs, !isPartner(p, households), rng);
      applyActionEffects(p, p.action);
    }
  }

  // 4-6. Production, consumption, hunger and health.
  for (const tribe of state.tribes) {
    tribe.lastFoodProduced = 0;
    tribe.lastFoodConsumed = 0;
  }
  const productions = new Map<Community, ReturnType<typeof produce>>();
  for (const c of ctx.communities) productions.set(c, produce(ctx, c, techEffects(c.tribe.techs)));
  redistributeFood(ctx.communities);
  for (const c of ctx.communities) {
    const effects = techEffects(c.tribe.techs);
    const production = productions.get(c) ?? { food: 0, wood: 0, stone: 0, copper: 0, farmed: 0, foraged: 0 };
    const consumption = consume(ctx, c, effects);
    const ratio = Math.round(consumption.ratio * 1000) / 1000;
    if (c.settlement) c.settlement.lastFoodRatio = ratio;
    else c.tribe.lastFoodRatio = ratio;
    c.tribe.lastFoodProduced = Math.round((c.tribe.lastFoodProduced + production.food) * 100) / 100;
    c.tribe.lastFoodConsumed = Math.round((c.tribe.lastFoodConsumed + consumption.eaten) * 100) / 100;
    if (c.settlement) {
      c.settlement.lastProduction = {
        food: production.food,
        wood: production.wood,
        stone: production.stone,
        copper: production.copper,
      };
      roundStock(c.settlement.lastProduction);
    }
  }

  // 7. Couples and births.
  const population = state.people.length;
  const cap = state.settings.populationSoftCap;
  // Performance guard only: local food and housing are the real limits to growth.
  const populationPressure = clamp(1 - (population - cap * 0.9) / (cap * 0.3), 0.05, 1);
  for (const c of ctx.communities) formHouseholds(ctx, c, households);
  const trust = new Map(state.relationships.map((r) => [r.id, r.atWar ? 0 : r.trust]));
  crossCommunityMarriages(ctx, households, (a, b) => trust.get(`${a}|${b}`) ?? trust.get(`${b}|${a}`) ?? 0);
  buildCommunities(ctx);
  computeThreat(ctx);
  for (const c of ctx.communities) {
    const atWar = c.threat >= 1;
    const housingOk =
      !c.settlement || c.members.length <= c.settlement.buildings.camp * 15 + c.settlement.buildings.hut * 8;
    const newborns = births(ctx, c, households, { atWar, housingOk, populationPressure });
    for (const child of newborns) {
      state.people.push(child);
      ctx.people.set(child.id, child);
    }
    c.members.push(...newborns);
  }

  // 8-9. Ageing, natural deaths and starvation.
  for (const c of ctx.communities) {
    ageAndNaturalDeaths(ctx, c, techEffects(c.tribe.techs));
    starvationDeaths(ctx, c);
  }

  // Scarcity bookkeeping and famine events.
  for (const c of ctx.communities) {
    const ratio = c.foodRatio;
    if (c.settlement) {
      c.settlement.famineYears =
        ratio < 0.75 ? c.settlement.famineYears + 1 : Math.max(0, c.settlement.famineYears - 1);
      if (c.settlement.famineYears === 2) famineEvent(ctx, c);
    } else {
      c.tribe.scarcityYears =
        ratio < 0.85 ? c.tribe.scarcityYears + 1 : Math.max(0, c.tribe.scarcityYears - 1);
      if (c.tribe.scarcityYears === 2 && ratio < 0.7) famineEvent(ctx, c);
    }
    c.members = c.members.filter((p) => p.alive);
  }

  // 10. Migration, band splits and absorption of tiny groups.
  const relationships = new Map(state.relationships.map((r) => [r.id, r]));
  for (const c of ctx.communities) {
    if (c.kind !== "band" || c.members.length === 0) continue;
    migrateBand(ctx, c, c.threat >= 1);
    splitBand(ctx, c);
  }
  for (const tribe of tribesAlive(ctx)) {
    const members = ctx.communities.filter((c) => c.tribe.id === tribe.id).flatMap((c) => c.members);
    joinNearbyGroup(ctx, tribe, members, relationships);
  }

  // 11. Settlements: foundation, construction, colonies, collapse.
  for (const c of ctx.communities) {
    if (c.kind === "band" && c.tribe.status !== "extinct" && canFoundSettlement(ctx, c)) {
      const s = foundSettlement(ctx, c);
      c.kind = "settlement";
      c.settlement = s;
      c.stock = s.stock;
    }
  }
  const friendly = friendlyTribes(ctx);
  for (const c of ctx.communities) {
    if (!c.settlement || c.settlement.status !== "active") continue;
    const effects = techEffects(c.tribe.techs);
    progressConstruction(ctx, c, effects, friendly.get(c.tribe.id) ?? new Set());
    trySpawnDaughter(ctx, c);
    trySecession(ctx, c);
    checkCollapse(ctx, c);
  }
  refreshSettlements(ctx);
  updateTerritory(ctx);

  // 12. Technology.
  buildCommunities(ctx);
  for (const tribe of tribesAlive(ctx)) {
    const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    if (comms.length === 0) continue;
    const settlementsOwned = comms.filter((c) => c.settlement);
    const rels = state.relationships.filter((r) => r.aId === tribe.id || r.bId === tribe.id);
    advanceResearch(ctx, tribe, comms, {
      tribe,
      population: comms.reduce((acc, c) => acc + c.members.length, 0),
      settled: settlementsOwned.length > 0,
      settlements: settlementsOwned.length,
      maxSettlementLevel: settlementsOwned.reduce((acc, c) => Math.max(acc, c.settlement?.level ?? 0), 0),
      maxHostility: rels.reduce((acc, r) => Math.max(acc, r.hostility), 0),
      conflictMemory: rels.reduce((acc, r) => Math.max(acc, r.conflictMemory), 0),
    });
  }

  // 13. Relations: trade, knowledge, raids, wars, peace.
  computeThreat(ctx);
  updateDiplomacy(ctx, buildProfiles(ctx));

  // 14-15. Bookkeeping, extinction, civilizations, milestones.
  finalizeTick(ctx);
}

function famineEvent(ctx: SimContext, c: Community) {
  const where = c.settlement ? c.settlement.name : describePlace(ctx.state, c.x, c.y);
  emitEvent(ctx, {
    type: "famine",
    importance: 3,
    actors: c.settlement ? [actor.settlement(c.settlement), actor.tribe(c.tribe)] : [actor.tribe(c.tribe)],
    x: c.x,
    y: c.y,
    title: `Carestia ${c.settlement ? `a ${c.settlement.name}` : `tra i ${c.tribe.name}`}`,
    description: `Da due anni il cibo non basta presso ${where}: la tribù ${c.tribe.name} riesce a coprire solo il ${Math.round(c.foodRatio * 100)}% del fabbisogno.`,
    metadata: { foodRatio: Math.round(c.foodRatio * 100) / 100, population: c.members.length },
  });
}

function friendlyTribes(ctx: SimContext): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const rel of ctx.state.relationships) {
    if (rel.atWar || rel.trust < 0.4) continue;
    if (!map.has(rel.aId)) map.set(rel.aId, new Set());
    if (!map.has(rel.bId)) map.set(rel.bId, new Set());
    map.get(rel.aId)?.add(rel.bId);
    map.get(rel.bId)?.add(rel.aId);
  }
  return map;
}

/** Recount settlement populations, levels and defense after people moved around. */
function refreshSettlements(ctx: SimContext) {
  const counts = new Map<string, number>();
  for (const p of ctx.state.people) {
    if (p.alive && p.settlementId) counts.set(p.settlementId, (counts.get(p.settlementId) ?? 0) + 1);
  }
  for (const s of ctx.state.settlements) {
    if (s.status !== "active") {
      s.population = 0;
      continue;
    }
    const tribe = ctx.tribes.get(s.tribeId);
    if (!tribe) continue;
    updateSettlementStats(ctx, s, counts.get(s.id) ?? 0, tribe, techEffects(tribe.techs));
  }
}

function finalizeTick(ctx: SimContext) {
  const { state } = ctx;
  // Dead people and dissolved households leave the hot state; persistence stores them.
  const alive = [];
  for (const p of state.people) {
    if (p.alive) alive.push(p);
    else state.archive.people.push(p);
  }
  state.people = alive;
  const activeHouseholds = [];
  for (const h of state.households) {
    if (h.dissolvedYear === null) activeHouseholds.push(h);
    else state.archive.households.push(h);
  }
  state.households = activeHouseholds;

  const members = new Map<string, number>();
  for (const p of state.people) members.set(p.tribeId, (members.get(p.tribeId) ?? 0) + 1);

  for (const tribe of state.tribes) {
    if (tribe.status === "extinct") continue;
    const population = members.get(tribe.id) ?? 0;
    if (population === 0) {
      tribe.status = "extinct";
      tribe.extinctYear = state.year;
      tribe.leaderId = null;
      emitEvent(ctx, {
        type: "tribe_extinct",
        importance: 4,
        actors: [actor.tribe(tribe)],
        x: tribe.x,
        y: tribe.y,
        title: `Scompaiono i ${tribe.name}`,
        description: `Dell'antica tribù ${tribe.name} non resta più nessuno presso ${describePlace(state, tribe.x, tribe.y)}.`,
        metadata: { foundedYear: tribe.foundedYear },
      });
      for (const rel of state.relationships) {
        if (rel.aId === tribe.id || rel.bId === tribe.id) {
          rel.atWar = false;
          rel.allied = false;
          rel.warStartYear = null;
        }
      }
      continue;
    }
    const own = state.settlements.filter((s) => s.status === "active" && s.tribeId === tribe.id);
    if (own.length > 0) {
      tribe.status = "settled";
      const capital = own.reduce((best, s) => (s.population > best.population ? s : best));
      tribe.x = capital.x;
      tribe.y = capital.y;
      tribe.yearsAtLocation += 1;
      // Stragglers of a settled tribe move into the nearest village.
      for (const p of state.people) {
        if (p.tribeId !== tribe.id || p.settlementId) continue;
        const home = own.reduce((best, s) =>
          distance(s.x, s.y, p.x, p.y) < distance(best.x, best.y, p.x, p.y) ? s : best,
        );
        p.settlementId = home.id;
        p.x = home.x;
        p.y = home.y;
      }
      if (tribe.stock.food > 0) {
        capital.stock.food += tribe.stock.food;
        tribe.stock.food = 0;
      }
    } else {
      tribe.status = "nomadic";
    }
    tribe.morale = Math.round(clamp(tribe.morale + (0.7 - tribe.morale) * 0.1, 0.2, 1) * 1000) / 1000;
    ensureLeader(
      ctx,
      tribe,
      state.people.filter((p) => p.tribeId === tribe.id),
    );
    checkPopulationMilestone(ctx, tribe, population);
    checkCivilization(ctx, tribe, population);
  }

  for (const civ of state.civilizations) {
    if (civ.status !== "active") continue;
    const own = state.settlements.filter((s) => s.status === "active" && s.civilizationId === civ.id);
    for (const s of state.settlements) {
      if (
        s.status === "active" &&
        s.civilizationId !== civ.id &&
        ctx.tribes.get(s.tribeId)?.civilizationId === civ.id
      ) {
        s.civilizationId = civ.id;
      }
    }
    if (own.length === 0) {
      civ.status = "collapsed";
      civ.capitalSettlementId = null;
    } else if (!own.some((s) => s.id === civ.capitalSettlementId)) {
      civ.capitalSettlementId = own.reduce((best, s) => (s.population > best.population ? s : best)).id;
    }
  }
  refreshSettlements(ctx);
}

export function collectStats(ctx: SimContext): TickStats {
  const { state, counters } = ctx;
  const techs = new Set<string>();
  let foodStored = 0;
  for (const t of state.tribes) {
    if (t.status === "extinct") continue;
    for (const id of t.techs) techs.add(id);
    foodStored += t.stock.food;
  }
  for (const s of state.settlements) if (s.status === "active") foodStored += s.stock.food;
  return {
    tick: state.tick,
    year: state.year,
    population: state.people.length,
    tribes: state.tribes.filter((t) => t.status !== "extinct").length,
    settlements: state.settlements.filter((s) => s.status === "active").length,
    civilizations: state.civilizations.filter((c) => c.status === "active").length,
    foodProduced: Math.round(counters.foodProduced * 10) / 10,
    foodConsumed: Math.round(counters.foodConsumed * 10) / 10,
    foodStored: Math.round(foodStored * 10) / 10,
    technologies: techs.size,
    wars: state.relationships.filter((r) => r.atWar).length,
    battles: counters.battles,
    births: counters.births,
    deaths: counters.deaths,
    starvationDeaths: counters.starvationDeaths,
    conflictDeaths: counters.conflictDeaths,
  };
}
