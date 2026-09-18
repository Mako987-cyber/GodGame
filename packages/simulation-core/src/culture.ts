import { GOVERNMENTS } from "./constants";
import type { SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { clamp, round } from "./grid";
import type { Rng } from "./prng";
import { tribeEffects } from "./technology";
import type { CultureTraits, GovernmentType, Stability, Tribe } from "./types";

/**
 * Culture, government and internal stability.
 *
 * Every trait is a number in 0..100 that drifts slowly toward the pressures the group is
 * actually under: nothing here encodes a real people, the starting values are generated
 * procedurally from the world seed.
 */

export const CULTURE_LABELS: Record<keyof CultureTraits, string> = {
  cooperation: "cooperazione",
  militarism: "militarismo",
  tradeOpenness: "apertura al commercio",
  traditionalism: "tradizionalismo",
  centralization: "centralizzazione",
  hierarchy: "gerarchia sociale",
  spirituality: "spiritualità",
  innovation: "innovazione",
  expansionism: "espansionismo",
};

export function randomCulture(rng: Rng): CultureTraits {
  const trait = (mean: number) => Math.round(clamp(mean + (rng.trait() - 0.5) * 60, 5, 95));
  return {
    cooperation: trait(58),
    militarism: trait(42),
    tradeOpenness: trait(48),
    traditionalism: trait(62),
    centralization: trait(32),
    hierarchy: trait(32),
    spirituality: trait(52),
    innovation: trait(44),
    expansionism: trait(45),
  };
}

export function initialStability(): Stability {
  return {
    happiness: 0.65,
    cohesion: 0.7,
    legitimacy: 0.6,
    tension: 0.12,
    order: 0.68,
    corruption: 0.05,
    revoltRisk: 0.03,
    unrestYears: 0,
  };
}

/** Distance between two cultures, 0 (identical) .. 1 (opposite). */
export function culturalDistance(a: CultureTraits, b: CultureTraits): number {
  const keys = Object.keys(a) as (keyof CultureTraits)[];
  let total = 0;
  for (const key of keys) total += Math.abs(a[key] - b[key]);
  return round(clamp(total / (keys.length * 100)), 3);
}

export interface CulturePressure {
  /** 0..1, how much the group fought this year. */
  war: number;
  /** 0..1, how much it traded. */
  trade: number;
  /** 0..1, how hungry it was. */
  scarcity: number;
  /** 0..1, how much new knowledge it produced. */
  discovery: number;
  /** 0..1, how much it expanded (new settlements, colonies). */
  expansion: number;
  /** 0..1, how big and settled it is. */
  complexity: number;
}

function drift(value: number, target: number, speed: number): number {
  return round(clamp(value + (target - value) * speed, 1, 99), 2);
}

/** Step 14: slow cultural drift driven by what the group actually lived through. */
export function updateCulture(tribe: Tribe, pressure: CulturePressure, speed: number) {
  const c = tribe.culture;
  c.militarism = drift(c.militarism, 20 + pressure.war * 75, speed);
  c.tradeOpenness = drift(c.tradeOpenness, 20 + pressure.trade * 70, speed * 0.9);
  c.traditionalism = drift(
    c.traditionalism,
    35 + pressure.scarcity * 40 - pressure.discovery * 25 + 20,
    speed * 0.6,
  );
  c.innovation = drift(
    c.innovation,
    20 + pressure.discovery * 60 + (1 - pressure.scarcity) * 25,
    speed * 0.8,
  );
  c.expansionism = drift(c.expansionism, 20 + pressure.expansion * 60 + pressure.scarcity * 25, speed * 0.7);
  c.centralization = drift(c.centralization, 15 + pressure.complexity * 70, speed * 0.5);
  c.hierarchy = drift(
    c.hierarchy,
    15 + pressure.complexity * 55 + pressure.war * 20 + (tribe.distribution === "elite" ? 20 : 0),
    speed * 0.5,
  );
  c.cooperation = drift(
    c.cooperation,
    35 + (1 - pressure.war) * 35 + tribe.stability.cohesion * 30,
    speed * 0.6,
  );
  c.spirituality = drift(c.spirituality, 30 + pressure.scarcity * 30 + pressure.complexity * 25, speed * 0.4);
}

export interface StabilityInput {
  population: number;
  foodRatio: number;
  atWar: boolean;
  recentDefeat: boolean;
  leaderMissing: boolean;
  leaderPrestige: number;
  settlements: number;
  /** Mean distance of the settlements from the capital, in cells. */
  spread: number;
  epidemic: boolean;
  growthRate: number;
  culturalStrain: number;
}

/**
 * Step 14: recomputes the stability indicators. Values move gradually (inertia), so unrest
 * builds up over years instead of flipping every tick.
 */
export function updateStability(tribe: Tribe, input: StabilityInput, inertia: number) {
  const s = tribe.stability;
  const gov = GOVERNMENTS[tribe.government];
  const effects = tribeEffects(tribe);
  const hunger = clamp(1 - input.foodRatio);
  const inequality =
    tribe.distribution === "elite"
      ? 0.35
      : tribe.distribution === "warriors"
        ? 0.2
        : tribe.distribution === "workers"
          ? 0.1
          : 0;

  const happiness = clamp(
    0.85 -
      hunger * 0.9 -
      inequality * 0.5 -
      gov.taxation * 1.2 -
      (input.atWar ? 0.12 : 0) -
      (input.epidemic ? 0.15 : 0),
  );
  const cohesion = clamp(
    0.35 +
      (tribe.culture.cooperation / 100) * 0.4 +
      effects.cohesion +
      (input.atWar ? 0.05 : 0) -
      input.culturalStrain * 0.3 -
      Math.min(0.25, input.spread / 40) -
      Math.max(0, input.growthRate - 0.06) * 2,
  );
  const legitimacy = clamp(
    gov.legitimacy * 0.5 +
      input.leaderPrestige * 0.35 +
      effects.legitimacyBonus +
      (tribe.culture.traditionalism / 100) * 0.1 +
      happiness * 0.2 -
      (input.leaderMissing ? 0.3 : 0) -
      (input.recentDefeat ? 0.15 : 0),
  );
  const tension = clamp(
    hunger * 0.5 +
      inequality * 0.4 +
      gov.taxation * 1.5 +
      (1 - legitimacy) * 0.35 +
      input.culturalStrain * 0.25 +
      Math.min(0.2, input.spread / 45) -
      (tribe.culture.cooperation / 100) * 0.15,
  );
  const corruption = clamp(
    gov.taxation * 1.1 +
      Math.min(0.2, input.population / 1500) +
      Math.min(0.2, input.spread / 40) -
      (tribe.techs.includes("laws") ? 0.15 : 0) -
      (tribe.culture.cooperation / 100) * 0.1,
  );
  const order = clamp(legitimacy * 0.5 + cohesion * 0.35 + (1 - corruption) * 0.25 - tension * 0.35);

  s.happiness = blend(s.happiness, happiness, inertia);
  s.cohesion = blend(s.cohesion, cohesion, inertia);
  s.legitimacy = blend(s.legitimacy, legitimacy, inertia);
  s.tension = blend(s.tension, tension, inertia);
  s.corruption = blend(s.corruption, corruption, inertia * 0.6);
  s.order = blend(s.order, order, inertia);
  s.revoltRisk = round(
    clamp(s.tension * 0.6 + (1 - s.legitimacy) * 0.3 + (1 - s.order) * 0.3 - s.happiness * 0.25) *
      gov.revoltRisk,
    3,
  );
  s.unrestYears = s.revoltRisk > 0.35 ? s.unrestYears + 1 : Math.max(0, s.unrestYears - 1);
}

function blend(current: number, target: number, inertia: number): number {
  return round(clamp(current + (target - current) * inertia), 3);
}

interface GovernmentRequirement {
  from: GovernmentType[];
  to: GovernmentType;
  test: (tribe: Tribe, population: number, maxLevel: number, settlements: number) => boolean;
  reason: string;
}

/** Ordered list: the first matching transition wins, so forms evolve one step at a time. */
const GOVERNMENT_PATH: GovernmentRequirement[] = [
  {
    from: ["city_state"],
    to: "merchant_republic",
    test: (t, pop) =>
      t.techs.includes("long_distance_trade") &&
      t.culture.tradeOpenness >= 62 &&
      t.culture.hierarchy <= 58 &&
      pop >= 220,
    reason: "il peso dei mercanti e delle rotte commerciali",
  },
  {
    from: ["chiefdom", "tribal_monarchy", "elder_council"],
    to: "city_state",
    test: (t, pop, maxLevel) =>
      t.techs.includes("writing") && t.techs.includes("laws") && maxLevel >= 4 && pop >= 200,
    reason: "la crescita della città e delle sue magistrature",
  },
  {
    from: ["chiefdom"],
    to: "tribal_monarchy",
    test: (t, pop) =>
      t.culture.hierarchy >= 58 && t.culture.centralization >= 52 && t.dynastyId !== null && pop >= 150,
    reason: "il consolidarsi di una dinastia al comando",
  },
  {
    from: ["clan", "elder_council"],
    to: "chiefdom",
    test: (t, pop, _maxLevel, settlements) =>
      settlements >= 1 && pop >= 80 && t.culture.hierarchy >= 42 && t.culture.centralization >= 38,
    reason: "il potere accentrato nelle mani di un capo",
  },
  {
    from: ["clan"],
    to: "elder_council",
    test: (t, pop) => pop >= 55 && t.culture.traditionalism >= 50 && t.culture.cooperation >= 50,
    reason: "l'autorità riconosciuta agli anziani",
  },
];

/** Governments can also fall back when the group shrinks or collapses. */
const REGRESSION: Partial<Record<GovernmentType, GovernmentType>> = {
  merchant_republic: "city_state",
  city_state: "chiefdom",
  tribal_monarchy: "chiefdom",
  chiefdom: "elder_council",
  elder_council: "clan",
};

export function updateGovernment(
  ctx: SimContext,
  tribe: Tribe,
  population: number,
  maxLevel: number,
  settlements: number,
) {
  const previous = tribe.government;
  if (population < 30 && previous !== "clan") {
    const next = REGRESSION[previous];
    if (next && ctx.rng.chance(0.25)) {
      tribe.government = next;
      tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - 0.1);
      emitEvent(ctx, {
        type: "culture",
        subtype: "government_regression",
        importance: 3,
        actors: [actor.tribe(tribe)],
        x: tribe.x,
        y: tribe.y,
        title: `I ${tribe.name} tornano a un'organizzazione più semplice`,
        description: `Ridotti a ${population} persone, i ${tribe.name} non riescono più a sostenere le vecchie istituzioni: il potere torna alle forme più antiche.`,
        metadata: { from: previous, to: next, population },
      });
    }
    return;
  }
  for (const step of GOVERNMENT_PATH) {
    if (!step.from.includes(previous)) continue;
    if (!step.test(tribe, population, maxLevel, settlements)) continue;
    if (!ctx.rng.chance(0.2)) return;
    tribe.government = step.to;
    tribe.stability.legitimacy = clamp(tribe.stability.legitimacy + 0.08);
    tribe.stability.tension = clamp(tribe.stability.tension + 0.05);
    emitEvent(ctx, {
      type: "culture",
      subtype: "government_change",
      importance: 4,
      actors: [actor.tribe(tribe)],
      x: tribe.x,
      y: tribe.y,
      title: `Nuova forma di governo tra i ${tribe.name}`,
      description: `Con ${population} abitanti e ${settlements} insediamenti, i ${tribe.name} hanno cambiato il modo di governarsi: ${step.reason}.`,
      metadata: { from: previous, to: step.to, population, settlements, maxLevel },
    });
    return;
  }
}

/** The ruling group picks how to share what the land gives. */
export function updateDistribution(tribe: Tribe, atWar: boolean, scarcity: number) {
  const c = tribe.culture;
  if (atWar && c.militarism >= 55) tribe.distribution = "warriors";
  else if (c.hierarchy >= 65 && c.centralization >= 55) tribe.distribution = "elite";
  else if (scarcity > 0.35 && c.cooperation < 55) tribe.distribution = "workers";
  else if (c.cooperation >= 55) tribe.distribution = "egalitarian";
}
