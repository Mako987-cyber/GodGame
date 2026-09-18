import { AGE, BUILDINGS, ECONOMY, HOUSING, TRIBE_COLORS } from "./constants";
import type { Community, SimContext } from "./context";
import { emptyStock, nextId } from "./context";
import { actor, describePlace, emitEvent, pluralPeople } from "./events";
import { cellAt, cellsInRadius, distance, lineCells } from "./grid";
import { civilizationName, settlementName, tribeName } from "./names";
import { areaQuality, workArea } from "./resources";
import type { TechEffects } from "./technology";
import type { BuildingType, Cell, Settlement, Tribe } from "./types";

/** Years a band must stay in the same place before settling down. */
export const SETTLE_AFTER_YEARS = 8;
/** Consecutive famine years after which a settlement is abandoned. */
export const COLLAPSE_FAMINE_YEARS = 3;

export function createSettlement(ctx: SimContext, tribe: Tribe, x: number, y: number): Settlement {
  const { id, seq } = nextId(ctx.state, "settlement", "s");
  const used = new Set(ctx.state.settlements.map((s) => s.name));
  let name = settlementName(ctx.rng);
  while (used.has(name)) name = settlementName(ctx.rng);
  const settlement: Settlement = {
    id,
    seq,
    name,
    tribeId: tribe.id,
    civilizationId: tribe.civilizationId,
    x,
    y,
    level: 1,
    status: "active",
    foundedYear: ctx.state.year,
    abandonedYear: null,
    stock: emptyStock(),
    buildings: { camp: 1, hut: 0, storehouse: 0, farm: 0, road: 0, palisade: 0 },
    construction: null,
    defense: 1,
    territoryRadius: 2,
    famineYears: 0,
    roadLinks: [],
    lastProduction: emptyStock(),
    lastFoodRatio: 1,
    population: 0,
  };
  ctx.state.settlements.push(settlement);
  ctx.settlements.set(settlement.id, settlement);
  return settlement;
}

function nearbySettlement(ctx: SimContext, x: number, y: number, radius: number): Settlement | undefined {
  return ctx.state.settlements.find((s) => s.status === "active" && distance(s.x, s.y, x, y) <= radius);
}

/** Conditions for a nomadic band to settle down (documented in README). */
export function canFoundSettlement(ctx: SimContext, community: Community): boolean {
  if (community.kind !== "band") return false;
  const tribe = community.tribe;
  const cell = cellAt(ctx.state, community.x, community.y);
  // Before agriculture only exceptionally rich river/coast sites can feed a sedentary village.
  const richSite = (cell.river || cell.coastal) && areaQuality(community.area) >= 0.75;
  return (
    (tribe.techs.includes("agriculture") || richSite) &&
    community.members.length >= ctx.state.settings.settlementMinPopulation &&
    tribe.yearsAtLocation >= SETTLE_AFTER_YEARS &&
    community.foodRatio >= 0.95 &&
    tribe.stock.food >= community.members.length * 0.2 &&
    cell.habitability >= 0.5 &&
    !nearbySettlement(ctx, community.x, community.y, 4)
  );
}

export function foundSettlement(ctx: SimContext, community: Community): Settlement {
  const tribe = community.tribe;
  const first = !ctx.state.settlements.some((s) => s.tribeId === tribe.id);
  const settlement = createSettlement(ctx, tribe, community.x, community.y);
  settlement.stock = { ...tribe.stock };
  tribe.stock = emptyStock();
  tribe.status = "settled";
  for (const p of community.members) p.settlementId = settlement.id;
  settlement.population = community.members.length;
  emitEvent(ctx, {
    type: "settlement_founded",
    importance: first ? 4 : 3,
    actors: [actor.tribe(tribe), actor.settlement(settlement)],
    x: settlement.x,
    y: settlement.y,
    title: `Fondazione di ${settlement.name}`,
    description: `Dopo ${tribe.yearsAtLocation} anni presso ${describePlace(ctx.state, settlement.x, settlement.y)}, ${pluralPeople(community.members.length)} della tribù ${tribe.name} hanno fondato ${first ? "il primo accampamento stabile" : "un nuovo accampamento"}: ${settlement.name}.`,
    metadata: { settlementId: settlement.id, population: community.members.length, first },
  });
  return settlement;
}

export function computeLevel(s: Settlement, population: number, tribe: Tribe): number {
  const b = s.buildings;
  if (population >= 300 && b.storehouse >= 2 && tribe.techs.includes("writing")) return 5;
  if (population >= 150 && (b.road >= 1 || b.palisade >= 1) && tribe.techs.includes("writing")) return 4;
  if (population >= 80 && b.storehouse >= 1 && b.farm >= 2) return 3;
  if (population >= 40 && b.hut >= 3) return 2;
  return 1;
}

export function updateSettlementStats(
  ctx: SimContext,
  s: Settlement,
  population: number,
  tribe: Tribe,
  effects: TechEffects,
) {
  s.population = population;
  s.level = computeLevel(s, population, tribe);
  s.territoryRadius = Math.min(4, 1 + s.level);
  const cell = cellAt(ctx.state, s.x, s.y);
  const terrain = cell.biome === "hills" ? 1.2 : cell.biome === "mountain" ? 1.4 : cell.river ? 1.1 : 1;
  const roads = s.roadLinks.length > 0 ? 1.1 : 1;
  s.defense =
    Math.round((1 + s.buildings.palisade * 0.5) * effects.defenseMultiplier * terrain * roads * 100) / 100;
}

function bestFieldCell(ctx: SimContext, s: Settlement): Cell | null {
  const candidates = workArea(ctx.state, s.x, s.y, s.territoryRadius).filter(
    (c) =>
      c.settlementId === s.id &&
      c.biome !== "mountain" &&
      c.fields < ECONOMY.maxFieldsPerCell &&
      c.baseFertility >= 0.3,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.fertility > best.fertility ? c : best));
}

function roadTarget(ctx: SimContext, s: Settlement, friendly: Set<string>): Settlement | null {
  const options = ctx.state.settlements.filter(
    (o) =>
      o.id !== s.id &&
      o.status === "active" &&
      !s.roadLinks.includes(o.id) &&
      (o.tribeId === s.tribeId || friendly.has(o.tribeId)) &&
      distance(o.x, o.y, s.x, s.y) <= 10,
  );
  if (options.length === 0) return null;
  return options.reduce((best, o) =>
    distance(o.x, o.y, s.x, s.y) < distance(best.x, best.y, s.x, s.y) ? o : best,
  );
}

function chooseProject(
  ctx: SimContext,
  community: Community,
  friendly: Set<string>,
): { type: BuildingType; targetId: string | null } | null {
  const s = community.settlement;
  if (!s) return null;
  const pop = community.members.length;
  const adults = community.members.filter((p) => p.age >= AGE.adult).length;
  const housing = s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut;
  const tribe = community.tribe;
  if (pop + 3 > housing) return { type: "hut", targetId: null };
  if (
    tribe.techs.includes("agriculture") &&
    s.buildings.farm * ECONOMY.farmersPerField < adults * 0.5 &&
    bestFieldCell(ctx, s)
  ) {
    return { type: "farm", targetId: null };
  }
  if (pop >= 30 && s.buildings.storehouse < (s.level >= 3 ? 2 : 1))
    return { type: "storehouse", targetId: null };
  if (community.threat > 0.35 && s.buildings.palisade < (s.level >= 4 ? 2 : 1))
    return { type: "palisade", targetId: null };
  if (s.level >= 2) {
    const target = roadTarget(ctx, s, friendly);
    if (target) return { type: "road", targetId: target.id };
  }
  if (pop + 10 > housing) return { type: "hut", targetId: null };
  return null;
}

/** Step 11: settlements pick a project by priority, pay materials up front and accumulate builders' work. */
export function progressConstruction(
  ctx: SimContext,
  community: Community,
  effects: TechEffects,
  friendly: Set<string>,
) {
  const s = community.settlement;
  if (!s) return;
  if (!s.construction) {
    const project = chooseProject(ctx, community, friendly);
    if (!project) return;
    const def = BUILDINGS[project.type];
    if (def.requiresTech && !community.tribe.techs.includes(def.requiresTech)) return;
    if (s.stock.wood < def.wood || s.stock.stone < def.stone) return;
    s.stock.wood -= def.wood;
    s.stock.stone -= def.stone;
    s.construction = { type: project.type, progress: 0, required: def.work, targetId: project.targetId };
  }
  const work = community.members
    .filter((p) => p.alive && p.action === "build")
    .reduce((acc, p) => acc + 0.6 + p.skills.building, 0);
  const project = s.construction;
  project.progress = Math.round((project.progress + work * effects.buildMultiplier) * 100) / 100;
  if (project.progress < project.required) return;
  completeProject(ctx, community, s);
}

function completeProject(ctx: SimContext, community: Community, s: Settlement) {
  const project = s.construction;
  if (!project) return;
  s.construction = null;
  const label = BUILDINGS[project.type].label;
  let importance: 1 | 2 | 3 = 1;
  let detail = "";
  if (project.type === "farm") {
    const cell = bestFieldCell(ctx, s);
    if (!cell) return;
    cell.fields += 1;
    importance = s.buildings.farm === 0 ? 3 : 1;
    if (s.buildings.farm > 0 && (s.buildings.farm + 1) % 5 !== 0) {
      s.buildings.farm += 1;
      return;
    }
    detail = " Nuove terre sono state dissodate per la coltivazione.";
  } else if (project.type === "road") {
    const target = project.targetId ? ctx.settlements.get(project.targetId) : undefined;
    if (!target || target.status !== "active") return;
    for (const c of lineCells(ctx.state, s.x, s.y, target.x, target.y))
      if (c.biome !== "ocean") c.road = true;
    s.roadLinks.push(target.id);
    target.roadLinks.push(s.id);
    importance = 2;
    detail = ` La strada collega ${s.name} a ${target.name}.`;
  } else if (project.type === "storehouse") {
    importance = 2;
    detail = " Le riserve di cibo potranno durare più a lungo.";
  } else if (project.type === "palisade") {
    importance = 3;
    detail = " Il villaggio è ora protetto da una cinta di pali.";
  }
  s.buildings[project.type] += 1;
  if (importance === 1 && project.type === "hut" && s.buildings.hut % 5 !== 0) return;
  emitEvent(ctx, {
    type: "construction",
    importance,
    actors: [actor.settlement(s), actor.tribe(community.tribe)],
    x: s.x,
    y: s.y,
    title: `${s.name}: ${label}`,
    description: `A ${s.name} è stata completata la costruzione: ${label}.${detail}`,
    metadata: { building: project.type, count: s.buildings[project.type], settlementId: s.id },
  });
}

/** Overcrowded, well-fed settlements send colonists to found daughter villages nearby. */
export function trySpawnDaughter(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s || community.foodRatio < 1 || !community.tribe.techs.includes("agriculture")) return;
  const pop = community.members.length;
  const housing = s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut;
  if (pop < 60 || (pop < housing * 1.05 && pop < 140) || !ctx.rng.chance(0.15)) return;
  const candidates = cellsInRadius(ctx.state, s.x, s.y, 7).filter(
    (c) =>
      distance(c.x, c.y, s.x, s.y) >= 3 &&
      c.biome !== "ocean" &&
      c.biome !== "mountain" &&
      c.habitability >= 0.5 &&
      (c.ownerTribeId === null || c.ownerTribeId === s.tribeId) &&
      !nearbySettlement(ctx, c.x, c.y, 3),
  );
  if (candidates.length === 0) return;
  const site = candidates.reduce((best, c) => {
    const score = (cell: Cell) =>
      cell.habitability + areaQuality(workArea(ctx.state, cell.x, cell.y, 1)) * 0.5;
    return score(c) > score(best) ? c : best;
  });
  const colony = createSettlement(ctx, community.tribe, site.x, site.y);
  const target = Math.floor(pop * 0.35);
  const moving = new Set<string>();
  for (const p of community.members) {
    if (moving.size >= target) break;
    if (!p.alive || moving.has(p.id) || !p.householdId) continue;
    for (const m of community.members) if (m.alive && m.householdId === p.householdId) moving.add(m.id);
  }
  for (const p of community.members) {
    if (!moving.has(p.id)) continue;
    p.settlementId = colony.id;
    p.x = site.x;
    p.y = site.y;
  }
  colony.population = moving.size;
  for (const key of ["food", "wood", "stone"] as const) {
    const share = s.stock[key] * 0.3;
    s.stock[key] -= share;
    colony.stock[key] += share;
  }
  emitEvent(ctx, {
    type: "settlement_founded",
    importance: 3,
    actors: [actor.settlement(colony), actor.settlement(s), actor.tribe(community.tribe)],
    x: site.x,
    y: site.y,
    title: `${colony.name} fondata da coloni di ${s.name}`,
    description: `${pluralPeople(moving.size)} hanno lasciato ${s.name}, ormai sovraffollata, fondando ${colony.name} presso ${describePlace(ctx.state, site.x, site.y)}.`,
    metadata: { settlementId: colony.id, parentSettlementId: s.id, population: moving.size },
  });
}

/** A settlement that starves for years or empties out is abandoned; survivors move or go nomadic. */
export function checkCollapse(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s || s.status !== "active") return;
  const alive = community.members.filter((p) => p.alive);
  if (s.famineYears < COLLAPSE_FAMINE_YEARS && alive.length >= 6) return;
  const tribe = community.tribe;
  s.status = "abandoned";
  s.abandonedYear = ctx.state.year;
  s.construction = null;
  for (const c of ctx.state.cells) {
    if (c.settlementId === s.id) {
      c.settlementId = null;
      c.fields = 0;
    }
  }
  const refuge = ctx.state.settlements
    .filter((o) => o.status === "active" && o.tribeId === tribe.id && o.id !== s.id)
    .sort((a, b) => distance(a.x, a.y, s.x, s.y) - distance(b.x, b.y, s.x, s.y))[0];
  for (const p of alive) {
    p.settlementId = refuge ? refuge.id : null;
    p.x = refuge ? refuge.x : s.x;
    p.y = refuge ? refuge.y : s.y;
  }
  if (refuge) {
    refuge.stock.food += s.stock.food;
  } else {
    tribe.status = "nomadic";
    tribe.x = s.x;
    tribe.y = s.y;
    tribe.yearsAtLocation = 0;
    tribe.stock.food += s.stock.food;
  }
  s.stock = emptyStock();
  const reason =
    s.famineYears >= COLLAPSE_FAMINE_YEARS ? `dopo ${s.famineYears} anni di carestia` : "per lo spopolamento";
  emitEvent(ctx, {
    type: "settlement_collapse",
    importance: 4,
    actors: [actor.settlement(s), actor.tribe(tribe)],
    x: s.x,
    y: s.y,
    title: `${s.name} viene abbandonata`,
    description: `L'insediamento di ${s.name} è stato abbandonato ${reason}. ${
      alive.length === 0
        ? "Non ci sono sopravvissuti."
        : `${pluralPeople(alive.length)} ${refuge ? `si sono rifugiate a ${refuge.name}` : "sono tornate alla vita nomade"}.`
    }`,
    metadata: { settlementId: s.id, survivors: alive.length, refugeId: refuge?.id ?? null },
  });
}

/** Territory: active settlements claim cells around them (bigger first); bands claim their camp. */
export function updateTerritory(ctx: SimContext) {
  const { state } = ctx;
  for (const c of state.cells) c.ownerTribeId = null;
  const active = state.settlements
    .filter((s) => s.status === "active")
    .sort((a, b) => b.level - a.level || a.seq - b.seq);
  for (const c of state.cells)
    if (c.settlementId && !active.some((s) => s.id === c.settlementId)) c.settlementId = null;
  for (const s of active) {
    for (const c of cellsInRadius(state, s.x, s.y, s.territoryRadius)) {
      if (c.biome === "ocean") continue;
      if (c.settlementId && c.settlementId !== s.id) continue;
      c.settlementId = s.id;
      c.ownerTribeId = s.tribeId;
    }
  }
  for (const t of state.tribes) {
    if (t.status !== "nomadic") continue;
    const c = cellAt(state, t.x, t.y);
    if (c.ownerTribeId === null) c.ownerTribeId = t.id;
  }
}

export function checkCivilization(ctx: SimContext, tribe: Tribe, population: number) {
  if (tribe.civilizationId || tribe.status === "extinct") return;
  const own = ctx.state.settlements.filter((s) => s.status === "active" && s.tribeId === tribe.id);
  if (own.length < 2 || population < 100) return;
  const capital = own.reduce((best, s) => (s.population > best.population ? s : best));
  const { id, seq } = nextId(ctx.state, "civilization", "c");
  const civ = {
    id,
    seq,
    name: civilizationName(ctx.rng, tribe.name),
    color: tribe.color,
    founderTribeId: tribe.id,
    capitalSettlementId: capital.id,
    foundedYear: ctx.state.year,
    status: "active" as const,
  };
  ctx.state.civilizations.push(civ);
  tribe.civilizationId = id;
  for (const s of own) s.civilizationId = id;
  emitEvent(ctx, {
    type: "civilization_founded",
    importance: 5,
    actors: [actor.civilization(civ), actor.tribe(tribe), actor.settlement(capital)],
    x: capital.x,
    y: capital.y,
    title: `Nasce una civiltà: ${civ.name}`,
    description: `Con ${own.length} insediamenti e ${population} abitanti, la tribù ${tribe.name} si è data un'organizzazione comune: nasce la civiltà «${civ.name}», con capitale ${capital.name}.`,
    metadata: { civilizationId: id, settlements: own.length, population },
  });
}

/**
 * Distant colonies may break away (much less likely once writing enables administration)
 * and become independent tribes, keeping the political map from freezing.
 */
export function trySecession(ctx: SimContext, community: Community): Tribe | null {
  const s = community.settlement;
  const parent = community.tribe;
  if (!s || community.members.length < 40) return null;
  const own = ctx.state.settlements.filter((o) => o.status === "active" && o.tribeId === parent.id);
  if (own.length < 3) return null;
  const capital = own.reduce((best, o) => (o.population > best.population ? o : best));
  const chance = parent.techs.includes("writing") ? 0.004 : 0.015;
  if (capital.id === s.id || distance(capital.x, capital.y, s.x, s.y) < 8 || !ctx.rng.chance(chance))
    return null;

  const { id, seq } = nextId(ctx.state, "tribe", "t");
  const used = new Set(ctx.state.tribes.map((t) => t.name));
  let name = tribeName(ctx.rng);
  while (used.has(name)) name = tribeName(ctx.rng);
  const tribe: Tribe = {
    ...parent,
    id,
    seq,
    name,
    color: TRIBE_COLORS[(seq - 1) % TRIBE_COLORS.length] ?? "#ffffff",
    status: "settled",
    x: s.x,
    y: s.y,
    stock: emptyStock(),
    techs: [...parent.techs],
    techProgress: { ...parent.techProgress },
    foundedYear: ctx.state.year,
    extinctYear: null,
    civilizationId: null,
    leaderId: null,
    parentTribeId: parent.id,
    populationMilestone: 0,
    yearsAtLocation: 0,
    scarcityYears: 0,
  };
  ctx.state.tribes.push(tribe);
  ctx.tribes.set(id, tribe);
  s.tribeId = id;
  s.civilizationId = null;
  s.roadLinks = s.roadLinks.filter((l) => ctx.settlements.get(l)?.tribeId !== parent.id);
  for (const p of community.members) p.tribeId = id;
  for (const h of ctx.state.households) {
    const partner = ctx.people.get(h.partnerIds[0]);
    if (partner?.settlementId === s.id) h.tribeId = id;
  }
  ctx.state.relationships.push({
    id: parent.seq < seq ? `${parent.id}|${id}` : `${id}|${parent.id}`,
    aId: parent.seq < seq ? parent.id : id,
    bId: parent.seq < seq ? id : parent.id,
    trust: 0.1,
    hostility: 0.3,
    tradeVolume: 0,
    conflictMemory: 0.1,
    atWar: false,
    warStartYear: null,
    allied: false,
    distance: distance(capital.x, capital.y, s.x, s.y),
    lastInteractionYear: ctx.state.year,
    battles: 0,
    truceUntilYear: null,
  });
  emitEvent(ctx, {
    type: "conflict",
    importance: 4,
    actors: [actor.tribe(tribe), actor.tribe(parent), actor.settlement(s)],
    x: s.x,
    y: s.y,
    title: `${s.name} si separa dai ${parent.name}`,
    description: `Lontana dalla capitale ${capital.name}, ${s.name} ha smesso di riconoscere l'autorità dei ${parent.name}: i suoi ${community.members.length} abitanti formano ora la tribù ${tribe.name}.`,
    metadata: { secession: true, settlementId: s.id, parentTribeId: parent.id },
  });
  return tribe;
}
