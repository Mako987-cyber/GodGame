import type { Community, SimContext } from "./context";
import { clamp, round } from "./grid";
import { storageCapacity } from "./economy";
import { tribeEffects } from "./technology";
import { getResourceAmount } from "./stock";
import type { BeliefSystem, Tribe } from "./types";

/**
 * How well a people takes a blow, and what it does about it.
 *
 * Resilience is not a stat the engine stores and drifts: it is **recomputed every year from
 * what the people actually has** — stores, spare land, a network of towns, roads, technologies
 * genuinely in use, a government that can still give orders, and neighbours willing to help.
 * Nothing here reads the historical identity, and nothing is remembered between years except
 * through the things it measures.
 */

export interface ResilienceProfile {
  /** Stores and preservation against a bad harvest, 0..1. */
  foodResilience: number;
  /** How many different things the economy lives on, 0..1. */
  economicDiversity: number;
  /** How much of itself the state can still direct, 0..1. */
  administrativeCapacity: number;
  /** How willing people are to carry each other through it, 0..1. */
  socialCohesion: number;
  /** Slack between what is stored and what would be needed, 0..1. */
  reserveCapacity: number;
  /** Whether there is anywhere to go, 0..1. */
  migrationCapacity: number;
  /** Roads, walls, wells, storehouses, 0..1. */
  infrastructureQuality: number;
  /** How fast it gets back on its feet afterwards, 0..1. */
  recoverySpeed: number;
  /** Hygiene, wells and what it knows about illness, 0..1. */
  healthCapacity: number;
  updatedAtTick: number;
}

/** What the yearly recomputation needs to look at. */
export interface ResilienceInput {
  communities: Community[];
  population: number;
  /** Food eaten / food needed, last year. */
  foodRatio: number;
  /** Neighbours not at war that could send help, 0..n. */
  friendlyNeighbours: number;
  /** Land within reach that nobody holds, as a share of what the people works, 0..1. */
  freeLand: number;
  belief: BeliefSystem | undefined;
}

/** Technologies that genuinely change how a shock is absorbed, and what they protect. */
const RESILIENCE_TECHS = {
  food: ["food_preservation", "pottery", "irrigation", "agriculture", "animal_husbandry"],
  health: ["irrigation", "weaving"],
  infrastructure: ["advanced_construction", "wheel", "metal_tools"],
  administration: ["writing", "taxation", "laws"],
} as const;

/** Share of a list of technologies the people has, weighted by how far each one is adopted. */
function adoptedShare(tribe: Tribe, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const id of ids) {
    if (!tribe.techs.includes(id)) continue;
    total += clamp(tribe.techAdoption?.[id] ?? 1, 0, 1);
  }
  return clamp(total / ids.length);
}

/**
 * Recomputes the whole profile. Pure with respect to the world: it reads, it does not change
 * anything, and the same situation always gives the same numbers.
 */
export function computeResilience(tribe: Tribe, input: ResilienceInput, tick: number): ResilienceProfile {
  const { communities, population } = input;
  const settlements = communities.filter((c) => c.settlement);
  const stored = communities.reduce((acc, c) => acc + getResourceAmount(c.stock, "food"), 0);
  const effects = tribeEffects(tribe);
  const capacity = communities.reduce((acc, c) => acc + storageCapacity(c, effects), 1);
  const yearOfFood = Math.max(1, population);

  // What is in the granaries, plus how well this people keeps what it puts there.
  const foodResilience = clamp(
    Math.min(1, stored / yearOfFood) * 0.6 + adoptedShare(tribe, RESILIENCE_TECHS.food) * 0.4,
  );
  // A people living on one thing falls with that one thing.
  const sources = [
    communities.some((c) => c.area.some((cell) => cell.fields > 0)),
    communities.some((c) => c.area.some((cell) => cell.pastures > 0)),
    communities.some((c) => c.area.some((cell) => cell.river || cell.coastal)),
    communities.some((c) => c.area.some((cell) => cell.fauna > 20)),
    settlements.some((c) => (c.settlement?.buildings.market ?? 0) > 0),
    settlements.some((c) => (c.settlement?.buildings.mine ?? 0) + (c.settlement?.buildings.quarry ?? 0) > 0),
  ].filter(Boolean).length;
  const economicDiversity = clamp(sources / 5);

  const administrativeCapacity = clamp(
    (tribe.culture.administrativeCapacity / 100) * 0.4 +
      tribe.stability.order * 0.3 +
      adoptedShare(tribe, RESILIENCE_TECHS.administration) * 0.3 -
      tribe.stability.corruption * 0.2,
  );
  const socialCohesion = clamp(
    tribe.stability.cohesion * 0.5 +
      (tribe.culture.culturalCohesion / 100) * 0.3 +
      (input.belief ? input.belief.cohesionEffect * (tribe.beliefAdherence ?? 0) * 2 : 0) +
      (tribe.culture.cooperation / 100) * 0.2,
  );
  const reserveCapacity = clamp(
    Math.min(1, stored / Math.max(1, capacity)) * 0.6 + Math.min(0.4, capacity / (yearOfFood * 2)),
  );
  // Somewhere to go, and the means to get there.
  const migrationCapacity = clamp(
    input.freeLand * 0.5 + (tribe.status === "nomadic" ? 0.3 : 0.1) + (tribe.culture.exploration / 100) * 0.2,
  );
  const infrastructureQuality = clamp(
    (settlements.reduce((acc, c) => {
      const b = c.settlement?.buildings;
      if (!b) return acc;
      const weighted = b.storehouse * 0.3 + b.well * 0.25 + b.road * 0.15 + b.walls * 0.2 + b.palisade * 0.1;
      return acc + Math.min(1, weighted / 3);
    }, 0) /
      Math.max(1, settlements.length)) *
      0.7 +
      adoptedShare(tribe, RESILIENCE_TECHS.infrastructure) * 0.3,
  );
  const healthCapacity = clamp(
    (settlements.reduce((acc, c) => acc + (c.settlement?.hygiene ?? 0.5), 0) /
      Math.max(1, settlements.length)) *
      0.6 +
      adoptedShare(tribe, RESILIENCE_TECHS.health) * 0.4,
  );
  // Getting back up is about hands, order and somewhere to put them.
  const recoverySpeed = clamp(
    administrativeCapacity * 0.3 +
      socialCohesion * 0.25 +
      infrastructureQuality * 0.25 +
      Math.min(0.2, input.friendlyNeighbours * 0.07),
  );

  return {
    foodResilience: round(foodResilience, 3),
    economicDiversity: round(economicDiversity, 3),
    administrativeCapacity: round(administrativeCapacity, 3),
    socialCohesion: round(socialCohesion, 3),
    reserveCapacity: round(reserveCapacity, 3),
    migrationCapacity: round(migrationCapacity, 3),
    infrastructureQuality: round(infrastructureQuality, 3),
    recoverySpeed: round(recoverySpeed, 3),
    healthCapacity: round(healthCapacity, 3),
    updatedAtTick: tick,
  };
}

/** One number for "how well would this people take a blow", 0..1. */
export function overallResilience(profile: ResilienceProfile): number {
  return round(
    clamp(
      profile.foodResilience * 0.25 +
        profile.economicDiversity * 0.15 +
        profile.socialCohesion * 0.15 +
        profile.administrativeCapacity * 0.15 +
        profile.infrastructureQuality * 0.1 +
        profile.reserveCapacity * 0.1 +
        profile.healthCapacity * 0.1,
    ),
    3,
  );
}

/** What a people does when it is hit. Not a mood: it follows from what it can actually do. */
export type CrisisResponse =
  | "rationing"
  | "migration"
  | "trade"
  | "reform"
  | "repression"
  | "redistribution"
  | "colonisation"
  | "war"
  | "appeal_for_help"
  | "abandon_settlement";

export const CRISIS_RESPONSE_LABELS: Record<CrisisResponse, string> = {
  rationing: "razionamento",
  migration: "migrazione",
  trade: "ricorso al commercio",
  reform: "riforma",
  repression: "repressione",
  redistribution: "redistribuzione",
  colonisation: "colonizzazione",
  war: "guerra",
  appeal_for_help: "richiesta d'aiuto",
  abandon_settlement: "abbandono dell'insediamento",
};

export interface CrisisSituation {
  /** How hard the blow is, 0..1. */
  severity: number;
  /** Neighbours not at war that could be asked, 0..n. */
  friendlyNeighbours: number;
  /** A weaker neighbour within reach whose land would solve the problem. */
  weakerNeighbour: boolean;
}

/**
 * What this people will actually do about it. Deterministic and explainable: the caller gets
 * back the ranked options with the reason each one scored what it did, so the chronicle can
 * say *why* a people rationed instead of marching.
 */
export function rankCrisisResponses(
  tribe: Tribe,
  profile: ResilienceProfile,
  situation: CrisisSituation,
): { response: CrisisResponse; score: number; reason: string }[] {
  const c = tribe.culture;
  const options: { response: CrisisResponse; score: number; reason: string }[] = [
    {
      response: "rationing",
      score: profile.reserveCapacity * 0.6 + profile.administrativeCapacity * 0.4,
      reason: "ci sono scorte da distribuire e chi sappia contarle",
    },
    {
      response: "redistribution",
      score: profile.socialCohesion * 0.6 + (c.cooperation / 100) * 0.4,
      reason: "il gruppo è disposto a dividere quello che resta",
    },
    {
      response: "trade",
      score: Math.min(1, situation.friendlyNeighbours * 0.35) * 0.6 + (c.tradeOpenness / 100) * 0.4,
      reason: "ci sono vicini con cui scambiare",
    },
    {
      response: "appeal_for_help",
      score: Math.min(1, situation.friendlyNeighbours * 0.3) * 0.5 + profile.recoverySpeed * 0.2,
      reason: "qualcuno fuori è disposto ad aiutare",
    },
    {
      response: "migration",
      score: profile.migrationCapacity * 0.7 + (c.exploration / 100) * 0.3,
      reason: "c'è dove andare e la volontà di andarci",
    },
    {
      response: "colonisation",
      score: profile.migrationCapacity * 0.4 + (c.expansionism / 100) * 0.6,
      reason: "conviene fondare altrove invece di resistere qui",
    },
    {
      response: "reform",
      score:
        profile.administrativeCapacity * 0.5 + (c.innovation / 100) * 0.3 - (c.traditionalism / 100) * 0.2,
      reason: "il governo è in grado di cambiare le proprie regole",
    },
    {
      response: "repression",
      score: (c.hierarchy / 100) * 0.4 + (c.centralization / 100) * 0.3 - profile.socialCohesion * 0.3,
      reason: "chi comanda preferisce tenere il coperchio sulla pentola",
    },
    {
      response: "war",
      score: situation.weakerNeighbour
        ? (c.militarism / 100) * 0.5 + situation.severity * 0.3 - profile.foodResilience * 0.3
        : 0,
      reason: "prendere a un vicino più debole costa meno che resistere",
    },
    {
      response: "abandon_settlement",
      score: situation.severity * 0.6 - profile.foodResilience * 0.4 - profile.infrastructureQuality * 0.2,
      reason: "non c'è più niente da salvare dove si è",
    },
  ];
  return options
    .map((o) => ({ ...o, score: round(clamp(o.score), 3) }))
    .sort((a, b) => b.score - a.score || a.response.localeCompare(b.response));
}

/** The single response a people takes. Ties are broken by name, so it is reproducible. */
export function chooseCrisisResponse(
  tribe: Tribe,
  profile: ResilienceProfile,
  situation: CrisisSituation,
): { response: CrisisResponse; score: number; reason: string } {
  const ranked = rankCrisisResponses(tribe, profile, situation);
  return ranked[0] ?? { response: "rationing", score: 0, reason: "non resta altro da fare" };
}

/** Builds the yearly input from the live context. */
export function resilienceInputOf(ctx: SimContext, tribe: Tribe, communities: Community[]): ResilienceInput {
  const population = communities.reduce((acc, c) => acc + c.members.length, 0);
  const rels = ctx.state.relationships.filter((r) => r.aId === tribe.id || r.bId === tribe.id);
  const worked = communities.reduce((acc, c) => acc + c.area.length, 1);
  const free = communities.reduce(
    (acc, c) => acc + c.area.filter((cell) => cell.ownerTribeId === null && cell.habitability > 0.35).length,
    0,
  );
  const belief = tribe.beliefSystemId
    ? ctx.state.beliefs.find((b) => b.id === tribe.beliefSystemId)
    : undefined;
  return {
    communities,
    population,
    foodRatio:
      communities.length === 0
        ? 1
        : communities.reduce((acc, c) => acc + c.foodRatio * c.members.length, 0) / Math.max(1, population),
    friendlyNeighbours: rels.filter((r) => !r.atWar && r.hostility < 0.4 && r.distance <= 12).length,
    freeLand: clamp(free / worked),
    belief,
  };
}
