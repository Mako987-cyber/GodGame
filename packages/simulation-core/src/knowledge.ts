import { activeAgreements } from "./agreements";
import type { SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { clamp, round } from "./grid";
import { formatEventDescription as t, polityPhrase } from "./language/format";
import { hashFloat } from "./prng";
import { byKnowledge } from "./serialization";
import { shareKnowledge } from "./technology";
import type { CivilizationKnowledge, KnowledgeEstimate, KnowledgeSource, Relationship, Tribe } from "./types";

/**
 * What one people believes about another.
 *
 * The engine always knows the truth; peoples do not. Each people builds, for every other one it
 * has met, a record of estimates — how many they are, how strong, how orderly, what they use,
 * whether they mean harm — each with a confidence, a year and a source. Estimates age every
 * year they are not refreshed, and they can be plainly wrong: the error grows as confidence
 * falls, and a spy who was fed false information brings home a confident mistake.
 *
 * The error is deterministic: it comes from hashing the seed with the pair, the kind of fact and
 * the year, so it costs nothing in the simulation RNG and is identical on every replay.
 */

/** How much of its confidence an estimate keeps each year it is not refreshed. */
export const KNOWLEDGE_DECAY = 0.92;
/** Below this, an estimate is no longer knowledge: it is forgotten. */
export const KNOWLEDGE_FORGET = 0.04;
/** Largest relative error an estimate can carry, reached at confidence 0. */
export const MAX_ESTIMATE_ERROR = 0.8;

export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSource, string> = {
  exploration: "esploratori",
  trade: "mercanti",
  diplomat: "ambasciatori",
  spy: "spie",
  battle: "campo di battaglia",
  rumor: "voci",
};

/** Truth a refresh is based on. Read by the caller, never exposed by this module's outputs. */
export interface KnowledgeTruth {
  population: number;
  military: number;
  stability: number;
  x: number;
  y: number;
  /** Technologies actually in visible use (adoption at least half). */
  visibleTechnologies: string[];
  hostile: boolean;
}

export function knowledgeKey(observerId: string, targetId: string): string {
  return `${observerId}>${targetId}`;
}

export function emptyKnowledge(observerId: string, targetId: string, year: number): CivilizationKnowledge {
  return {
    observerId,
    targetId,
    location: null,
    population: null,
    military: null,
    stability: null,
    technologies: null,
    intent: null,
    spyAttempts: 0,
    spiesCaught: 0,
    updatedYear: year,
  };
}

/**
 * A noisy reading of a true value. At full confidence it is exact; at zero it can be off by up
 * to `MAX_ESTIMATE_ERROR` in either direction. `bias` pushes the error one way (a deceived spy).
 */
export function estimate(
  seed: string,
  observerId: string,
  targetId: string,
  kind: string,
  year: number,
  truth: number,
  confidence: number,
  bias = 0,
): number {
  const noise = hashFloat(`${seed}|knowledge|${observerId}|${targetId}|${kind}|${year}`) * 2 - 1;
  const error = (noise * (1 - confidence) + bias) * MAX_ESTIMATE_ERROR;
  return round(Math.max(0, truth * (1 + error)), 2);
}

function reading(
  seed: string,
  k: CivilizationKnowledge,
  kind: "population" | "military" | "stability",
  truth: number,
  confidence: number,
  year: number,
  source: KnowledgeSource,
  bias = 0,
): KnowledgeEstimate {
  const value = estimate(seed, k.observerId, k.targetId, kind, year, truth, confidence, bias);
  return {
    value: kind === "stability" ? round(clamp(value), 3) : value,
    confidence: round(clamp(confidence), 3),
    year,
    source,
  };
}

/** Replaces an estimate only when the new one is at least as trustworthy as what is left of the old. */
function better(current: KnowledgeEstimate | null, next: KnowledgeEstimate): KnowledgeEstimate {
  if (!current) return next;
  return next.confidence >= current.confidence ? next : current;
}

/** How a people learns about another in one year, from whatever contact they actually had. */
export interface ContactChannels {
  /** Close enough to see each other at all. */
  contact: boolean;
  /** Distance between them, in cells. */
  distance: number;
  trade: boolean;
  /** Any standing pact: ambassadors come and go. */
  diplomats: boolean;
  /** They fought this year. */
  battle: boolean;
}

/**
 * Refreshes what `observer` knows about the target from the channels it had this year. Pure
 * with respect to the world: it only writes to the knowledge record it is given.
 */
export function refreshKnowledge(
  seed: string,
  k: CivilizationKnowledge,
  observer: Tribe,
  truth: KnowledgeTruth,
  channels: ContactChannels,
  year: number,
) {
  const exploration = observer.culture.exploration / 100;
  if (channels.contact) {
    // Scouts see where people live and roughly how many there are; farther means vaguer.
    k.location = { x: truth.x, y: truth.y, year };
    const seen = clamp(0.2 + exploration * 0.35 - channels.distance * 0.012);
    k.population = better(
      k.population,
      reading(seed, k, "population", truth.population, seen, year, "exploration"),
    );
  }
  if (channels.trade) {
    // Merchants count heads, see which tools are in use and hear how things are going.
    k.population = better(k.population, reading(seed, k, "population", truth.population, 0.6, year, "trade"));
    k.stability = better(k.stability, reading(seed, k, "stability", truth.stability, 0.45, year, "trade"));
    k.technologies = { ids: [...truth.visibleTechnologies].sort(), confidence: 0.7, year, source: "trade" };
  }
  if (channels.diplomats) {
    k.stability = better(k.stability, reading(seed, k, "stability", truth.stability, 0.7, year, "diplomat"));
    k.intent = { hostile: truth.hostile, confidence: 0.75, year, source: "diplomat" };
  }
  if (channels.battle) {
    // Nothing measures an army like facing it.
    k.military = better(k.military, reading(seed, k, "military", truth.military, 0.85, year, "battle"));
    k.intent = { hostile: true, confidence: 0.95, year, source: "battle" };
  }
  k.updatedYear = year;
}

/** One year of forgetting. Estimates nobody refreshed lose confidence and eventually vanish. */
export function ageKnowledge(k: CivilizationKnowledge, year: number) {
  const age = (e: KnowledgeEstimate | null): KnowledgeEstimate | null => {
    if (!e || e.year === year) return e;
    const confidence = round(e.confidence * KNOWLEDGE_DECAY, 3);
    // What is only half-remembered becomes hearsay.
    return confidence < KNOWLEDGE_FORGET
      ? null
      : { ...e, confidence, source: confidence < 0.2 ? "rumor" : e.source };
  };
  k.population = age(k.population);
  k.military = age(k.military);
  k.stability = age(k.stability);
  if (k.technologies && k.technologies.year !== year) {
    const confidence = round(k.technologies.confidence * KNOWLEDGE_DECAY, 3);
    k.technologies = confidence < KNOWLEDGE_FORGET ? null : { ...k.technologies, confidence };
  }
  if (k.intent && k.intent.year !== year) {
    const confidence = round(k.intent.confidence * KNOWLEDGE_DECAY, 3);
    k.intent = confidence < KNOWLEDGE_FORGET ? null : { ...k.intent, confidence };
  }
}

/**
 * Yearly chance that a people actually sends agents to a rival it wants to watch. Kept low on
 * purpose: measured at the first calibration, a few percent a year per pair produced hundreds of
 * attempts per century, and every caught spy raised hostility, which bred more spying.
 */
export function spyEffort(observer: Tribe): number {
  return round(
    0.006 +
      (observer.culture.hierarchy / 100) * 0.01 +
      (observer.culture.administrativeCapacity / 100) * 0.006,
    4,
  );
}

/** Whether `observer` wants to spy on the target at all: rivals and enemies, not friends. */
export function wantsToSpy(observer: Tribe, rel: Relationship): boolean {
  if (rel.atWar) return true;
  return rel.hostility > 0.4 || rel.phase === "tension" || rel.phase === "threat";
}

/**
 * Chance that a spying attempt succeeds. A hierarchical, centralised people has the officials
 * to run agents; a target with order and a wary eye catches more of them.
 */
export function spySuccessChance(observer: Tribe, target: Tribe): number {
  const craft =
    (observer.culture.hierarchy / 100) * 0.3 + (observer.culture.administrativeCapacity / 100) * 0.3;
  const vigilance = target.stability.order * 0.3 + (target.culture.militarism / 100) * 0.15;
  return round(clamp(0.3 + craft - vigilance, 0.05, 0.9), 3);
}

/**
 * One spying attempt. Success brings back confident, accurate estimates — and a little of the
 * target's know-how. Failure brings back a confident mistake, and if the spy is caught the
 * target knows it and holds it against the observer.
 */
export function attemptEspionage(
  ctx: SimContext,
  k: CivilizationKnowledge,
  observer: Tribe,
  target: Tribe,
  truth: KnowledgeTruth,
  rel: Relationship,
): "success" | "deceived" | "caught" {
  const { seed, year } = ctx.state;
  k.spyAttempts += 1;
  const roll = ctx.rng.next();
  const chance = spySuccessChance(observer, target);
  if (roll < chance) {
    k.military = reading(seed, k, "military", truth.military, 0.8, year, "spy");
    k.stability = reading(seed, k, "stability", truth.stability, 0.8, year, "spy");
    k.technologies = { ids: [...truth.visibleTechnologies].sort(), confidence: 0.8, year, source: "spy" };
    k.intent = { hostile: truth.hostile, confidence: 0.8, year, source: "spy" };
    // What was seen in the target's workshops can be copied, at least in part.
    shareKnowledge(ctx, target, observer, 0.03);
    return "success";
  }
  // The spy was fed a story: confident, and wrong in the direction that suits the target.
  if (roll < chance + (1 - chance) * 0.5) {
    const bias = truth.hostile ? -0.6 : 0.6;
    k.military = reading(seed, k, "military", truth.military, 0.6, year, "spy", bias);
    return "deceived";
  }
  k.spiesCaught += 1;
  rel.hostility = round(clamp(rel.hostility + 0.06), 3);
  rel.trust = round(clamp(rel.trust - 0.06), 3);
  emitEvent(ctx, {
    type: "intelligence",
    subtype: "spy_caught",
    // Minor news: measured at 6–8% of the important chronicle when it was 3.
    importance: 2,
    actors: [actor.tribe(target), actor.tribe(observer)],
    x: target.x,
    y: target.y,
    title: `${target.name} scopre le spie di ${observer.name}`,
    description: t("{Art:target} {v:target:ha|hanno} scoperto informatori al servizio {di:observer}.", {
      target: polityPhrase(target, ctx.state.civilizations),
      observer: polityPhrase(observer, ctx.state.civilizations),
    }),
    metadata: {
      observerId: observer.id,
      targetId: target.id,
      attempts: k.spyAttempts,
      caught: k.spiesCaught,
      successChance: chance,
    },
  });
  return "caught";
}

/** The truth about a people, as far as anyone could ever find out. */
export function truthOf(
  ctx: SimContext,
  tribe: Tribe,
  profile: { population: number; power: number },
  towards: Relationship | undefined,
): KnowledgeTruth {
  return {
    population: profile.population,
    military: round(profile.power, 2),
    stability: round(tribe.stability.order, 3),
    x: tribe.x,
    y: tribe.y,
    visibleTechnologies: tribe.techs.filter((id) => (tribe.techAdoption?.[id] ?? 1) >= 0.5),
    hostile: towards
      ? towards.atWar || towards.hostility > 0.5 || towards.phase === "threat" || towards.phase === "raid"
      : false,
  };
}

/** Largest distance at which two peoples notice each other at all. */
export const SIGHT_DISTANCE = 14;

/**
 * Step 13c: one year of learning and forgetting. For every pair in contact, each side refreshes
 * what it knows about the other from the channels it actually had; rivals may send spies; and
 * everything nobody refreshed ages.
 */
export function updateKnowledge(
  ctx: SimContext,
  profiles: ReadonlyMap<string, { tribe: Tribe; population: number; power: number }>,
) {
  const { state } = ctx;
  const byKey = new Map(state.knowledge.map((k) => [knowledgeKey(k.observerId, k.targetId), k]));
  const recordFor = (observerId: string, targetId: string) => {
    const key = knowledgeKey(observerId, targetId);
    let k = byKey.get(key);
    if (!k) {
      k = emptyKnowledge(observerId, targetId, state.year);
      state.knowledge.push(k);
      byKey.set(key, k);
    }
    return k;
  };

  for (const rel of state.relationships) {
    const a = profiles.get(rel.aId);
    const b = profiles.get(rel.bId);
    if (!a || !b) continue;
    if (rel.distance > SIGHT_DISTANCE) continue;
    const pacts = activeAgreements(ctx, a.tribe.id, b.tribe.id).length > 0;
    const channels: ContactChannels = {
      contact: true,
      distance: rel.distance,
      trade: rel.tradeVolume > 10 && !rel.atWar,
      diplomats: pacts && !rel.atWar,
      battle: rel.lastConflictYear === state.year,
    };
    for (const [observer, target] of [
      [a, b],
      [b, a],
    ] as const) {
      const k = recordFor(observer.tribe.id, target.tribe.id);
      const truth = truthOf(ctx, target.tribe, target, rel);
      refreshKnowledge(state.seed, k, observer.tribe, truth, channels, state.year);
      if (!wantsToSpy(observer.tribe, rel)) continue;
      // Nobody sends agents to learn what it already knows well.
      if ((k.military?.confidence ?? 0) >= 0.5) continue;
      // Agents take officials and a reason: a rare undertaking, not a yearly routine.
      if (!ctx.rng.chance(spyEffort(observer.tribe))) continue;
      attemptEspionage(ctx, k, observer.tribe, target.tribe, truth, rel);
    }
  }

  for (const k of state.knowledge) ageKnowledge(k, state.year);
  // New records were appended: restore the canonical order a reload would produce.
  state.knowledge.sort(byKnowledge);
}

/**
 * What the observer can say about the target, and nothing more. This is what an API filtered by
 * observer returns: every number here comes from the knowledge record, never from the target.
 */
export interface KnowledgeView {
  targetId: string;
  lastSeen: { x: number; y: number; year: number } | null;
  population: KnowledgeEstimate | null;
  military: KnowledgeEstimate | null;
  stability: KnowledgeEstimate | null;
  technologies: { ids: string[]; confidence: number; year: number; source: KnowledgeSource } | null;
  intent: { hostile: boolean; confidence: number; year: number; source: KnowledgeSource } | null;
  /** Years since anything about them was refreshed. */
  staleness: number;
}

export function viewOf(k: CivilizationKnowledge, year: number): KnowledgeView {
  return {
    targetId: k.targetId,
    lastSeen: k.location ? { ...k.location } : null,
    population: k.population ? { ...k.population } : null,
    military: k.military ? { ...k.military } : null,
    stability: k.stability ? { ...k.stability } : null,
    technologies: k.technologies ? { ...k.technologies, ids: [...k.technologies.ids] } : null,
    intent: k.intent ? { ...k.intent } : null,
    staleness: Math.max(0, year - k.updatedYear),
  };
}

/** Knowledge index of one tick, built once and shared by every decision taken in it. */
const indexCache = new WeakMap<SimContext, { tick: number; map: Map<string, CivilizationKnowledge> }>();

export function knowledgeIndex(ctx: SimContext): Map<string, CivilizationKnowledge> {
  const cached = indexCache.get(ctx);
  if (cached && cached.tick === ctx.state.tick) return cached.map;
  const map = new Map(ctx.state.knowledge.map((k) => [knowledgeKey(k.observerId, k.targetId), k]));
  indexCache.set(ctx, { tick: ctx.state.tick, map });
  return map;
}

/**
 * How strong the observer BELIEVES the target is. This, not the truth, is what a people decides
 * on: a spy fed a comforting story leads to a war that goes badly — the battle itself is then
 * resolved on real strength.
 *
 * Without a military estimate it scales its population estimate by its own strength per head
 * (it assumes they are like itself); knowing nothing at all, it prudently assumes an equal.
 */
export function perceivedPower(
  ctx: SimContext,
  observer: { tribe: Tribe; power: number; population: number },
  target: { tribe: Tribe },
): number {
  const k = knowledgeIndex(ctx).get(knowledgeKey(observer.tribe.id, target.tribe.id));
  if (k?.military) return k.military.value;
  if (k?.population) return k.population.value * (observer.power / Math.max(1, observer.population));
  return observer.power;
}
