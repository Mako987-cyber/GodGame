import { AGE, ECONOMY, HOUSING, STORAGE } from "./constants";
import type { Community, SimContext } from "./context";
import { clamp } from "./grid";
import {
  climateAt,
  extractCopper,
  extractNaturalFood,
  extractStone,
  extractWood,
  workArea,
} from "./resources";
import type { TechEffects } from "./technology";
import type { Person, Stockpile } from "./types";

export interface Production {
  food: number;
  wood: number;
  stone: number;
  copper: number;
  farmed: number;
  foraged: number;
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
    (STORAGE.settlementBase + s.buildings.storehouse * STORAGE.storehouse + community.members.length * 0.5) *
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

/**
 * Step 4: production. Food = workers x yield x skill x technology x climate, limited by
 * what the land can give (natural food) or by the number of fields (farming).
 */
export function produce(ctx: SimContext, community: Community, effects: TechEffects): Production {
  const { state } = ctx;
  const area = workArea(state, community.x, community.y, community.radius);
  const climate = climateAt(state, community.x, community.y);
  const avgFertility = area.reduce((acc, c) => acc + c.fertility, 0) / Math.max(1, area.length);
  const hasWater = area.some((c) => c.river || c.coastal);

  let gatherDemand = 0;
  let huntDemand = 0;
  let farmers = 0;
  let farmerSkill = 0;
  let builders = 0;
  for (const p of community.members) {
    const f = workFactor(p);
    if (p.action === "gather")
      gatherDemand += ECONOMY.gatherYield * (0.7 + p.skills.gathering * 0.6) * f * (0.6 + avgFertility * 0.8);
    else if (p.action === "hunt") huntDemand += ECONOMY.huntYield * (0.6 + p.skills.hunting * 0.8) * f;
    else if (p.action === "farm") {
      farmers++;
      farmerSkill += (0.7 + p.skills.gathering * 0.6) * f;
    } else if (p.action === "build") builders += f;
  }
  gatherDemand *= effects.gatherMultiplier;
  huntDemand *= effects.huntMultiplier;

  const naturalDemand = gatherDemand + huntDemand;
  const foraged = extractNaturalFood(area, naturalDemand);
  const gatherers = community.members.filter((p) => p.action === "gather").length;
  const fishing = hasWater ? gatherers * ECONOMY.fishingBonus : 0;

  let farmed = 0;
  if (effects.farmMultiplier > 0 && community.settlement && farmers > 0) {
    const fieldCells = area.filter((c) => c.fields > 0 && c.settlementId === community.settlement?.id);
    const fields = fieldCells.reduce((acc, c) => acc + c.fields, 0);
    const capacity = fields * ECONOMY.farmersPerField;
    if (capacity > 0) {
      const worked = Math.min(farmers, capacity);
      const fieldFertility = fieldCells.reduce((acc, c) => acc + c.fertility * c.fields, 0) / fields;
      farmed = farmerSkill * (worked / farmers) * ECONOMY.farmYield * fieldFertility * effects.farmMultiplier;
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

  const food = (foraged + fishing + farmed) * climate;

  // Fuel wood is burned by everyone: large groups deforest their surroundings.
  const fuel =
    community.members.length * ECONOMY.fuelWoodPerPerson * (effects.gatherMultiplier > 1 ? 1.3 : 1);
  extractWood(area, fuel);
  const wood = extractWood(area, builders * 3 + gatherers * 0.2);
  const stone = extractStone(area, builders * 1.5);
  const copper = community.tribe.techs.includes("copper_working") ? extractCopper(area, builders * 0.6) : 0;

  const s = community.stock;
  s.food += food;
  const materialCap = community.settlement ? 250 : community.members.length * 0.6 + 5;
  s.wood = Math.min(materialCap, s.wood + wood);
  s.stone = Math.min(materialCap, s.stone + stone);
  s.copper = Math.min(materialCap, s.copper + copper);

  ctx.counters.foodProduced += food;
  return { food, wood, stone, copper, farmed: farmed * climate, foraged: (foraged + fishing) * climate };
}

export interface Consumption {
  needed: number;
  eaten: number;
  ratio: number;
  spoiled: number;
}

/** Steps 5-6: consumption, spoilage, storage cap and the resulting hunger/health update. */
export function consume(ctx: SimContext, community: Community, effects: TechEffects): Consumption {
  const needed = community.members.reduce((acc, p) => acc + foodNeed(p), 0);
  const stock = community.stock;
  const eaten = Math.min(needed, stock.food);
  stock.food -= eaten;
  const before = stock.food;
  stock.food *= 1 - ECONOMY.baseSpoilage * effects.spoilageMultiplier;
  stock.food = Math.min(stock.food, storageCapacity(community, effects));
  const spoiled = before - stock.food;
  const ratio = needed > 0 ? eaten / needed : 1;
  community.foodRatio = ratio;
  ctx.counters.foodConsumed += eaten;
  roundStock(stock);

  const overcrowded = community.members.length > housingCapacity(community);
  // Rationing: in a shortage working adults are fed first, then children, then elders.
  // Unequal distribution makes famine thin the group instead of killing everyone at once.
  const priority = (p: Person) => (p.age >= AGE.adult && p.age < AGE.elder ? 0 : p.age < AGE.adult ? 1 : 2);
  const order =
    ratio < 1
      ? [...community.members].sort((a, b) => priority(a) - priority(b) || a.seq - b.seq)
      : community.members;
  let remaining = eaten;
  for (const p of order) {
    const need = foodNeed(p);
    const got = Math.min(need, remaining);
    remaining -= got;
    const personal = got / need;
    if (personal < 1) p.hunger = clamp(p.hunger + (1 - personal) * 0.55);
    else p.hunger = clamp(p.hunger - 0.4);
    const ageCap = clamp(1 - Math.max(0, p.age - 50) * 0.012, 0.3, 1);
    if (p.hunger > 0.3) p.health = clamp(p.health - (p.hunger - 0.25) * 0.45 * ctx.rng.range(0.4, 1.6));
    else p.health = Math.min(ageCap, p.health + 0.1);
    if (ctx.rng.chance(overcrowded ? 0.05 : 0.02)) p.health = clamp(p.health - ctx.rng.range(0.1, 0.4));
    p.health = Math.round(p.health * 1000) / 1000;
    p.hunger = Math.round(p.hunger * 1000) / 1000;
  }
  return { needed, eaten, ratio, spoiled };
}

export function roundStock(stock: Stockpile) {
  stock.food = Math.round(stock.food * 100) / 100;
  stock.wood = Math.round(stock.wood * 100) / 100;
  stock.stone = Math.round(stock.stone * 100) / 100;
  stock.copper = Math.round(stock.copper * 100) / 100;
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

/**
 * Barter between two stockpiles: each side offers what it holds in relative surplus.
 * Returns the total volume exchanged.
 */
export function exchangeGoods(a: Stockpile, aPop: number, b: Stockpile, bPop: number): number {
  let volume = 0;
  const perCapita = (s: Stockpile, pop: number, k: keyof Stockpile) => s[k] / Math.max(1, pop);
  for (const key of ["food", "wood", "stone", "copper"] as const) {
    const pa = perCapita(a, aPop, key);
    const pb = perCapita(b, bPop, key);
    if (Math.abs(pa - pb) < 0.2) continue;
    const [from, to] = pa > pb ? [a, b] : [b, a];
    const amount = Math.min(from[key] * 0.15, 20);
    if (amount < 0.5) continue;
    from[key] -= amount;
    to[key] += amount;
    volume += amount;
  }
  roundStock(a);
  roundStock(b);
  return volume;
}
