import { applyActionEffects, assignRole, chooseAction, type CommunityNeeds } from "./agents";
import { averageTemperature, climateStress, definingSeason, hazardsAt, updateClimate } from "./climate";
import { ECONOMY } from "./constants";
import { buildIndexes, emptyCounters, type Community, type SimContext } from "./context";
import { expireCrises, tryRevolt, updateEpidemics } from "./crises";
import {
  culturalDistance,
  updateCulture,
  updateDistribution,
  updateGovernment,
  updateStability,
} from "./culture";
import { buildProfiles, updateDiplomacy } from "./diplomacy";
import { consume, foodNeed, produce, redistributeFood } from "./economy";
import { actor, describePlace, emitEvent } from "./events";
import { clamp, distance, round } from "./grid";
import { assertInvariants } from "./invariants";
import { ensureLeader, tryCoup, updateLeaderStanding } from "./leadership";
import { joinNearbyGroup, migrateBand, splitBand } from "./migration";
import {
  ageAndNaturalDeaths,
  births,
  checkPopulationMilestone,
  crossCommunityMarriages,
  educateCommunity,
  formHouseholds,
  householdMap,
  isPartner,
  starvationDeaths,
  updatePrestige,
} from "./population";
import { Rng } from "./prng";
import { regenerateResources, workArea } from "./resources";
import { normalizeState } from "./serialization";
import {
  canFoundSettlement,
  checkCivilization,
  recordCivilizationCollapse,
  updateCivilizationForm,
  checkCollapse,
  foundSettlement,
  payUpkeep,
  progressConstruction,
  trySecession,
  trySpawnDaughter,
  updateSettlementStats,
  updateTerritory,
} from "./settlements";
import { advanceResearch, tribeEffects } from "./technology";
import { getResourceAmount, roundStock, stockValue } from "./stock";
import type { CivilizationStats, SimulationResult, TickStats, Tribe, WorldState } from "./types";

export interface RunOptions {
  /** Epoch ms after which no new tick is started (the batch returns as partial). */
  deadline?: number;
  now?: () => number;
  /** Runs the integrity checks after every tick (development and tests). */
  checkInvariants?: boolean;
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
    emitted: new Map(),
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
  const civStats: CivilizationStats[] = [];
  let ticksRun = 0;
  let partial = false;
  for (let i = 0; i < ticks; i++) {
    if (options.deadline !== undefined && now() > options.deadline) {
      partial = true;
      break;
    }
    runTick(ctx);
    stats.push(collectStats(ctx));
    if (state.tick % state.config.observability.civStatsInterval === 0) {
      civStats.push(...collectCivilizationStats(ctx));
    }
    if (options.checkInvariants) assertInvariants(state, { events: ctx.events });
    ticksRun++;
  }
  state.rng = ctx.rng.getState();
  return { ticksRun, partial, events: ctx.events, stats, civStats };
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

function computeNeeds(ctx: SimContext, c: Community): CommunityNeeds {
  const stockPerCapita = c.stock.food / Math.max(1, c.members.length);
  const owned = c.settlement ? c.area.filter((cell) => cell.settlementId === c.settlement?.id) : [];
  const fields = owned.reduce((acc, cell) => acc + cell.fields, 0);
  const pastures = owned.reduce((acc, cell) => acc + cell.pastures, 0);
  const techs = c.tribe.techs;
  const project = c.settlement?.construction ?? null;
  // How much raw material the group still owes to its own building site.
  const materialsNeeded = project
    ? Object.entries(project.requiredResources).reduce(
        (acc, [kind, amount]) => acc + Math.max(0, amount - (project.deliveredResources[kind as never] ?? 0)),
        0,
      )
    : 0;
  const deposits = c.area.reduce(
    (acc, cell) => acc + cell.copper + cell.tin + cell.iron + cell.coal + cell.clay,
    0,
  );
  const tools = getResourceAmount(c.stock, "tools");
  return {
    food: clamp(0.4 + (1 - Math.min(1, c.foodRatio)) * 1.2 + Math.max(0, 0.8 - stockPerCapita) * 0.5),
    build: c.settlement ? (project ? 0.7 : 0.35) : 0,
    threat: c.threat,
    migration: c.kind === "band" && c.tribe.scarcityYears >= 1 ? 0.6 : 0,
    farmSlots: fields * ECONOMY.farmersPerField,
    canFarm: techs.includes("agriculture") && fields > 0,
    pastureSlots: pastures * ECONOMY.herdersPerPasture,
    canHerd: techs.includes("animal_husbandry") && pastures > 0,
    canFish: techs.includes("fishing") && c.area.some((cell) => cell.river || cell.coastal),
    minerals: clamp(materialsNeeded / 40 + (deposits > 0 ? 0.3 : 0)),
    canMine: deposits > 5 && (techs.includes("copper_working") || techs.includes("pottery")),
    crafts: clamp(0.3 + Math.max(0, 1 - tools / Math.max(1, c.members.length)) * 0.6),
    canCraft: techs.includes("copper_working") || techs.includes("weaving") || techs.includes("smelting"),
  };
}

function tribesAlive(ctx: SimContext): Tribe[] {
  return ctx.state.tribes.filter((t) => t.status !== "extinct");
}

/**
 * One year of the world, in a fixed and documented order. The sequence never changes:
 * the same state with the same RNG always produces the same next state.
 *
 *  1. climate and seasons          9. infrastructure and construction
 *  2. resource regeneration       10. technology and diffusion
 *  3. needs, roles and health     11. culture, government and stability
 *  4. labour assignment           12. trade
 *  5. production                  13. diplomacy and conflicts
 *  6. distribution and consumption 14. war
 *  7. demography                  15. crises and events
 *  8. migration                   16. metrics
 */
export function runTick(ctx: SimContext) {
  const { state, rng } = ctx;
  // Canonical ordering every tick: batch size and DB reloads must not change iteration order.
  normalizeState(state);
  state.tick += 1;
  state.year += 1;
  ctx.counters = emptyCounters();
  ctx.emitted.clear();
  buildIndexes(ctx);

  // 1-2. Climate, seasons and resource regeneration.
  updateClimate(ctx);
  regenerateResources(state);
  buildCommunities(ctx);
  computeThreat(ctx);

  // 3-4. Leadership, roles and actions.
  const households = householdMap(ctx);
  const effectsByTribe = new Map<string, ReturnType<typeof tribeEffects>>();
  for (const tribe of tribesAlive(ctx)) {
    effectsByTribe.set(tribe.id, tribeEffects(tribe));
    ensureLeader(
      ctx,
      tribe,
      ctx.communities.filter((c) => c.tribe.id === tribe.id).flatMap((c) => c.members),
    );
  }
  const effectsOf = (tribe: Tribe) => effectsByTribe.get(tribe.id) ?? tribeEffects(tribe);
  for (const c of ctx.communities) {
    const needs = computeNeeds(ctx, c);
    const hasMilitary = c.tribe.techs.includes("military_org");
    for (const p of c.members) {
      p.role = assignRole(p, needs, c.tribe.leaderId === p.id, hasMilitary, rng);
      p.action = chooseAction(p, c, needs, !isPartner(p, households), rng);
      applyActionEffects(p, p.action);
    }
  }

  // 5-6. Production, consumption, hunger and health.
  for (const tribe of state.tribes) {
    tribe.lastFoodProduced = 0;
    tribe.lastFoodConsumed = 0;
  }
  const productions = new Map<Community, ReturnType<typeof produce>>();
  for (const c of ctx.communities) productions.set(c, produce(ctx, c, effectsOf(c.tribe)));
  redistributeFood(ctx.communities);
  for (const c of ctx.communities) {
    const effects = effectsOf(c.tribe);
    const production = productions.get(c);
    const consumption = consume(ctx, c, effects);
    const ratio = round(consumption.ratio);
    if (c.settlement) c.settlement.lastFoodRatio = ratio;
    else c.tribe.lastFoodRatio = ratio;
    c.tribe.lastFoodProduced = round(c.tribe.lastFoodProduced + (production?.food ?? 0), 2);
    c.tribe.lastFoodConsumed = round(c.tribe.lastFoodConsumed + consumption.eaten, 2);
    if (c.settlement && production) {
      c.settlement.lastProduction = {
        food: round(production.food, 2),
        wood: round(production.wood, 2),
        stone: round(production.stone, 2),
        copper: round(production.copper, 2),
        goods: {
          clay: round(production.clay, 2),
          tin: round(production.tin, 2),
          iron: round(production.iron, 2),
          hides: round(production.hides, 2),
          tools: round(production.tools, 2),
        },
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

  // 8. Ageing, natural deaths, starvation and epidemics.
  for (const c of ctx.communities) {
    ageAndNaturalDeaths(ctx, c, effectsOf(c.tribe));
    starvationDeaths(ctx, c);
    educateCommunity(c);
    updatePrestige(c);
  }
  updateEpidemics(ctx, ctx.communities);

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

  // 9. Migration, band splits and absorption of tiny groups.
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

  // 10. Settlements: foundation, construction, upkeep, colonies, collapse.
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
    const effects = effectsOf(c.tribe);
    progressConstruction(ctx, c, effects, friendly.get(c.tribe.id) ?? new Set());
    payUpkeep(ctx, c);
    trySpawnDaughter(ctx, c);
    trySecession(ctx, c);
    checkCollapse(ctx, c);
  }
  refreshSettlements(ctx);
  updateTerritory(ctx);

  // 11. Technology, research and adoption.
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
      tradePartners: rels.filter((r) => r.tradeVolume > 10 && !r.atWar).length,
    });
  }

  // 12. Culture, government and internal stability.
  updateSociety(ctx);

  // 13-14. Relations: trade, knowledge, raids, wars, peace.
  computeThreat(ctx);
  updateDiplomacy(ctx, buildProfiles(ctx));

  // 15-16. Crises, bookkeeping, extinction, civilizations, milestones.
  expireCrises(ctx);
  finalizeTick(ctx);
}

/** Step 12: culture drift, form of government, stability and internal unrest. */
function updateSociety(ctx: SimContext) {
  const { state } = ctx;
  const config = state.config.society;
  // Births of the year per tribe: one pass, then O(1) per tribe.
  const birthsByTribe = new Map<string, number>();
  for (const p of state.people) {
    if (p.birthYear === state.year) birthsByTribe.set(p.tribeId, (birthsByTribe.get(p.tribeId) ?? 0) + 1);
  }
  for (const tribe of tribesAlive(ctx)) {
    const comms = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    const members = comms.flatMap((c) => c.members);
    if (members.length === 0) continue;
    const settlementsOwned = comms.filter((c) => c.settlement);
    const rels = state.relationships.filter((r) => r.aId === tribe.id || r.bId === tribe.id);
    const atWar = rels.some((r) => r.atWar);
    const foodRatio =
      comms.reduce((acc, c) => acc + c.foodRatio * c.members.length, 0) / Math.max(1, members.length);
    const capital = settlementsOwned.reduce<Community | null>(
      (best, c) => (!best || (c.settlement?.population ?? 0) > (best.settlement?.population ?? 0) ? c : best),
      null,
    );
    const spread = capital
      ? settlementsOwned.reduce((acc, c) => acc + distance(c.x, c.y, capital.x, capital.y), 0) /
        Math.max(1, settlementsOwned.length)
      : 0;
    const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
    const neighbours = rels.filter((r) => r.distance <= 8);
    const culturalStrain =
      neighbours.length > 0
        ? neighbours.reduce((acc, r) => acc + r.culturalDistance * (r.hostility > 0.4 ? 1 : 0.4), 0) /
          neighbours.length
        : 0;
    const epidemic = state.crises.some(
      (c) => c.kind === "epidemic" && settlementsOwned.some((s) => s.settlement?.id === c.targetId),
    );

    updateStability(
      tribe,
      {
        population: members.length,
        foodRatio,
        atWar,
        recentDefeat: rels.some((r) => r.lastConflictYear !== null && state.year - r.lastConflictYear <= 2),
        leaderMissing: !leader?.alive,
        leaderPrestige: leader?.alive ? leader.prestige : 0,
        settlements: settlementsOwned.length,
        spread,
        epidemic,
        // A group that grows too fast strains its own cohesion.
        growthRate: clamp((birthsByTribe.get(tribe.id) ?? 0) / Math.max(1, members.length), 0, 1),
        culturalStrain,
      },
      config.stabilityInertia,
    );

    const discovery = Object.keys(tribe.techProgress).length > 0 ? 0.6 : tribe.techs.length > 4 ? 0.4 : 0.2;
    updateCulture(
      tribe,
      {
        war: atWar ? 1 : rels.some((r) => r.hostility > 0.5) ? 0.5 : 0.1,
        trade: clamp(rels.reduce((acc, r) => acc + r.tradeDependency, 0) / Math.max(1, rels.length)),
        scarcity: clamp(1 - foodRatio),
        discovery,
        expansion: clamp(settlementsOwned.length / 4),
        complexity: clamp(members.length / 400 + settlementsOwned.length / 6),
      },
      config.cultureDrift,
    );

    updateGovernment(
      ctx,
      tribe,
      members.length,
      settlementsOwned.reduce((acc, c) => Math.max(acc, c.settlement?.level ?? 0), 0),
      settlementsOwned.length,
    );
    updateDistribution(tribe, atWar, clamp(1 - foodRatio));
    updateLeaderStanding(ctx, tribe, foodRatio);

    // Unrest turns into a revolt or a change at the top only after years of pressure.
    if (tribe.stability.unrestYears >= config.unrestYearsBeforeRevolt) {
      const worst = comms.reduce<Community | null>(
        (best, c) => (!best || (c.settlement?.unrest ?? 0) > (best.settlement?.unrest ?? 0) ? c : best),
        null,
      );
      if (worst && !tryRevolt(ctx, worst)) tryCoup(ctx, tribe, members);
    }
    // Local unrest tracks the group's tension plus what happens in each settlement.
    for (const c of settlementsOwned) {
      if (!c.settlement) continue;
      const target = clamp(
        tribe.stability.tension * 0.7 + (1 - c.foodRatio) * 0.4 - c.settlement.buildings.temple * 0.05,
      );
      c.settlement.unrest = round(clamp(c.settlement.unrest + (target - c.settlement.unrest) * 0.3));
    }
  }
  // Cultural distance is recomputed once per year for every known pair.
  for (const rel of state.relationships) {
    const a = ctx.tribes.get(rel.aId);
    const b = ctx.tribes.get(rel.bId);
    if (a && b) rel.culturalDistance = culturalDistance(a.culture, b.culture);
  }
}

function famineEvent(ctx: SimContext, c: Community) {
  const where = c.settlement ? c.settlement.name : describePlace(ctx.state, c.x, c.y);
  const hazards = hazardsAt(ctx.state, c.x, c.y);
  const causes: string[] = [];
  if (hazards.some((h) => h.kind === "drought")) causes.push("la siccità");
  if (ctx.state.climate.harshWinter) causes.push("l'inverno rigidissimo");
  if (c.threat >= 1) causes.push("la guerra");
  emitEvent(ctx, {
    type: "famine",
    subtype: hazards[0]?.kind ?? "shortage",
    importance: 3,
    actors: c.settlement ? [actor.settlement(c.settlement), actor.tribe(c.tribe)] : [actor.tribe(c.tribe)],
    x: c.x,
    y: c.y,
    title: `Carestia ${c.settlement ? `a ${c.settlement.name}` : `tra i ${c.tribe.name}`}`,
    description: `Da due anni il cibo non basta presso ${where}: la tribù ${c.tribe.name} riesce a coprire solo il ${Math.round(c.foodRatio * 100)}% del fabbisogno${causes.length ? `, complice ${causes.join(" e ")}` : ""}.`,
    metadata: {
      foodRatio: round(c.foodRatio, 2),
      population: c.members.length,
      stored: round(c.stock.food, 2),
      climateModifier: ctx.state.climate.modifier,
      harshWinter: ctx.state.climate.harshWinter,
      hazards: hazards.map((h) => h.kind).join(","),
    },
    causeEventIds: hazards.map((h) => h.eventId).filter((id): id is string => Boolean(id)),
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
    updateSettlementStats(ctx, s, counts.get(s.id) ?? 0, tribe, tribeEffects(tribe));
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
      for (const d of state.dynasties) {
        if (d.tribeId === tribe.id && d.endedYear === null) d.endedYear = state.year;
      }
      emitEvent(ctx, {
        type: "tribe_extinct",
        subtype: "extinction",
        importance: 4,
        actors: [actor.tribe(tribe)],
        x: tribe.x,
        y: tribe.y,
        title: `Scompaiono i ${tribe.name}`,
        description: `Dell'antica tribù ${tribe.name} non resta più nessuno presso ${describePlace(state, tribe.x, tribe.y)}.`,
        metadata: {
          foundedYear: tribe.foundedYear,
          years: state.year - tribe.foundedYear,
          technologies: tribe.techs.length,
        },
      });
      for (const rel of state.relationships) {
        if (rel.aId === tribe.id || rel.bId === tribe.id) {
          rel.atWar = false;
          rel.allied = false;
          rel.warStartYear = null;
          rel.status = "unknown";
          rel.phase = "peace";
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
    tribe.morale = round(clamp(tribe.morale + (0.7 - tribe.morale) * 0.1, 0.2, 1));
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
      recordCivilizationCollapse(ctx, civ);
      continue;
    }
    updateCivilizationForm(ctx, civ);
    if (!own.some((s) => s.id === civ.capitalSettlementId)) {
      civ.capitalSettlementId = own.reduce((best, s) => (s.population > best.population ? s : best)).id;
    }
  }
  refreshSettlements(ctx);
}

export function collectStats(ctx: SimContext): TickStats {
  const { state, counters } = ctx;
  const techs = new Set<string>();
  let foodStored = 0;
  let wealth = 0;
  let storage = 0;
  let stability = 0;
  let aliveTribes = 0;
  for (const t of state.tribes) {
    if (t.status === "extinct") continue;
    aliveTribes++;
    for (const id of t.techs) techs.add(id);
    foodStored += t.stock.food;
    wealth += stockValue(t.stock);
    stability +=
      (t.stability.happiness + t.stability.cohesion + t.stability.legitimacy + t.stability.order) / 4;
  }
  let buildings = 0;
  for (const s of state.settlements) {
    if (s.status !== "active") continue;
    foodStored += s.stock.food;
    wealth += stockValue(s.stock);
    for (const count of Object.values(s.buildings)) buildings += count;
    storage += 30 + s.buildings.storehouse * 90 + s.buildings.kiln * 40;
  }
  const territory = state.cells.reduce((acc, c) => acc + (c.ownerTribeId ? 1 : 0), 0);
  const needed = state.people.reduce((acc, p) => acc + foodNeed(p), 0);
  const season = definingSeason(state);
  return {
    tick: state.tick,
    year: state.year,
    population: state.people.length,
    tribes: aliveTribes,
    settlements: state.settlements.filter((s) => s.status === "active").length,
    civilizations: state.civilizations.filter((c) => c.status === "active").length,
    foodProduced: round(counters.foodProduced, 1),
    foodConsumed: round(counters.foodConsumed, 1),
    foodStored: round(foodStored, 1),
    technologies: techs.size,
    wars: state.relationships.filter((r) => r.atWar).length,
    battles: counters.battles,
    births: counters.births,
    deaths: counters.deaths,
    starvationDeaths: counters.starvationDeaths,
    conflictDeaths: counters.conflictDeaths,
    epidemicDeaths: counters.epidemicDeaths,
    foodSurplus: round(counters.foodProduced - needed, 1),
    storageCapacity: round(storage, 1),
    goodsProduced: round(counters.goodsProduced, 1),
    tradeVolume: round(counters.tradeVolume, 1),
    wealth: round(wealth, 1),
    buildings,
    territory,
    averageTemperature: averageTemperature(state),
    climateStress: climateStress(state),
    averageStability: aliveTribes > 0 ? round(stability / aliveTribes, 3) : 0,
    migrations: counters.migrations,
    season,
  };
}

/** Per-civilization series, sampled at the configured interval. */
export function collectCivilizationStats(ctx: SimContext): CivilizationStats[] {
  const { state } = ctx;
  const populations = new Map<string, number>();
  for (const p of state.people) {
    const tribe = ctx.tribes.get(p.tribeId);
    if (tribe?.civilizationId)
      populations.set(tribe.civilizationId, (populations.get(tribe.civilizationId) ?? 0) + 1);
  }
  return state.civilizations
    .filter((c) => c.status === "active")
    .map((civ) => {
      const tribes = state.tribes.filter((t) => t.civilizationId === civ.id && t.status !== "extinct");
      const settlements = state.settlements.filter(
        (s) => s.status === "active" && s.civilizationId === civ.id,
      );
      const techs = new Set(tribes.flatMap((t) => t.techs));
      const stability =
        tribes.length > 0
          ? tribes.reduce(
              (acc, t) =>
                acc +
                (t.stability.happiness + t.stability.cohesion + t.stability.legitimacy + t.stability.order) /
                  4,
              0,
            ) / tribes.length
          : 0;
      return {
        tick: state.tick,
        year: state.year,
        civilizationId: civ.id,
        population: populations.get(civ.id) ?? 0,
        settlements: settlements.length,
        technologies: techs.size,
        foodStored: round(
          settlements.reduce((acc, s) => acc + s.stock.food, 0),
          1,
        ),
        wealth: round(
          settlements.reduce((acc, s) => acc + stockValue(s.stock), 0),
          1,
        ),
        territory: state.cells.filter((c) => c.ownerTribeId && tribes.some((t) => t.id === c.ownerTribeId))
          .length,
        stability: round(stability, 3),
        atWar: state.relationships.some(
          (r) => r.atWar && (tribes.some((t) => t.id === r.aId) || tribes.some((t) => t.id === r.bId)),
        ),
      };
    });
}
