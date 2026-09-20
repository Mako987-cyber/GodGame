import { GOVERNMENTS } from "./constants";
import type { SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { clamp, round } from "./grid";
import { agree } from "./language/italian";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { hashFloat, type Rng } from "./prng";
import { tribeEffects } from "./technology";
import type { CulturePressureKind, CultureTraits, GovernmentType, Stability, Tribe } from "./types";

/**
 * Culture, government and internal stability.
 *
 * Every trait is a number in 0..100 that drifts slowly toward the pressures the group is
 * actually under: nothing here encodes a real people, the starting values are generated
 * procedurally from the world seed.
 */

/**
 * Canonical order of the traits. Explicit on purpose: JSONB does not preserve key order, so a
 * culture loaded from the database iterates differently from one built in memory. Anything
 * whose *output order* depends on the traits must walk this list, never `Object.keys`.
 */
export const CULTURE_TRAITS = [
  "cooperation",
  "militarism",
  "tradeOpenness",
  "traditionalism",
  "centralization",
  "hierarchy",
  "spirituality",
  "innovation",
  "expansionism",
  "tolerance",
  "exploration",
  "administrativeCapacity",
  "culturalCohesion",
] as const satisfies readonly (keyof CultureTraits)[];

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
  tolerance: "tolleranza",
  exploration: "esplorazione",
  administrativeCapacity: "capacità amministrativa",
  culturalCohesion: "coesione culturale",
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
    tolerance: trait(50),
    exploration: trait(45),
    administrativeCapacity: trait(28),
    culturalCohesion: trait(62),
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
  /** 0..1, how much it lived beside peoples unlike it. */
  contact: number;
  /** 0..1, how firmly a shared belief binds it. */
  belief: number;
}

/**
 * Longest cultural record a people carries. Bounded on purpose: a world runs for a thousand
 * ticks and this travels with every tribe, so only the shifts worth explaining are kept.
 */
export const MAX_CULTURE_HISTORY = 24;

/** A trait must move at least this much in one year to be worth writing down. */
export const CULTURE_RECORD_THRESHOLD = 0.4;

/** Which pressure is most responsible for where a trait is heading. */
const TRAIT_CAUSE: Record<keyof CultureTraits, CulturePressureKind> = {
  militarism: "war",
  tradeOpenness: "trade",
  traditionalism: "scarcity",
  innovation: "discovery",
  expansionism: "expansion",
  centralization: "complexity",
  hierarchy: "complexity",
  cooperation: "war",
  spirituality: "belief",
  tolerance: "contact",
  exploration: "expansion",
  administrativeCapacity: "complexity",
  culturalCohesion: "belief",
};

const CAUSE_REASON: Record<CulturePressureKind, string> = {
  war: "gli anni di guerra",
  trade: "gli scambi con i vicini",
  scarcity: "la fame patita",
  discovery: "le cose nuove imparate",
  expansion: "le terre occupate",
  complexity: "la macchina da governare, cresciuta con il popolo",
  belief: "quello in cui il popolo ha creduto",
  contact: "la convivenza con chi è diverso",
};

function drift(value: number, target: number, speed: number): number {
  return round(clamp(value + (target - value) * speed, 1, 99), 2);
}

/**
 * How far a people leans away from the answer its circumstances alone would suggest, in trait
 * points. Two peoples living the same history do not become the same people: one reads a war
 * as a reason to close ranks, another as a reason to open the borders.
 *
 * Hash-derived from the world seed and the tribe id, so it is stable across reloads, costs
 * nothing in state, and is identical for worlds saved before it existed. It is NOT read from
 * the historical identity.
 */
export const CULTURE_DISPOSITION_RANGE = 16;

export function cultureDisposition(seed: string, tribeId: string, trait: keyof CultureTraits): number {
  return round((hashFloat(`${seed}|culture|${tribeId}|${trait}`) - 0.5) * 2 * CULTURE_DISPOSITION_RANGE, 2);
}

/**
 * Step 14: slow cultural drift driven by what the group actually lived through.
 *
 * `moment` is optional so the function stays callable as a pure drift step in tests; when it is
 * given, every shift large enough to matter is written to the people's own record.
 */
export function updateCulture(
  tribe: Tribe,
  pressure: CulturePressure,
  speed: number,
  seed = "",
  moment?: { tick: number; year: number; causeEventId?: string },
) {
  const c = tribe.culture;
  const before = moment ? { ...c } : null;
  const lean = (trait: keyof CultureTraits) => (seed ? cultureDisposition(seed, tribe.id, trait) : 0);
  c.militarism = drift(c.militarism, 20 + pressure.war * 75 + lean("militarism"), speed);
  c.tradeOpenness = drift(c.tradeOpenness, 20 + pressure.trade * 70 + lean("tradeOpenness"), speed * 0.9);
  c.traditionalism = drift(
    c.traditionalism,
    55 + pressure.scarcity * 40 - pressure.discovery * 25 + lean("traditionalism"),
    speed * 0.6,
  );
  c.innovation = drift(
    c.innovation,
    20 + pressure.discovery * 60 + (1 - pressure.scarcity) * 25 + lean("innovation"),
    speed * 0.8,
  );
  c.expansionism = drift(
    c.expansionism,
    20 + pressure.expansion * 60 + pressure.scarcity * 25 + lean("expansionism"),
    speed * 0.7,
  );
  c.centralization = drift(
    c.centralization,
    15 + pressure.complexity * 70 + lean("centralization"),
    speed * 0.5,
  );
  c.hierarchy = drift(
    c.hierarchy,
    15 +
      pressure.complexity * 55 +
      pressure.war * 20 +
      (tribe.distribution === "elite" ? 20 : 0) +
      lean("hierarchy"),
    speed * 0.5,
  );
  c.cooperation = drift(
    c.cooperation,
    35 + (1 - pressure.war) * 35 + tribe.stability.cohesion * 30 + lean("cooperation"),
    speed * 0.6,
  );
  c.spirituality = drift(
    c.spirituality,
    30 + pressure.scarcity * 30 + pressure.complexity * 25 + lean("spirituality"),
    speed * 0.4,
  );
  // Living beside others opens a people; war and hunger close it again.
  c.tolerance = drift(
    c.tolerance,
    30 +
      pressure.contact * 55 +
      pressure.trade * 20 -
      pressure.war * 35 -
      pressure.scarcity * 15 +
      lean("tolerance"),
    speed * 0.5,
  );
  // Curiosity about what lies beyond: fed by room to grow and by things newly learned,
  // starved by hunger, which keeps everyone close to home.
  c.exploration = drift(
    c.exploration,
    20 +
      pressure.expansion * 45 +
      pressure.discovery * 30 +
      pressure.trade * 20 -
      pressure.scarcity * 25 +
      lean("exploration"),
    speed * 0.6,
  );
  // A people only learns to govern itself by having to: size and records, slowly.
  c.administrativeCapacity = drift(
    c.administrativeCapacity,
    10 + pressure.complexity * 65 + pressure.trade * 15 + lean("administrativeCapacity"),
    speed * 0.35,
  );
  // What holds it together: a shared belief and peace build it, hunger and war eat it.
  c.culturalCohesion = drift(
    c.culturalCohesion,
    35 + pressure.belief * 30 + (1 - pressure.scarcity) * 25 - pressure.war * 20 + lean("culturalCohesion"),
    speed * 0.45,
  );

  if (!before || !moment) return;
  recordCultureChanges(tribe, before, moment);
}

/**
 * Writes down the shifts worth explaining. Small yearly drift is not recorded — only movements
 * above `CULTURE_RECORD_THRESHOLD` — and the record is a ring of at most `MAX_CULTURE_HISTORY`.
 */
export function recordCultureChanges(
  tribe: Tribe,
  before: CultureTraits,
  moment: { tick: number; year: number; causeEventId?: string },
) {
  tribe.cultureHistory ??= [];
  for (const trait of CULTURE_TRAITS) {
    const previousValue = before[trait];
    const newValue = tribe.culture[trait];
    if (Math.abs(newValue - previousValue) < CULTURE_RECORD_THRESHOLD) continue;
    const cause = TRAIT_CAUSE[trait];
    tribe.cultureHistory.push({
      tick: moment.tick,
      year: moment.year,
      trait,
      previousValue: round(previousValue, 2),
      newValue: round(newValue, 2),
      cause,
      reason: `${CULTURE_LABELS[trait]} ${newValue > previousValue ? "in crescita" : "in calo"}: ${CAUSE_REASON[cause]}`,
      ...(moment.causeEventId ? { causeEventId: moment.causeEventId } : {}),
    });
  }
  const overflow = tribe.cultureHistory.length - MAX_CULTURE_HISTORY;
  if (overflow > 0) tribe.cultureHistory.splice(0, overflow);
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
  /** What the people's system of belief adds, already scaled by adherence (see belief.ts). */
  belief?: { cohesion: number; legitimacy: number };
}

/**
 * Step 14: recomputes the stability indicators. Values move gradually (inertia), so unrest
 * builds up over years instead of flipping every tick.
 */
export function updateStability(tribe: Tribe, input: StabilityInput, inertia: number) {
  const belief = input.belief ?? { cohesion: 0, legitimacy: 0 };
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
      belief.cohesion +
      (input.atWar ? 0.05 : 0) -
      input.culturalStrain * 0.3 -
      Math.min(0.25, input.spread / 40) -
      Math.max(0, input.growthRate - 0.06) * 2,
  );
  const legitimacy = clamp(
    gov.legitimacy * 0.5 +
      input.leaderPrestige * 0.35 +
      effects.legitimacyBonus +
      belief.legitimacy +
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
        title: t("{Art:people} {v:people:torna|tornano} a un'organizzazione più semplice", {
          people: peoplePhrase(tribe),
        }),
        description: t(
          "{reduced} a {population} persone, {art:people} non {v:people:riesce|riescono} più a sostenere le vecchie istituzioni: il potere torna alle forme più antiche.",
          {
            reduced: agree(peoplePhrase(tribe), "Ridotto", "Ridotta", "Ridotti", "Ridotte"),
            population,
            people: peoplePhrase(tribe),
          },
        ),
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
      title: t("Nuova forma di governo presso {art:people}", { people: peoplePhrase(tribe) }),
      description: t(
        "Con {population} abitanti e {settlements} insediamenti, {art:people} {v:people:ha|hanno} cambiato il modo di governarsi: {reason}.",
        { population, settlements, people: peoplePhrase(tribe), reason: step.reason },
      ),
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
