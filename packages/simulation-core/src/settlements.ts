import { AGE, BUILDINGS, ECONOMY, HOUSING, SETTLEMENT_TIER_LABELS, TRIBE_COLORS } from "./constants";
import { initialStability } from "./culture";
import type { Community, SimContext } from "./context";
import { emptyStock, nextId } from "./context";
import { actor, describePlace, emitEvent, pluralPeople } from "./events";
import { cellAt, cellsInRadius, clamp, distance, lineCells, round } from "./grid";
import { civilizationName, settlementName, tribeName } from "./names";
import { areaQuality, workArea } from "./resources";
import {
  addResource,
  bundleEntries,
  consumeResource,
  getResourceAmount,
  hasRequiredResources,
  type ResourceBundle,
} from "./stock";
import type { TechEffects } from "./technology";
import type { BuildingType, Cell, ConstructionProject, Settlement, SettlementTier, Tribe } from "./types";

/** Years a band must stay in the same place before settling down. */
export const SETTLE_AFTER_YEARS = 8;
/** Consecutive famine years after which a settlement is abandoned (default, see config). */
export const COLLAPSE_FAMINE_YEARS = 3;

function emptyBuildings(): Record<BuildingType, number> {
  const out = {} as Record<BuildingType, number>;
  for (const type of Object.keys(BUILDINGS) as BuildingType[]) out[type] = 0;
  return out;
}

export function createSettlement(
  ctx: SimContext,
  tribe: Tribe,
  x: number,
  y: number,
  founderId: string | null = null,
): Settlement {
  const { id, seq } = nextId(ctx.state, "settlement", "s");
  const used = new Set(ctx.state.settlements.map((s) => s.name));
  let name = settlementName(ctx.rng);
  while (used.has(name)) name = settlementName(ctx.rng);
  const buildings = emptyBuildings();
  buildings.camp = 1;
  const settlement: Settlement = {
    id,
    seq,
    name,
    tribeId: tribe.id,
    civilizationId: tribe.civilizationId,
    x,
    y,
    level: 1,
    tier: "camp",
    status: "active",
    foundedYear: ctx.state.year,
    abandonedYear: null,
    stock: emptyStock(),
    buildings,
    construction: null,
    defense: 1,
    territoryRadius: 2,
    famineYears: 0,
    roadLinks: [],
    lastProduction: emptyStock(),
    lastFoodRatio: 1,
    population: 0,
    hygiene: 0.8,
    unrest: 0.05,
    influence: 1,
    founderId,
    lastEpidemicYear: null,
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
  const founder = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const settlement = createSettlement(ctx, tribe, community.x, community.y, founder?.id ?? null);
  settlement.stock = { ...tribe.stock, goods: { ...tribe.stock.goods } };
  tribe.stock = emptyStock();
  tribe.status = "settled";
  for (const p of community.members) p.settlementId = settlement.id;
  settlement.population = community.members.length;
  if (founder?.alive) {
    founder.title = founder.title ?? "founder";
    founder.prestige = round(clamp(founder.prestige + 0.1));
  }
  emitEvent(ctx, {
    type: "settlement_founded",
    subtype: first ? "first" : "band",
    importance: first ? 4 : 3,
    actors: [actor.tribe(tribe), actor.settlement(settlement)],
    x: settlement.x,
    y: settlement.y,
    title: `Fondazione di ${settlement.name}`,
    description: `Dopo ${tribe.yearsAtLocation} anni presso ${describePlace(ctx.state, settlement.x, settlement.y)}, ${pluralPeople(community.members.length)} della tribù ${tribe.name} hanno fondato ${first ? "il primo accampamento stabile" : "un nuovo accampamento"}: ${settlement.name}.`,
    metadata: {
      settlementId: settlement.id,
      population: community.members.length,
      first,
      founderId: founder?.id ?? null,
      habitability: cellAt(ctx.state, settlement.x, settlement.y).habitability,
      yearsAtLocation: tribe.yearsAtLocation,
    },
  });
  return settlement;
}

export interface TierRequirement {
  tier: SettlementTier;
  level: number;
  population: number;
  /** Consecutive good-harvest years required. */
  foodStability: boolean;
  test: (s: Settlement, population: number, tribe: Tribe) => boolean;
  describe: string;
}

/**
 * Settlement tiers are earned, never granted by the calendar: population, food security,
 * storage, permanence, technology, infrastructure and safety all have to line up.
 */
export const TIER_REQUIREMENTS: TierRequirement[] = [
  {
    tier: "capital",
    level: 5,
    population: 300,
    foodStability: true,
    test: (s, pop, t) =>
      pop >= 300 &&
      s.buildings.storehouse >= 2 &&
      (s.buildings.temple >= 1 || s.buildings.market >= 1) &&
      t.techs.includes("writing") &&
      s.famineYears === 0,
    describe: "300 abitanti, 2 magazzini, un tempio o un mercato, scrittura",
  },
  {
    tier: "city_state",
    level: 4,
    population: 150,
    foodStability: true,
    test: (s, pop, t) =>
      pop >= 150 &&
      (s.buildings.road >= 1 || s.buildings.port >= 1) &&
      (s.buildings.palisade >= 1 || s.buildings.walls >= 1) &&
      t.techs.includes("writing"),
    describe: "150 abitanti, una via di collegamento, difese, scrittura",
  },
  {
    tier: "town",
    level: 3,
    population: 80,
    foodStability: true,
    test: (s, pop) => pop >= 80 && s.buildings.storehouse >= 1 && s.buildings.farm + s.buildings.pasture >= 2,
    describe: "80 abitanti, un magazzino, due campi o pascoli",
  },
  {
    tier: "village",
    level: 2,
    population: 40,
    foodStability: false,
    test: (s, pop) => pop >= 40 && s.buildings.hut >= 3,
    describe: "40 abitanti e tre gruppi di capanne",
  },
];

export function computeLevel(s: Settlement, population: number, tribe: Tribe): number {
  for (const req of TIER_REQUIREMENTS) {
    if (req.foodStability && (s.famineYears > 0 || s.lastFoodRatio < 0.9)) continue;
    if (req.test(s, population, tribe)) return req.level;
  }
  return 1;
}

export function tierOf(level: number): SettlementTier {
  return (TIER_REQUIREMENTS.find((r) => r.level === level)?.tier ?? "camp") as SettlementTier;
}

export function updateSettlementStats(
  ctx: SimContext,
  s: Settlement,
  population: number,
  tribe: Tribe,
  effects: TechEffects,
) {
  s.population = population;
  const previousLevel = s.level;
  s.level = computeLevel(s, population, tribe);
  s.tier = tierOf(s.level);
  s.territoryRadius = Math.min(5, 1 + s.level);
  const cell = cellAt(ctx.state, s.x, s.y);
  const terrain = cell.biome === "hills" ? 1.2 : cell.biome === "mountain" ? 1.4 : cell.river ? 1.1 : 1;
  const roads = s.roadLinks.length > 0 ? 1.1 : 1;
  const fortification = 1 + s.buildings.palisade * 0.5 + s.buildings.walls * 1.5 + s.buildings.barracks * 0.3;
  s.defense = round(fortification * effects.defenseMultiplier * terrain * roads, 2);
  // Political weight: the reach a settlement has over the land around it.
  s.influence = round(
    1 +
      s.level * 0.8 +
      Math.min(4, population / 60) +
      s.roadLinks.length * 0.3 +
      s.buildings.temple * 0.4 +
      s.buildings.market * 0.4 +
      (tribe.civilizationId &&
      ctx.state.civilizations.find((c) => c.id === tribe.civilizationId)?.capitalSettlementId === s.id
        ? 1.5
        : 0),
    2,
  );
  if (s.level > previousLevel) {
    const req = TIER_REQUIREMENTS.find((r) => r.level === s.level);
    emitEvent(ctx, {
      type: "settlement_growth",
      subtype: s.tier,
      importance: s.level >= 4 ? 4 : 3,
      actors: [actor.settlement(s), actor.tribe(tribe)],
      x: s.x,
      y: s.y,
      title: `${s.name} diventa ${SETTLEMENT_TIER_LABELS[s.tier]}`,
      description: `${s.name} ha raggiunto le condizioni per crescere: ${req?.describe ?? ""}. Ora conta ${population} abitanti.`,
      metadata: {
        settlementId: s.id,
        level: s.level,
        tier: s.tier,
        population,
        buildings: Object.entries(s.buildings)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}:${n}`)
          .join(","),
      },
    });
  }
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

function bestPastureCell(ctx: SimContext, s: Settlement): Cell | null {
  const candidates = workArea(ctx.state, s.x, s.y, s.territoryRadius).filter(
    (c) =>
      c.settlementId === s.id &&
      (c.biome === "plains" || c.biome === "hills" || c.biome === "coast") &&
      c.pastures < ECONOMY.maxPasturesPerCell &&
      c.fields === 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.fauna > best.fauna ? c : best));
}

function bestMineCell(ctx: SimContext, s: Settlement): Cell | null {
  const candidates = workArea(ctx.state, s.x, s.y, s.territoryRadius).filter(
    (c) => c.settlementId === s.id && c.copper + c.tin + c.iron + c.coal > 10,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    c.copper + c.tin + c.iron + c.coal > best.copper + best.tin + best.iron + best.coal ? c : best,
  );
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

interface ProjectChoice {
  type: BuildingType;
  targetId: string | null;
  cell: Cell | null;
}

/**
 * Construction priorities: shelter first, then food, then storage, then safety, then the
 * works that only make sense once the settlement is big enough.
 */
function chooseProject(ctx: SimContext, community: Community, friendly: Set<string>): ProjectChoice | null {
  const s = community.settlement;
  if (!s) return null;
  const pop = community.members.length;
  const adults = community.members.filter((p) => p.age >= AGE.adult).length;
  const housing = s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut;
  const tribe = community.tribe;
  const techs = tribe.techs;
  const here = cellAt(ctx.state, s.x, s.y);

  const allowed = (type: BuildingType) => {
    const def = BUILDINGS[type];
    if (def.requiresTech && !techs.includes(def.requiresTech)) return false;
    return s.level >= def.minLevel;
  };

  if (pop + 3 > housing) return { type: "hut", targetId: null, cell: null };
  if (allowed("farm") && s.buildings.farm * ECONOMY.farmersPerField < adults * 0.5) {
    const cell = bestFieldCell(ctx, s);
    if (cell) return { type: "farm", targetId: null, cell };
  }
  if (allowed("pasture") && s.buildings.pasture * ECONOMY.herdersPerPasture < adults * 0.25) {
    const cell = bestPastureCell(ctx, s);
    if (cell) return { type: "pasture", targetId: null, cell };
  }
  if (pop >= 30 && s.buildings.storehouse < (s.level >= 3 ? 2 : 1))
    return { type: "storehouse", targetId: null, cell: null };
  if (allowed("well") && s.hygiene < 0.7 && s.buildings.well < 1)
    return { type: "well", targetId: null, cell: null };
  if (community.threat > 0.35 && s.buildings.palisade < 1)
    return { type: "palisade", targetId: null, cell: null };
  if (allowed("walls") && community.threat > 0.4 && s.buildings.walls < 1)
    return { type: "walls", targetId: null, cell: null };
  if (allowed("kiln") && s.buildings.kiln < 1) return { type: "kiln", targetId: null, cell: null };
  if (allowed("mine") && s.buildings.mine < 2) {
    const cell = bestMineCell(ctx, s);
    if (cell) return { type: "mine", targetId: null, cell };
  }
  if (allowed("quarry") && s.buildings.quarry < 1 && here.stone > 40)
    return { type: "quarry", targetId: null, cell: null };
  if (allowed("foundry") && s.buildings.foundry < 1) return { type: "foundry", targetId: null, cell: null };
  if (allowed("port") && (here.coastal || here.river) && s.buildings.port < 1)
    return { type: "port", targetId: null, cell: null };
  if (s.level >= 2) {
    const target = roadTarget(ctx, s, friendly);
    if (target) return { type: "road", targetId: target.id, cell: null };
  }
  if (allowed("temple") && s.buildings.temple < 1 && tribe.culture.spirituality >= 50)
    return { type: "temple", targetId: null, cell: null };
  if (allowed("barracks") && s.buildings.barracks < 1 && tribe.culture.militarism >= 50)
    return { type: "barracks", targetId: null, cell: null };
  if (allowed("market") && s.buildings.market < 1 && tribe.culture.tradeOpenness >= 50)
    return { type: "market", targetId: null, cell: null };
  if (pop + 10 > housing) return { type: "hut", targetId: null, cell: null };
  return null;
}

function scaleCost(cost: ResourceBundle, effects: TechEffects): ResourceBundle {
  const scaled: ResourceBundle = {};
  for (const [kind, amount] of bundleEntries(cost)) {
    scaled[kind] = round(amount / Math.max(0.6, effects.buildMultiplier * 0.5 + 0.5), 2);
  }
  return scaled;
}

/**
 * Step 12: settlements pick a project, deliver materials year after year and accumulate the
 * builders' work. Nothing appears instantly: an unfinished site simply waits.
 */
export function progressConstruction(
  ctx: SimContext,
  community: Community,
  effects: TechEffects,
  friendly: Set<string>,
) {
  const s = community.settlement;
  if (!s) return;
  if (!s.construction) {
    const choice = chooseProject(ctx, community, friendly);
    if (!choice) return;
    const def = BUILDINGS[choice.type];
    const { id, seq } = nextId(ctx.state, "construction", "cp");
    void seq;
    s.construction = {
      id,
      settlementId: s.id,
      buildingType: choice.type,
      cellId: choice.cell ? `${choice.cell.x},${choice.cell.y}` : `${s.x},${s.y}`,
      requiredResources: scaleCost(def.cost, effects),
      deliveredResources: {},
      laborRequired: round(def.work, 2),
      laborCompleted: 0,
      startedAtTick: ctx.state.tick,
      status: "planned",
      targetId: choice.targetId,
    };
  }

  const project = s.construction;
  deliverMaterials(s, project);
  const missing = !materialsComplete(project);
  const work = community.members
    .filter((p) => p.alive && p.action === "build")
    .reduce((acc, p) => acc + 0.6 + p.skills.building, 0);
  if (missing) {
    // Materials are still being gathered: the site is paused, the work does not start.
    project.status = work > 0 ? "planned" : "paused";
    return;
  }
  project.status = "building";
  project.laborCompleted = round(project.laborCompleted + work * effects.buildMultiplier, 2);
  if (project.laborCompleted < project.laborRequired) return;
  completeProject(ctx, community, s);
}

/** Moves available materials from the settlement stock into the site, a bit every year. */
function deliverMaterials(s: Settlement, project: ConstructionProject) {
  for (const [kind, required] of bundleEntries(project.requiredResources)) {
    const delivered = project.deliveredResources[kind] ?? 0;
    const missing = required - delivered;
    if (missing <= 0) continue;
    const taken = consumeResource(s.stock, kind, missing);
    if (taken > 0) project.deliveredResources[kind] = round(delivered + taken, 2);
  }
}

function materialsComplete(project: ConstructionProject): boolean {
  for (const [kind, required] of bundleEntries(project.requiredResources)) {
    if ((project.deliveredResources[kind] ?? 0) + 1e-6 < required) return false;
  }
  return true;
}

function cellFromId(ctx: SimContext, cellId: string): Cell | null {
  const [x, y] = cellId.split(",").map(Number);
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return null;
  if (x < 0 || y < 0 || x >= ctx.state.width || y >= ctx.state.height) return null;
  return cellAt(ctx.state, x, y);
}

function completeProject(ctx: SimContext, community: Community, s: Settlement) {
  const project = s.construction;
  if (!project) return;
  s.construction = null;
  project.status = "completed";
  const type = project.buildingType;
  const def = BUILDINGS[type];
  let importance: 1 | 2 | 3 | 4 = 1;
  let detail = "";

  if (type === "farm") {
    const cell = cellFromId(ctx, project.cellId) ?? bestFieldCell(ctx, s);
    if (!cell || cell.fields >= ECONOMY.maxFieldsPerCell) return;
    cell.fields += 1;
    importance = s.buildings.farm === 0 ? 3 : 1;
    if (s.buildings.farm > 0 && (s.buildings.farm + 1) % 5 !== 0) {
      s.buildings.farm += 1;
      return;
    }
    detail = " Nuove terre sono state dissodate per la coltivazione.";
  } else if (type === "pasture") {
    const cell = cellFromId(ctx, project.cellId) ?? bestPastureCell(ctx, s);
    if (!cell || cell.pastures >= ECONOMY.maxPasturesPerCell) return;
    cell.pastures += 1;
    importance = s.buildings.pasture === 0 ? 3 : 1;
    detail = " Il bestiame darà cibo e pelli anche nei mesi freddi.";
  } else if (type === "road") {
    const target = project.targetId ? ctx.settlements.get(project.targetId) : undefined;
    if (!target || target.status !== "active") return;
    for (const c of lineCells(ctx.state, s.x, s.y, target.x, target.y))
      if (c.biome !== "ocean") c.road = true;
    s.roadLinks.push(target.id);
    target.roadLinks.push(s.id);
    importance = 2;
    detail = ` La strada collega ${s.name} a ${target.name}.`;
  } else if (type === "storehouse") {
    importance = 2;
    detail = " Le riserve di cibo potranno durare più a lungo.";
  } else if (type === "palisade" || type === "walls") {
    importance = type === "walls" ? 4 : 3;
    detail =
      type === "walls"
        ? " La città è ora cinta di mura in pietra."
        : " Il villaggio è protetto da una cinta di pali.";
  } else if (type === "well") {
    s.hygiene = clamp(s.hygiene + 0.15);
    importance = 2;
    detail = " L'acqua pulita renderà il villaggio più salubre.";
  } else if (type === "temple") {
    community.tribe.stability.legitimacy = clamp(community.tribe.stability.legitimacy + 0.05);
    community.tribe.stability.cohesion = clamp(community.tribe.stability.cohesion + 0.05);
    importance = 3;
    detail = " Il recinto sacro dà al gruppo un centro comune.";
  } else if (type === "market") {
    importance = 3;
    detail = " Gli scambi avranno finalmente un luogo e delle regole.";
  } else if (type === "foundry") {
    importance = 3;
    detail = " Il metallo fuso diventerà strumenti e armi.";
  } else if (
    type === "mine" ||
    type === "quarry" ||
    type === "kiln" ||
    type === "barracks" ||
    type === "port"
  ) {
    importance = 2;
  }

  s.buildings[type] += 1;
  if (importance === 1 && type === "hut" && s.buildings.hut % 5 !== 0) return;
  emitEvent(ctx, {
    type: "construction",
    subtype: type,
    importance,
    actors: [actor.settlement(s), actor.tribe(community.tribe)],
    x: s.x,
    y: s.y,
    title: `${s.name}: ${def.label}`,
    description: `A ${s.name} è stata completata la costruzione: ${def.label}.${detail}`,
    metadata: {
      building: type,
      count: s.buildings[type],
      settlementId: s.id,
      years: ctx.state.tick - project.startedAtTick,
      effect: def.effectSummary,
    },
  });
}

/** Yearly upkeep of the infrastructure; buildings nobody can maintain fall into disrepair. */
export function payUpkeep(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s) return;
  for (const [type, count] of Object.entries(s.buildings) as [BuildingType, number][]) {
    if (count <= 0) continue;
    const upkeep = BUILDINGS[type].upkeep;
    if (bundleEntries(upkeep).length === 0) continue;
    const total: ResourceBundle = {};
    for (const [kind, amount] of bundleEntries(upkeep)) total[kind] = amount * count;
    if (hasRequiredResources(s.stock, total)) {
      for (const [kind, amount] of bundleEntries(total)) consumeResource(s.stock, kind, amount);
    } else if (ctx.rng.chance(0.08)) {
      s.buildings[type] = Math.max(0, count - 1);
    }
  }
}

/** Overcrowded, well-fed settlements send colonists to found daughter villages nearby. */
export function trySpawnDaughter(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s || community.foodRatio < 1 || !community.tribe.techs.includes("agriculture")) return;
  const pop = community.members.length;
  const housing = s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut;
  const drive = 0.1 + (community.tribe.culture.expansionism / 100) * 0.15;
  if (pop < 60 || (pop < housing * 1.05 && pop < 140) || !ctx.rng.chance(drive)) return;
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
    s.stock[key] = round(s.stock[key] - share, 2);
    colony.stock[key] = round(colony.stock[key] + share, 2);
  }
  emitEvent(ctx, {
    type: "settlement_founded",
    subtype: "colony",
    importance: 3,
    actors: [actor.settlement(colony), actor.settlement(s), actor.tribe(community.tribe)],
    x: site.x,
    y: site.y,
    title: `${colony.name} fondata da coloni di ${s.name}`,
    description: `${pluralPeople(moving.size)} hanno lasciato ${s.name}, ormai sovraffollata, fondando ${colony.name} presso ${describePlace(ctx.state, site.x, site.y)}.`,
    metadata: {
      settlementId: colony.id,
      parentSettlementId: s.id,
      population: moving.size,
      cause: "sovraffollamento",
      expansionism: community.tribe.culture.expansionism,
    },
  });
}

/** A settlement that starves for years or empties out is abandoned; survivors move or go nomadic. */
export function checkCollapse(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s || s.status !== "active") return;
  const limit = ctx.state.config.crisis.collapseFamineYears;
  const alive = community.members.filter((p) => p.alive);
  if (s.famineYears < limit && alive.length >= 6) return;
  const tribe = community.tribe;
  s.status = "abandoned";
  s.abandonedYear = ctx.state.year;
  s.construction = null;
  s.population = 0;
  for (const c of ctx.state.cells) {
    if (c.settlementId === s.id) {
      c.settlementId = null;
      c.fields = 0;
      c.pastures = 0;
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
    addResource(refuge.stock, "food", getResourceAmount(s.stock, "food"));
  } else {
    tribe.status = "nomadic";
    tribe.x = s.x;
    tribe.y = s.y;
    tribe.yearsAtLocation = 0;
    addResource(tribe.stock, "food", getResourceAmount(s.stock, "food"));
  }
  s.stock = emptyStock();
  const epidemic = ctx.state.crises.some((c) => c.kind === "epidemic" && c.targetId === s.id);
  const reason =
    s.famineYears >= limit
      ? `dopo ${s.famineYears} anni di carestia`
      : epidemic
        ? "dopo l'epidemia"
        : "per lo spopolamento";
  emitEvent(ctx, {
    type: "settlement_collapse",
    subtype: s.famineYears >= limit ? "famine" : "depopulation",
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
    metadata: {
      settlementId: s.id,
      survivors: alive.length,
      refugeId: refuge?.id ?? null,
      famineYears: s.famineYears,
      epidemic,
      buildingsLost: Object.values(s.buildings).reduce((a, b) => a + b, 0),
    },
    causeEventIds: ctx.state.crises
      .filter((c) => c.targetId === s.id && c.eventId)
      .map((c) => c.eventId as string),
  });
}

/**
 * Territory: settlements project influence on the land around them. Where two settlements
 * reach the same cell, the stronger influence wins, so borders shift as cities grow.
 */
export function updateTerritory(ctx: SimContext) {
  const { state } = ctx;
  for (const c of state.cells) c.ownerTribeId = null;
  const active = state.settlements.filter((s) => s.status === "active");
  const claims = new Map<number, { influence: number; settlement: Settlement }>();
  for (const c of state.cells) {
    if (c.settlementId && !active.some((s) => s.id === c.settlementId)) {
      c.settlementId = null;
      c.fields = 0;
      c.pastures = 0;
    }
  }
  for (const s of active) {
    for (const c of cellsInRadius(state, s.x, s.y, s.territoryRadius)) {
      if (c.biome === "ocean") continue;
      const d = distance(c.x, c.y, s.x, s.y);
      // Influence decays with distance and is carried further by roads.
      const reach = s.influence * (1 - d / (s.territoryRadius + 1.5)) * (c.road ? 1.25 : 1);
      if (reach <= 0) continue;
      const index = c.y * state.width + c.x;
      const current = claims.get(index);
      if (
        !current ||
        reach > current.influence ||
        (reach === current.influence && s.seq < current.settlement.seq)
      ) {
        claims.set(index, { influence: reach, settlement: s });
      }
    }
  }
  for (const [index, claim] of claims) {
    const c = state.cells[index];
    if (!c) continue;
    if (c.settlementId && c.settlementId !== claim.settlement.id) {
      // Fields and pastures follow the land they belong to.
      c.fields = 0;
      c.pastures = 0;
    }
    c.settlementId = claim.settlement.id;
    c.ownerTribeId = claim.settlement.tribeId;
  }
  // Land nobody reaches any more goes back to being unclaimed: `settlementId` always means
  // "currently controlled", never "controlled at some point in the past".
  for (let index = 0; index < state.cells.length; index++) {
    const c = state.cells[index];
    if (!c || !c.settlementId || claims.has(index)) continue;
    c.settlementId = null;
    c.fields = 0;
    c.pastures = 0;
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
    subtype: tribe.government,
    importance: 5,
    actors: [actor.civilization(civ), actor.tribe(tribe), actor.settlement(capital)],
    x: capital.x,
    y: capital.y,
    title: `Nasce una civiltà: ${civ.name}`,
    description: `Con ${own.length} insediamenti e ${population} abitanti, la tribù ${tribe.name} si è data un'organizzazione comune: nasce la civiltà «${civ.name}», con capitale ${capital.name}.`,
    metadata: {
      civilizationId: id,
      settlements: own.length,
      population,
      government: tribe.government,
      technologies: tribe.techs.length,
    },
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
  // Writing and laws hold a large polity together; unrest and distance pull it apart.
  const administration = parent.techs.includes("writing") ? 0.004 : 0.015;
  const chance =
    administration *
    (1 + s.unrest * 2 + parent.stability.tension * 1.5) *
    (parent.techs.includes("laws") ? 0.6 : 1);
  if (
    capital.id === s.id ||
    distance(capital.x, capital.y, s.x, s.y) < 8 ||
    !ctx.rng.chance(clamp(chance, 0, 0.2))
  )
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
    techAdoption: { ...parent.techAdoption },
    foundedYear: ctx.state.year,
    extinctYear: null,
    civilizationId: null,
    leaderId: null,
    parentTribeId: parent.id,
    populationMilestone: 0,
    yearsAtLocation: 0,
    scarcityYears: 0,
    culture: { ...parent.culture },
    government: parent.government === "city_state" ? "chiefdom" : parent.government,
    stability: { ...initialStability(), legitimacy: 0.5, tension: 0.2 },
    dynastyId: null,
    lastLeaderChangeYear: null,
  };
  // The new polity drifts culturally from the parent right away.
  tribe.culture.centralization = clamp(tribe.culture.centralization - 10, 5, 95);
  ctx.state.tribes.push(tribe);
  ctx.tribes.set(id, tribe);
  s.tribeId = id;
  s.civilizationId = null;
  s.unrest = 0.05;
  s.roadLinks = s.roadLinks.filter((l) => ctx.settlements.get(l)?.tribeId !== parent.id);
  for (const p of community.members) p.tribeId = id;
  for (const h of ctx.state.households) {
    const partner = ctx.people.get(h.partnerIds[0]);
    if (partner?.settlementId === s.id) h.tribeId = id;
  }
  parent.stability.legitimacy = clamp(parent.stability.legitimacy - 0.1);
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
    respect: 0.2,
    tradeDependency: 0.1,
    culturalDistance: 0.05,
    status: "rival",
    phase: "tension",
    lastConflictYear: null,
    phaseYears: 0,
  });
  emitEvent(ctx, {
    type: "conflict",
    subtype: "secession",
    importance: 4,
    actors: [actor.tribe(tribe), actor.tribe(parent), actor.settlement(s)],
    x: s.x,
    y: s.y,
    title: `${s.name} si separa dai ${parent.name}`,
    description: `Lontana dalla capitale ${capital.name}, ${s.name} ha smesso di riconoscere l'autorità dei ${parent.name}: i suoi ${community.members.length} abitanti formano ora la tribù ${tribe.name}.`,
    metadata: {
      secession: true,
      settlementId: s.id,
      parentTribeId: parent.id,
      distance: distance(capital.x, capital.y, s.x, s.y),
      unrest: s.unrest,
      tension: parent.stability.tension,
    },
  });
  return tribe;
}
