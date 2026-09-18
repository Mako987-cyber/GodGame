import { annualYieldAt, climateAt, winterConsumptionFactor } from "./climate";
import { seasonWeights, type DistributionPolicy } from "./config";
import { AGE, ECONOMY, HOUSING, STORAGE } from "./constants";
import type { Community, SimContext } from "./context";
import { cellAt, clamp, round } from "./grid";
import {
  extractCopper,
  extractNaturalFood,
  extractOre,
  extractStone,
  extractWood,
  workArea,
} from "./resources";
import {
  addResource,
  clampResource,
  consumeResource,
  getResourceAmount,
  roundStock,
  type ResourceKind,
  type Stockpile,
} from "./stock";
import type { TechEffects } from "./technology";
import type { Person } from "./types";

export interface Production {
  food: number;
  wood: number;
  stone: number;
  copper: number;
  /** Legacy split of the food produced. */
  farmed: number;
  foraged: number;
  /** Extended flows. */
  hunted: number;
  fished: number;
  herded: number;
  clay: number;
  tin: number;
  iron: number;
  coal: number;
  hides: number;
  tools: number;
  wealth: number;
}

function emptyProduction(): Production {
  return {
    food: 0,
    wood: 0,
    stone: 0,
    copper: 0,
    farmed: 0,
    foraged: 0,
    hunted: 0,
    fished: 0,
    herded: 0,
    clay: 0,
    tin: 0,
    iron: 0,
    coal: 0,
    hides: 0,
    tools: 0,
    wealth: 0,
  };
}

export function foodNeed(person: Person): number {
  if (person.age < AGE.adult) return ECONOMY.childNeed;
  if (person.age >= AGE.elder) return ECONOMY.elderNeed;
  return ECONOMY.adultNeed;
}

export function storageCapacity(community: Community, effects: TechEffects): number {
  const s = community.settlement;
  if (!s) return (community.members.length * ECONOMY.bandCarryPerPerson + 5) * effects.storageMultiplier;
  return (
    (STORAGE.settlementBase +
      s.buildings.storehouse * STORAGE.storehouse +
      s.buildings.kiln * STORAGE.kiln +
      community.members.length * 0.5) *
    effects.storageMultiplier
  );
}

export function housingCapacity(community: Community): number {
  const s = community.settlement;
  if (!s) return Infinity;
  return s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut;
}

function workFactor(person: Person): number {
  if (person.age < AGE.adult) return 0.5;
  if (person.age >= AGE.elder) return 0.5;
  return 0.6 + person.health * 0.4;
}

/** Bonus every worker gets when the group holds enough tools for the job. */
function toolFactor(stock: Stockpile, workers: number): number {
  if (workers <= 0) return 1;
  const ratio = clamp(getResourceAmount(stock, "tools") / workers);
  return 1 + ratio * ECONOMY.toolBonus;
}

/**
 * Step 5: production.
 *
 * Every flow (gathering, hunting, fishing, farming, herding, mining, crafting) depends on
 * suitable workers, their age, health and skills, on the season, the biome, the available
 * resources, the tools, the technologies and the local climate.
 */
export function produce(ctx: SimContext, community: Community, effects: TechEffects): Production {
  const { state } = ctx;
  const out = emptyProduction();
  const area = workArea(state, community.x, community.y, community.radius);
  const climate = climateAt(state, community.x, community.y);
  const weights = seasonWeights(state.config);
  const avgFertility = area.reduce((acc, c) => acc + c.fertility, 0) / Math.max(1, area.length);
  const waterCells = area.filter((c) => c.river || c.coastal);
  const hasWater = waterCells.length > 0;
  const settlement = community.settlement;
  // Seasonal yield of the land the group works: winter in a tundra is close to zero.
  const centre = cellAt(state, community.x, community.y);
  const seasonal = annualYieldAt(state, centre, weights);

  let gatherDemand = 0;
  let huntDemand = 0;
  let farmers = 0;
  let farmerSkill = 0;
  let herders = 0;
  let herderSkill = 0;
  let fishers = 0;
  let fisherSkill = 0;
  let miners = 0;
  let minerSkill = 0;
  let crafters = 0;
  let crafterSkill = 0;
  let builders = 0;
  let workers = 0;

  for (const p of community.members) {
    const f = workFactor(p);
    if (p.action === "rest" || p.action === "socialize") continue;
    workers += 1;
    switch (p.action) {
      case "gather":
        gatherDemand +=
          ECONOMY.gatherYield * (0.7 + p.skills.gathering * 0.6) * f * (0.6 + avgFertility * 0.8);
        break;
      case "hunt":
        huntDemand += ECONOMY.huntYield * (0.6 + p.skills.hunting * 0.8) * f;
        break;
      case "farm":
        farmers++;
        farmerSkill += (0.7 + p.skills.gathering * 0.6) * f;
        break;
      case "herd":
        herders++;
        herderSkill += (0.7 + p.skills.gathering * 0.4 + p.skills.hunting * 0.2) * f;
        break;
      case "fish":
        fishers++;
        fisherSkill += (0.7 + p.skills.hunting * 0.5) * f;
        break;
      case "mine":
        miners++;
        minerSkill += (0.7 + p.skills.building * 0.4 + p.skills.crafting * 0.2) * f;
        break;
      case "craft":
        crafters++;
        crafterSkill += (0.6 + p.skills.crafting * 0.8) * f;
        break;
      case "build":
        builders += f;
        break;
      default:
        break;
    }
  }

  const tools = toolFactor(community.stock, workers);
  gatherDemand *= effects.gatherMultiplier * tools;
  huntDemand *= effects.huntMultiplier * tools;

  // --- Foraging and hunting: limited by what the land actually holds ---------
  const naturalDemand = gatherDemand + huntDemand;
  const foraged = extractNaturalFood(area, naturalDemand * seasonal);
  const huntShare = naturalDemand > 0 ? huntDemand / naturalDemand : 0;
  out.hunted = round(foraged * huntShare, 2);
  // Hunting also yields hides.
  out.hides = round(out.hunted * 0.12 * effects.craftMultiplier, 2);

  // --- Fishing ---------------------------------------------------------------
  if (hasWater) {
    const portBonus = settlement && settlement.buildings.port > 0 ? 1.35 : 1;
    const fishSeason = 0.85 + seasonal * 0.3; // fish are available even in winter
    out.fished = round(
      fisherSkill * ECONOMY.fishYield * effects.fishMultiplier * portBonus * fishSeason * tools,
      2,
    );
    // Gatherers pick up shellfish and river food as a side activity.
    const gatherers = community.members.filter((p) => p.action === "gather").length;
    out.fished += round(gatherers * ECONOMY.fishingBonus * effects.fishMultiplier, 2);
  } else if (fishers > 0) {
    // No water in reach: the effort is wasted, which is exactly the point of geography.
    out.fished = 0;
  }

  // --- Farming ---------------------------------------------------------------
  if (effects.farmMultiplier > 0 && settlement && farmers > 0) {
    const fieldCells = area.filter((c) => c.fields > 0 && c.settlementId === settlement.id);
    const fields = fieldCells.reduce((acc, c) => acc + c.fields, 0);
    const capacity = fields * ECONOMY.farmersPerField;
    if (capacity > 0) {
      const worked = Math.min(farmers, capacity);
      const fieldFertility = fieldCells.reduce((acc, c) => acc + c.fertility * c.fields, 0) / fields;
      const irrigation = settlement.buildings.well > 0 ? 1.15 : 1;
      out.farmed = round(
        farmerSkill *
          (worked / farmers) *
          ECONOMY.farmYield *
          fieldFertility *
          effects.farmMultiplier *
          seasonal *
          irrigation *
          tools,
        3,
      );
      const depletion = ECONOMY.fieldDepletion * (effects.farmMultiplier > 1.2 ? 0.5 : 1);
      for (const c of fieldCells) {
        c.fertility = clamp(
          c.fertility -
            depletion * c.fields +
            ECONOMY.fertilityRecovery * 0.3 * (c.baseFertility - c.fertility),
        );
      }
    }
  }

  // --- Herding ---------------------------------------------------------------
  if (settlement && herders > 0) {
    const pastureCells = area.filter((c) => c.pastures > 0 && c.settlementId === settlement.id);
    const pastures = pastureCells.reduce((acc, c) => acc + c.pastures, 0);
    const capacity = pastures * ECONOMY.herdersPerPasture;
    if (capacity > 0) {
      const worked = Math.min(herders, capacity);
      // Livestock buffers the winter: it depends much less on the season than crops.
      out.herded = round(
        herderSkill *
          (worked / herders) *
          ECONOMY.herdYield *
          effects.herdMultiplier *
          (0.7 + seasonal * 0.4),
        3,
      );
      out.hides = round(out.hides + out.herded * 0.2 * effects.craftMultiplier, 2);
    }
  }

  out.foraged = round(foraged + out.fished, 2);
  out.food = round((foraged + out.fished + out.farmed + out.herded) * climate, 3);

  // --- Wood, stone, ores -----------------------------------------------------
  const gatherers = community.members.filter((p) => p.action === "gather").length;
  const fuel =
    community.members.length * ECONOMY.fuelWoodPerPerson * (effects.gatherMultiplier > 1 ? 1.3 : 1);
  extractWood(area, fuel);
  out.wood = round(extractWood(area, builders * 3 + gatherers * 0.2), 2);
  const quarry = settlement ? settlement.buildings.quarry : 0;
  out.stone = round(extractStone(area, builders * 1.5 + quarry * 4), 2);

  if (miners > 0 || (settlement && settlement.buildings.mine > 0)) {
    const mineBonus = settlement ? 1 + settlement.buildings.mine * 0.5 : 1;
    const capacity =
      (minerSkill * ECONOMY.minerYield + (settlement?.buildings.mine ?? 0) * 1.5) *
      effects.miningMultiplier *
      mineBonus *
      tools;
    const techs = community.tribe.techs;
    let budget = capacity;
    const take = (kind: "copper" | "tin" | "iron" | "coal" | "clay", share: number, allowed: boolean) => {
      if (!allowed || budget <= 0) return 0;
      const amount =
        kind === "copper" ? extractCopper(area, budget * share) : extractOre(area, kind, budget * share);
      budget -= amount;
      return round(amount, 2);
    };
    out.clay = take("clay", 0.35, techs.includes("pottery"));
    out.copper = take("copper", 0.4, techs.includes("copper_working"));
    out.tin = take("tin", 0.3, techs.includes("bronze_working") || techs.includes("smelting"));
    out.iron = take("iron", 0.4, techs.includes("iron_working"));
    out.coal = take("coal", 0.5, techs.includes("smelting"));
  } else if (community.tribe.techs.includes("copper_working")) {
    out.copper = round(extractCopper(area, builders * 0.6), 2);
  }

  // --- Crafting: ores and hides become tools and tradable goods --------------
  if (crafters > 0) {
    const foundry = settlement && settlement.buildings.foundry > 0;
    const metal = Math.min(
      crafterSkill * ECONOMY.crafterYield * effects.craftMultiplier * (foundry ? 1.6 : 1),
      getResourceAmount(community.stock, "copper") * 0.5 +
        getResourceAmount(community.stock, "iron") * 0.6 +
        out.copper * 0.5 +
        out.iron * 0.6 +
        crafterSkill * 0.3,
    );
    out.tools = round(Math.max(0, metal), 2);
    if (out.tools > 0 && foundry) {
      // The foundry burns fuel and turns ore into tools.
      consumeResource(community.stock, "fuel", out.tools * 0.4);
      consumeResource(community.stock, "copper", out.tools * 0.35);
      consumeResource(community.stock, "iron", out.tools * 0.2);
    }
    out.wealth = round(out.tools * 1.5 + out.hides * 0.6, 2);
  }

  // --- Everything lands in the stockpile -------------------------------------
  const stock = community.stock;
  addResource(stock, "food", out.food);
  const materialCap = settlement
    ? 250 + settlement.buildings.storehouse * 60
    : community.members.length * 0.6 + 5;
  addResource(stock, "wood", out.wood);
  addResource(stock, "stone", out.stone);
  addResource(stock, "copper", out.copper);
  addResource(stock, "clay", out.clay);
  addResource(stock, "tin", out.tin);
  addResource(stock, "iron", out.iron);
  addResource(stock, "fuel", out.coal + out.wood * 0.1);
  addResource(stock, "hides", out.hides);
  addResource(stock, "tools", out.tools);
  addResource(stock, "wealth", out.wealth);
  addResource(stock, "water", hasWater ? community.members.length : community.members.length * 0.4);
  for (const kind of ["wood", "stone", "copper", "clay", "tin", "iron", "fuel", "hides", "tools"] as const) {
    clampResource(stock, kind, materialCap);
  }
  clampResource(stock, "water", community.members.length * 2);

  ctx.counters.foodProduced += out.food;
  ctx.counters.goodsProduced += out.tools + out.hides + out.clay + out.tin + out.iron + out.coal;
  return out;
}

export interface Consumption {
  needed: number;
  eaten: number;
  ratio: number;
  spoiled: number;
  /** Extra food burned because of the cold. */
  winterSurcharge: number;
}

/** Feeding order under scarcity, by distribution policy. */
function rationingPriority(policy: DistributionPolicy, p: Person, isLeader: boolean): number {
  const adult = p.age >= AGE.adult && p.age < AGE.elder;
  switch (policy) {
    case "workers":
      return adult && p.action !== "rest" ? 0 : p.age < AGE.adult ? 1 : 2;
    case "warriors":
      return p.role === "warrior" || p.action === "defend" ? 0 : adult ? 1 : p.age < AGE.adult ? 2 : 3;
    case "elite":
      return isLeader || p.prestige > 0.55 ? 0 : adult ? 1 : p.age < AGE.adult ? 2 : 3;
    default:
      // Egalitarian: children and workers first, elders last, but the gap stays small.
      return adult ? 0 : p.age < AGE.adult ? 0 : 1;
  }
}

/** Social cost of an unequal distribution when there is not enough for everyone. */
export function distributionCohesionCost(policy: DistributionPolicy, shortfall: number): number {
  const base = policy === "elite" ? 0.09 : policy === "warriors" ? 0.05 : policy === "workers" ? 0.02 : 0;
  return round(base * clamp(shortfall * 2), 4);
}

/**
 * Step 6: consumption, spoilage, storage cap and the resulting hunger/health update.
 * Winter raises the amount of food each person needs, especially in harsh climates.
 */
export function consume(ctx: SimContext, community: Community, effects: TechEffects): Consumption {
  const state = ctx.state;
  const cell = cellAt(state, community.x, community.y);
  const winterFactor = winterConsumptionFactor(state, cell, state.config);
  const baseNeed = community.members.reduce((acc, p) => acc + foodNeed(p), 0);
  const needed = round(baseNeed * winterFactor, 3);
  const stock = community.stock;
  const eaten = Math.min(needed, stock.food);
  consumeResource(stock, "food", eaten);

  const before = stock.food;
  const spoilRate = clamp(state.config.economy.baseSpoilage * effects.spoilageMultiplier, 0, 0.9);
  stock.food = stock.food * (1 - spoilRate);
  const capacity = storageCapacity(community, effects);
  stock.food = Math.min(stock.food, capacity);
  const spoiled = round(before - stock.food, 2);
  // Hides rot too; worked goods and metals do not.
  const hides = getResourceAmount(stock, "hides");
  if (hides > 0) consumeResource(stock, "hides", hides * ECONOMY.hideSpoilage);

  const ratio = needed > 0 ? eaten / needed : 1;
  community.foodRatio = ratio;
  ctx.counters.foodConsumed += eaten;
  roundStock(stock);

  const overcrowded = community.members.length > housingCapacity(community);
  const policy = community.tribe.distribution;
  const leaderId = community.tribe.leaderId;
  const order =
    ratio < 1
      ? [...community.members].sort(
          (a, b) =>
            rationingPriority(policy, a, a.id === leaderId) -
              rationingPriority(policy, b, b.id === leaderId) || a.seq - b.seq,
        )
      : community.members;

  // Tools wear out with use.
  consumeResource(stock, "tools", community.members.length * ECONOMY.toolWear);

  let remaining = eaten;
  for (const p of order) {
    const need = foodNeed(p) * winterFactor;
    const got = Math.min(need, remaining);
    remaining -= got;
    const personal = need > 0 ? got / need : 1;
    if (personal < 1) p.hunger = clamp(p.hunger + (1 - personal) * 0.55);
    else p.hunger = clamp(p.hunger - 0.4);
    const ageCap = clamp(1 - Math.max(0, p.age - 50) * 0.012, 0.3, 1);
    if (p.hunger > 0.3) p.health = clamp(p.health - (p.hunger - 0.25) * 0.45 * ctx.rng.range(0.4, 1.6));
    else p.health = Math.min(ageCap, p.health + 0.1);
    if (ctx.rng.chance(overcrowded ? 0.05 : 0.02)) p.health = clamp(p.health - ctx.rng.range(0.1, 0.4));
    p.health = round(p.health);
    p.hunger = round(p.hunger);
  }

  if (ratio < 1) {
    const cost = distributionCohesionCost(policy, 1 - ratio);
    community.tribe.stability.cohesion = clamp(community.tribe.stability.cohesion - cost);
    community.tribe.stability.tension = clamp(community.tribe.stability.tension + cost * 0.8);
  }

  return { needed, eaten: round(eaten, 3), ratio, spoiled, winterSurcharge: round(needed - baseNeed, 3) };
}

/**
 * Villages of the same tribe share food: donors keep one year of reserves per person,
 * recipients get up to their deficit. Roads double the reach.
 */
export function redistributeFood(communities: Community[]) {
  const byTribe = new Map<string, Community[]>();
  for (const c of communities) {
    if (!c.settlement) continue;
    const list = byTribe.get(c.tribe.id) ?? [];
    list.push(c);
    byTribe.set(c.tribe.id, list);
  }
  for (const list of byTribe.values()) {
    if (list.length < 2) continue;
    for (const recipient of list) {
      const need = recipient.members.reduce((acc, p) => acc + foodNeed(p), 0);
      let deficit = need - recipient.stock.food;
      if (deficit <= 0) continue;
      for (const donor of list) {
        if (donor === recipient || deficit <= 0 || !donor.settlement || !recipient.settlement) continue;
        const linked = donor.settlement.roadLinks.includes(recipient.settlement.id);
        const reach = linked ? 20 : 10;
        if (Math.max(Math.abs(donor.x - recipient.x), Math.abs(donor.y - recipient.y)) > reach) continue;
        const reserve = donor.members.reduce((acc, p) => acc + foodNeed(p), 0) * 1.2;
        const surplus = donor.stock.food - reserve;
        if (surplus <= 0) continue;
        const amount = Math.min(surplus * 0.5, deficit);
        donor.stock.food -= amount;
        recipient.stock.food += amount;
        deficit -= amount;
      }
    }
  }
}

const TRADED: readonly ResourceKind[] = [
  "food",
  "wood",
  "stone",
  "copper",
  "clay",
  "tin",
  "iron",
  "hides",
  "tools",
];

/**
 * Barter between two stockpiles: each side offers what it holds in relative surplus and
 * asks for what it lacks. Distance costs part of the cargo.
 */
export function exchangeGoods(
  a: Stockpile,
  aPop: number,
  b: Stockpile,
  bPop: number,
  options: { surplusShare?: number; transportLoss?: number } = {},
): number {
  const surplusShare = options.surplusShare ?? 0.15;
  const loss = clamp(options.transportLoss ?? 0, 0, 0.9);
  let volume = 0;
  const perCapita = (s: Stockpile, pop: number, k: ResourceKind) =>
    getResourceAmount(s, k) / Math.max(1, pop);
  for (const key of TRADED) {
    const pa = perCapita(a, aPop, key);
    const pb = perCapita(b, bPop, key);
    if (Math.abs(pa - pb) < 0.2) continue;
    const [from, to] = pa > pb ? [a, b] : [b, a];
    const amount = Math.min(getResourceAmount(from, key) * surplusShare, 20);
    if (amount < 0.5) continue;
    const moved = consumeResource(from, key, amount);
    addResource(to, key, moved * (1 - loss));
    volume += moved;
  }
  if (volume > 0) {
    addResource(a, "wealth", volume * 0.05);
    addResource(b, "wealth", volume * 0.05);
  }
  roundStock(a);
  roundStock(b);
  return round(volume, 2);
}
