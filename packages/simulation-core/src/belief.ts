import { nextId, type SimContext } from "./context";
import { culturalDistance } from "./culture";
import { actor, emitEvent } from "./events";
import { cellsInRadius, clamp, distance, round } from "./grid";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { hashFloat } from "./prng";
import type { BeliefSystem, BeliefType, Cell, Relationship, Tribe } from "./types";

/**
 * Systems of belief.
 *
 * Nothing here encodes a real religion. A belief appears among a people that has become
 * spiritual enough to need one, and it takes the shape of what that people has in front of it:
 * a great river, the sun over a desert, mountains, its own dead, a state that wants to be
 * sacred. The historical identity of the people is never read: two peoples on the same river
 * produce the same kind of cult, whatever they are called.
 *
 * Beliefs give cohesion and lend legitimacy to whoever rules. They cost tolerance: the more a
 * belief lends authority, the less easily it lives beside another one.
 */

export const BELIEF_TYPE_LABELS: Record<BeliefType, string> = {
  ancestor_veneration: "culto degli antenati",
  nature_spirituality: "spiritualità della natura",
  river_cult: "culto del fiume",
  solar_cult: "culto solare",
  mountain_cult: "culto della montagna",
  pantheon: "pantheon",
  imperial_cult: "culto dello stato",
  philosophical: "scuola filosofica",
  syncretic: "sincretismo",
};

/**
 * Spirituality below which a people feels no need to give its beliefs a shape. Measured against
 * the real distribution this engine produces (mean ~38, sd ~10), so that most peoples that
 * survive long enough eventually find one, and the coldest-headed never do.
 */
export const BELIEF_MIN_SPIRITUALITY = 46;
/** Smallest group that can sustain a recognised belief with its own specialists. */
export const BELIEF_MIN_POPULATION = 35;
/**
 * Years two peoples must spend in the same undisturbed relationship before their rites blend.
 * `Relationship.phaseYears` resets whenever the pair's phase changes, so this is a demanding
 * counter: a generation of genuinely uneventful neighbourhood.
 */
export const SYNCRETISM_YEARS = 25;
/** How far apart two peoples can live and still see each other's rites. */
export const SYNCRETISM_MAX_DISTANCE = 15;
/** How accommodating both beliefs must already be. */
export const SYNCRETISM_MIN_TOLERANCE = 0.5;
/** How open to outsiders both peoples must be, on the 0..100 culture scale. */
export const SYNCRETISM_MIN_OPENNESS = 35;

export interface BeliefContext {
  /** Land the people works, used to read what is in front of it. */
  area: Cell[];
  population: number;
  settlements: number;
  /** Years the people has spent hungry or at war recently, 0..1. */
  hardship: number;
  atWar: boolean;
}

const share = (cells: Cell[], pick: (c: Cell) => boolean) =>
  cells.length === 0 ? 0 : cells.filter(pick).length / cells.length;

const mean = (cells: Cell[], pick: (c: Cell) => number) =>
  cells.length === 0 ? 0 : cells.reduce((acc, c) => acc + pick(c), 0) / cells.length;

/**
 * The shape a belief takes among this people, read from its land, its institutions and what it
 * has lived through. Pure: the same situation always produces the same kind of cult.
 */
export function beliefTypeFor(tribe: Tribe, context: BeliefContext): BeliefType {
  const { area } = context;
  // A state large enough to need sacred backing makes its own rule the object of the cult.
  if (context.settlements >= 3 && tribe.culture.centralization >= 65 && tribe.culture.hierarchy >= 60) {
    return "imperial_cult";
  }
  // Writing and a settled, curious people turn belief into argument.
  if (
    tribe.techs.includes("writing") &&
    tribe.culture.innovation >= 60 &&
    tribe.culture.traditionalism < 55
  ) {
    return "philosophical";
  }
  if (share(area, (c) => c.river) >= 0.25) return "river_cult";
  if (share(area, (c) => c.biome === "mountain") >= 0.3) return "mountain_cult";
  if (mean(area, (c) => c.temperature) >= 0.7 && share(area, (c) => c.biome === "desert") >= 0.25) {
    return "solar_cult";
  }
  if (context.settlements >= 2 && tribe.culture.hierarchy >= 50) return "pantheon";
  // A people that has suffered turns to the ones who came before it.
  if (context.hardship >= 0.4 || tribe.culture.traditionalism >= 65) return "ancestor_veneration";
  return "nature_spirituality";
}

/** Fixed traits of each shape, before the people's own culture bends them. */
const TYPE_PROFILE: Record<BeliefType, { authority: number; tolerance: number; missionary: number }> = {
  ancestor_veneration: { authority: 0.35, tolerance: 0.7, missionary: 0.15 },
  nature_spirituality: { authority: 0.25, tolerance: 0.8, missionary: 0.1 },
  river_cult: { authority: 0.45, tolerance: 0.6, missionary: 0.25 },
  solar_cult: { authority: 0.6, tolerance: 0.45, missionary: 0.45 },
  mountain_cult: { authority: 0.4, tolerance: 0.6, missionary: 0.2 },
  pantheon: { authority: 0.5, tolerance: 0.65, missionary: 0.35 },
  imperial_cult: { authority: 0.8, tolerance: 0.3, missionary: 0.5 },
  philosophical: { authority: 0.3, tolerance: 0.85, missionary: 0.3 },
  syncretic: { authority: 0.45, tolerance: 0.9, missionary: 0.25 },
};

const PRINCIPLES: Record<BeliefType, readonly string[]> = {
  ancestor_veneration: [
    "i morti restano nel consiglio dei vivi",
    "il nome di chi ci ha preceduto non va perduto",
    "ogni scelta risponde a chi verrà dopo",
  ],
  nature_spirituality: [
    "ogni bosco e ogni sorgente ha una voce",
    "chi prende dalla terra deve restituirle qualcosa",
    "le stagioni insegnano più di qualsiasi capo",
  ],
  river_cult: [
    "il fiume dà e il fiume toglie",
    "la piena è un patto, non un caso",
    "chi sporca l'acqua sporca tutti",
  ],
  solar_cult: [
    "la luce misura il giusto e l'ingiusto",
    "nulla cresce dove il sole è negato",
    "il giorno appartiene a chi lavora",
  ],
  mountain_cult: [
    "l'alto si raggiunge soltanto salendo",
    "la pietra ricorda ciò che gli uomini scordano",
    "chi sfida la vetta torna cambiato",
  ],
  pantheon: [
    "a ogni mestiere corrisponde una potenza",
    "nessuna forza governa da sola",
    "le offerte tengono in equilibrio il mondo",
  ],
  imperial_cult: [
    "chi governa risponde a un ordine più alto",
    "la legge del sovrano è la legge del cielo",
    "servire lo stato è un atto sacro",
  ],
  philosophical: [
    "quello che non regge alla domanda non regge affatto",
    "la misura vale più dell'abbondanza",
    "si insegna discutendo, non comandando",
  ],
  syncretic: [
    "nomi diversi indicano la stessa cosa",
    "ciò che due popoli condividono è più vero di ciò che li divide",
    "ogni rito straniero custodisce una ragione",
  ],
};

/** Deterministic name, built from the people's own name and the shape of the belief. */
function beliefName(seed: string, tribe: Tribe, type: BeliefType): string {
  const forms: Record<BeliefType, string[]> = {
    ancestor_veneration: ["Via degli Avi", "Memoria dei Padri", "Casa dei Nomi"],
    nature_spirituality: ["Voce dei Boschi", "Patto della Terra", "Sentiero Verde"],
    river_cult: ["Culto della Piena", "Signori dell'Acqua", "Patto del Fiume"],
    solar_cult: ["Disco Ardente", "Via del Mezzogiorno", "Occhio del Cielo"],
    mountain_cult: ["Culto della Vetta", "Pietra Alta", "Guardiani del Passo"],
    pantheon: ["Assemblea delle Potenze", "Dodici Nomi", "Corte Celeste"],
    imperial_cult: ["Ordine del Sovrano", "Culto della Corona", "Mandato Supremo"],
    philosophical: ["Scuola della Misura", "Cerchio dei Maestri", "Via della Domanda"],
    syncretic: ["Concordia", "Via Comune", "Doppio Nome"],
  };
  const options = forms[type];
  const pick = options[Math.floor(hashFloat(`${seed}|belief|${tribe.id}|${type}`) * options.length)];
  return `${pick ?? options[0]} ${tribe.name}`.trim();
}

/** Whether a people is ready to give its beliefs a recognised shape. */
export function canFoundBelief(tribe: Tribe, context: BeliefContext): boolean {
  if (tribe.beliefSystemId !== null) return false;
  if (tribe.status === "extinct") return false;
  if (tribe.culture.spirituality < BELIEF_MIN_SPIRITUALITY) return false;
  return context.population >= BELIEF_MIN_POPULATION;
}

export function foundBelief(ctx: SimContext, tribe: Tribe, context: BeliefContext): BeliefSystem | null {
  if (!canFoundBelief(tribe, context)) return null;
  const type = beliefTypeFor(tribe, context);
  const profile = TYPE_PROFILE[type];
  const { id, seq } = nextId(ctx.state, "belief", "bs");
  // The culture bends the fixed profile: a hierarchical people makes its cult more commanding,
  // an open one makes it easier to live with.
  const belief: BeliefSystem = {
    id,
    seq,
    name: beliefName(ctx.state.seed, tribe, type),
    type,
    foundedByTribeId: tribe.id,
    principles: [...PRINCIPLES[type]],
    authority: round(clamp(profile.authority + (tribe.culture.hierarchy / 100 - 0.5) * 0.3), 3),
    tolerance: round(
      clamp(
        profile.tolerance +
          (tribe.culture.tradeOpenness / 100 - 0.5) * 0.4 -
          (tribe.culture.traditionalism / 100 - 0.5) * 0.2,
      ),
      3,
    ),
    missionaryPressure: round(clamp(profile.missionary + (tribe.culture.expansionism / 100 - 0.5) * 0.35), 3),
    cohesionEffect: 0,
    legitimacyEffect: 0,
    conflictRisk: 0,
    createdAtTick: ctx.state.tick,
    createdYear: ctx.state.year,
    parentBeliefIds: [],
    status: "active",
    endedYear: null,
    causeEventId: null,
  };
  applyDerivedEffects(belief);
  ctx.state.beliefs.push(belief);
  tribe.beliefSystemId = belief.id;
  tribe.beliefAdherence = 0.35;
  const event = emitEvent(ctx, {
    type: "belief",
    subtype: "founded",
    importance: 3,
    actors: [actor.tribe(tribe)],
    x: tribe.x,
    y: tribe.y,
    title: `${tribe.name}: nasce ${belief.name}`,
    description: t("Presso {art:people} prende forma {belief}, {kind}: {principle}.", {
      people: peoplePhrase(tribe),
      belief: belief.name,
      kind: BELIEF_TYPE_LABELS[type],
      principle: belief.principles[0] ?? "",
    }),
    metadata: {
      beliefId: belief.id,
      type,
      authority: belief.authority,
      tolerance: belief.tolerance,
      population: context.population,
      spirituality: tribe.culture.spirituality,
    },
  });
  belief.causeEventId = event.id.length > 0 ? event.id : null;
  return belief;
}

/**
 * Cohesion, legitimacy and friction all follow from authority and tolerance: a belief that
 * lends a lot of authority binds its followers hard and sits badly next to anyone else.
 */
export function applyDerivedEffects(belief: BeliefSystem) {
  belief.cohesionEffect = round(clamp(0.05 + belief.authority * 0.15, 0, 0.25), 3);
  belief.legitimacyEffect = round(clamp(belief.authority * 0.2, 0, 0.25), 3);
  belief.conflictRisk = round(clamp((1 - belief.tolerance) * 0.6 + belief.missionaryPressure * 0.4), 3);
}

/** What a people's belief actually adds to its stability, scaled by how deeply it is held. */
export function beliefEffects(
  tribe: Tribe,
  beliefs: ReadonlyMap<string, BeliefSystem>,
): { cohesion: number; legitimacy: number } {
  const belief = tribe.beliefSystemId ? beliefs.get(tribe.beliefSystemId) : undefined;
  if (!belief || belief.status === "extinct") return { cohesion: 0, legitimacy: 0 };
  const adherence = clamp(tribe.beliefAdherence ?? 0, 0, 1);
  return {
    cohesion: round(belief.cohesionEffect * adherence, 4),
    legitimacy: round(belief.legitimacyEffect * adherence, 4),
  };
}

/**
 * How far apart two peoples stand on what they believe, 0..1. Two peoples sharing a belief are
 * at 0; two intolerant peoples with different beliefs are near 1. Used by diplomacy.
 */
export function beliefDistance(a: Tribe, b: Tribe, beliefs: ReadonlyMap<string, BeliefSystem>): number {
  if (a.beliefSystemId === null || b.beliefSystemId === null) return 0;
  if (a.beliefSystemId === b.beliefSystemId) return 0;
  const first = beliefs.get(a.beliefSystemId);
  const second = beliefs.get(b.beliefSystemId);
  if (!first || !second) return 0;
  // Beliefs that share an ancestor recognise each other.
  const related =
    first.parentBeliefIds.includes(second.id) ||
    second.parentBeliefIds.includes(first.id) ||
    first.parentBeliefIds.some((id) => second.parentBeliefIds.includes(id));
  const friction = (first.conflictRisk + second.conflictRisk) / 2;
  return round(clamp(friction * (related ? 0.3 : 1)), 3);
}

/**
 * How firmly a people holds its belief this year. Faith grows with time, spirituality and
 * settled institutions, and is shaken by hunger and by defeat: a cult that does not deliver
 * loses its grip.
 */
export function adherenceDrift(tribe: Tribe, context: BeliefContext): number {
  const pull =
    0.012 +
    (tribe.culture.spirituality / 100) * 0.018 +
    Math.min(0.012, context.settlements * 0.005) +
    tribe.stability.legitimacy * 0.008;
  const strain = context.hardship * 0.05 + (context.atWar ? 0.008 : 0);
  return round(pull - strain, 4);
}

/**
 * Two peoples who have lived beside each other for generations, both tolerant, both believing
 * something, end up recognising each other's rites. The result is a new belief that keeps both
 * parents on record — neither of the originals is erased.
 */
export function canSyncretize(
  a: Tribe,
  b: Tribe,
  rel: Relationship,
  beliefs: ReadonlyMap<string, BeliefSystem>,
): boolean {
  if (a.beliefSystemId === null || b.beliefSystemId === null) return false;
  if (a.beliefSystemId === b.beliefSystemId) return false;
  if (rel.atWar || rel.hostility > 0.3) return false;
  if (rel.lastInteractionYear === null) return false;
  const first = beliefs.get(a.beliefSystemId);
  const second = beliefs.get(b.beliefSystemId);
  if (!first || !second) return false;
  if (first.status !== "active" || second.status !== "active") return false;
  // Conversion and syncretism are two answers to the same meeting, and they do not compete: a
  // people whose faith is thin takes up its neighbour's (see `conversionChance`), while two
  // peoples who both hold firmly cannot convert each other — those are the ones whose rites
  // blend. Measured: with conversion added and no such split, syncretism fell to zero.
  if (clamp(a.beliefAdherence ?? 0) <= CONVERSION_MAX_HOLD) return false;
  if (clamp(b.beliefAdherence ?? 0) <= CONVERSION_MAX_HOLD) return false;
  // Both sides must be open enough to admit the other is talking about the same thing.
  if (first.tolerance < SYNCRETISM_MIN_TOLERANCE || second.tolerance < SYNCRETISM_MIN_TOLERANCE) {
    return false;
  }
  // This engine has no `tolerance` culture trait: openness to trade stands in for it, and a
  // very traditional people resists recognising a foreign rite as its own. The threshold is
  // read against the distribution this engine actually produces (openness averages ~32), not
  // against the 0..100 scale.
  if (a.culture.tradeOpenness < SYNCRETISM_MIN_OPENNESS) return false;
  if (b.culture.tradeOpenness < SYNCRETISM_MIN_OPENNESS) return false;
  if (a.culture.traditionalism > 75 || b.culture.traditionalism > 75) return false;
  // Deliberately not a trust threshold. In this engine trust only accumulates through active
  // trade, and two peoples can sit side by side at peace for three centuries with trust at
  // zero — which is exactly the situation in which rites blend. What matters is that they have
  // been neighbours, unbothered by each other, for generations.
  return true;
}

function syncretize(
  ctx: SimContext,
  a: Tribe,
  b: Tribe,
  first: BeliefSystem,
  second: BeliefSystem,
): BeliefSystem {
  const { id, seq } = nextId(ctx.state, "belief", "bs");
  const parents = [first, second].sort((x, y) => x.seq - y.seq);
  const avg = (pick: (x: BeliefSystem) => number) => round((pick(first) + pick(second)) / 2, 3);
  const belief: BeliefSystem = {
    id,
    seq,
    name: `Concordia ${parents[0]!.name.split(" ").slice(-1)[0]}-${parents[1]!.name.split(" ").slice(-1)[0]}`,
    type: "syncretic",
    foundedByTribeId: a.id,
    principles: [
      ...PRINCIPLES.syncretic,
      ...(parents[0]!.principles[0] ? [parents[0]!.principles[0]] : []),
      ...(parents[1]!.principles[0] ? [parents[1]!.principles[0]] : []),
    ],
    authority: avg((x) => x.authority),
    // A belief born of recognising another one is, by construction, easier to live beside.
    tolerance: round(clamp(avg((x) => x.tolerance) + 0.1), 3),
    missionaryPressure: round(clamp(avg((x) => x.missionaryPressure) - 0.05), 3),
    cohesionEffect: 0,
    legitimacyEffect: 0,
    conflictRisk: 0,
    createdAtTick: ctx.state.tick,
    createdYear: ctx.state.year,
    parentBeliefIds: parents.map((p) => p.id),
    status: "active",
    endedYear: null,
    causeEventId: null,
  };
  applyDerivedEffects(belief);
  ctx.state.beliefs.push(belief);
  // The parents are not deleted: they are recorded as having flowed into the new one.
  for (const parent of parents) {
    parent.status = "absorbed";
    parent.endedYear = ctx.state.year;
  }
  for (const tribe of ctx.state.tribes) {
    if (tribe.beliefSystemId === first.id || tribe.beliefSystemId === second.id) {
      tribe.beliefSystemId = belief.id;
      tribe.beliefAdherence = round(clamp((tribe.beliefAdherence ?? 0) * 0.8), 3);
    }
  }
  const event = emitEvent(ctx, {
    type: "belief",
    subtype: "syncretism",
    importance: 4,
    actors: [actor.tribe(a), actor.tribe(b)],
    x: a.x,
    y: a.y,
    title: `${belief.name}: due culti diventano uno`,
    description: t(
      "Dopo generazioni di vicinanza, {art:first} e {art:second} riconoscono negli stessi gesti due nomi diversi: {a} e {b} confluiscono in {belief}.",
      {
        first: peoplePhrase(a),
        second: peoplePhrase(b),
        a: parents[0]!.name,
        b: parents[1]!.name,
        belief: belief.name,
      },
    ),
    metadata: {
      beliefId: belief.id,
      parentBeliefIds: belief.parentBeliefIds,
      tribeIds: [a.id, b.id],
      tolerance: belief.tolerance,
    },
  });
  belief.causeEventId = event.id.length > 0 ? event.id : null;
  return belief;
}

/**
 * Step 12b: one year of belief. Peoples that need one find one, faith rises and falls with what
 * the year brought, long-tolerant neighbours blend their cults, and a belief whose last
 * followers are gone is recorded as ended.
 */
export function updateBeliefs(ctx: SimContext, contexts: ReadonlyMap<string, BeliefContext>) {
  const { state } = ctx;
  const beliefs = new Map(state.beliefs.map((b) => [b.id, b]));
  const alive = state.tribes.filter((tr) => tr.status !== "extinct");

  for (const tribe of alive) {
    const context = contexts.get(tribe.id);
    if (!context) continue;
    if (tribe.beliefSystemId === null) {
      // A belief does not appear the year it could: it takes a generation to take shape, and
      // the more spiritual the people the sooner that happens.
      const readiness = 0.03 + (tribe.culture.spirituality / 100) * 0.06;
      if (canFoundBelief(tribe, context) && ctx.rng.chance(readiness)) foundBelief(ctx, tribe, context);
      continue;
    }
    const belief = beliefs.get(tribe.beliefSystemId);
    if (!belief || belief.status === "extinct") {
      tribe.beliefSystemId = null;
      tribe.beliefAdherence = 0;
      continue;
    }
    tribe.beliefAdherence = round(
      clamp((tribe.beliefAdherence ?? 0) + adherenceDrift(tribe, context), 0, 1),
      3,
    );
    // Faith that has drained away leaves the people without a belief again.
    if (tribe.beliefAdherence <= 0.02) {
      emitEvent(ctx, {
        type: "belief",
        subtype: "abandoned",
        importance: 3,
        actors: [actor.tribe(tribe)],
        x: tribe.x,
        y: tribe.y,
        title: `${tribe.name} abbandona ${belief.name}`,
        description: t("Presso {art:people} nessuno pratica più i riti {di:belief}.", {
          people: peoplePhrase(tribe),
          belief: { text: belief.name, gender: "f", number: "sg" },
        }),
        metadata: { beliefId: belief.id, type: belief.type },
      });
      tribe.beliefSystemId = null;
      tribe.beliefAdherence = 0;
    }
  }

  // Missionaries: a belief that pushes outward reaches the neighbours it is in contact with.
  for (const rel of state.relationships) {
    if (rel.atWar || rel.distance > MISSION_MAX_DISTANCE) continue;
    const a = ctx.tribes.get(rel.aId);
    const b = ctx.tribes.get(rel.bId);
    if (!a || !b || a.status === "extinct" || b.status === "extinct") continue;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const belief = from.beliefSystemId ? beliefs.get(from.beliefSystemId) : undefined;
      if (!belief || belief.status !== "active") continue;
      const chance = conversionChance(from, to, belief, rel);
      if (chance <= 0 || !ctx.rng.chance(chance)) continue;
      convert(ctx, to, from, belief);
    }
  }

  // Schism: a people that holds a belief it no longer recognises makes its own of it.
  for (const tribe of alive) {
    const belief = tribe.beliefSystemId ? beliefs.get(tribe.beliefSystemId) : undefined;
    if (!belief || belief.status !== "active") continue;
    const chance = schismChance(ctx, tribe, belief);
    if (chance <= 0 || !ctx.rng.chance(chance)) continue;
    const splinter = schism(ctx, tribe, belief);
    beliefs.set(splinter.id, splinter);
  }

  // Syncretism: only between neighbours who have been at peace long enough.
  for (const rel of state.relationships) {
    if (rel.phaseYears < SYNCRETISM_YEARS) continue;
    const a = ctx.tribes.get(rel.aId);
    const b = ctx.tribes.get(rel.bId);
    if (!a || !b || a.status === "extinct" || b.status === "extinct") continue;
    if (distance(a.x, a.y, b.x, b.y) > SYNCRETISM_MAX_DISTANCE) continue;
    if (!canSyncretize(a, b, rel, beliefs)) continue;
    if (!ctx.rng.chance(0.06)) continue;
    const first = beliefs.get(a.beliefSystemId as string);
    const second = beliefs.get(b.beliefSystemId as string);
    if (!first || !second) continue;
    const blended = syncretize(ctx, a, b, first, second);
    beliefs.set(blended.id, blended);
  }

  // A belief nobody follows any more is closed, never removed.
  for (const belief of state.beliefs) {
    if (belief.status !== "active") continue;
    const followers = alive.some((tr) => tr.beliefSystemId === belief.id);
    if (followers) continue;
    belief.status = "extinct";
    belief.endedYear = state.year;
  }
}

/** Working area and pressures of a people, as the belief step needs them. */
export function beliefContextOf(
  ctx: SimContext,
  tribe: Tribe,
  communities: { x: number; y: number; radius: number; settlement: unknown; foodRatio: number }[],
  atWar: boolean,
): BeliefContext {
  const area = communities.flatMap((c) => cellsInRadius(ctx.state, c.x, c.y, c.radius));
  const population = ctx.state.people.reduce(
    (acc, p) => acc + (p.alive && p.tribeId === tribe.id ? 1 : 0),
    0,
  );
  const foodRatio = communities.length
    ? communities.reduce((acc, c) => acc + c.foodRatio, 0) / communities.length
    : 1;
  return {
    area,
    population,
    settlements: communities.filter((c) => c.settlement).length,
    hardship: round(clamp(1 - foodRatio + Math.min(0.4, tribe.scarcityYears * 0.12)), 3),
    atWar,
  };
}

// --- Missionaries and schisms ------------------------------------------------------------------

/** Farthest a belief travels by preaching rather than by living side by side. */
export const MISSION_MAX_DISTANCE = 12;

/**
 * Yearly chance that `to` takes up the belief `from` preaches.
 *
 * A belief only travels if it pushes (`missionaryPressure`), and it lands where there is room
 * for it: a people with no belief of its own, or one whose faith has grown thin. A traditional
 * people resists, a tolerant and open one listens, and a hostile neighbour is not listened to
 * at all.
 */
export function conversionChance(from: Tribe, to: Tribe, belief: BeliefSystem, rel: Relationship): number {
  if (to.beliefSystemId === belief.id) return 0;
  // Nobody abandons a faith they still hold firmly.
  const hold = to.beliefSystemId === null ? 0 : clamp(to.beliefAdherence ?? 0);
  if (hold > CONVERSION_MAX_HOLD) return 0;
  const openness =
    (to.culture.tolerance / 100) * 0.5 +
    (to.culture.tradeOpenness / 100) * 0.3 -
    (to.culture.traditionalism / 100) * 0.4;
  const welcome = clamp(rel.trust * 0.5 + (1 - rel.hostility) * 0.5);
  const pressure = belief.missionaryPressure * clamp(from.beliefAdherence ?? 0);
  return round(clamp(pressure * (0.25 + openness) * welcome * (1 - hold) * 0.06, 0, 0.05), 4);
}

/** Above this much faith in what it already believes, a people does not convert. */
export const CONVERSION_MAX_HOLD = 0.5;

function convert(ctx: SimContext, to: Tribe, from: Tribe, belief: BeliefSystem) {
  const previousId = to.beliefSystemId;
  const previous = previousId ? ctx.state.beliefs.find((b) => b.id === previousId) : undefined;
  to.beliefSystemId = belief.id;
  // A faith just taken up is not yet deeply held.
  to.beliefAdherence = 0.2;
  emitEvent(ctx, {
    type: "belief",
    subtype: "conversion",
    importance: 3,
    actors: [actor.tribe(to), actor.tribe(from)],
    x: to.x,
    y: to.y,
    title: `${to.name} accoglie ${belief.name}`,
    description: t(
      "I predicatori {di:from} hanno convinto {art:to}{leaving}: ora {v:to:segue|seguono} {belief}.",
      {
        from: peoplePhrase(from),
        to: peoplePhrase(to),
        leaving: previous ? ` ad abbandonare ${previous.name}` : "",
        belief: belief.name,
      },
    ),
    metadata: {
      beliefId: belief.id,
      fromTribeId: from.id,
      previousBeliefId: previousId,
      missionaryPressure: belief.missionaryPressure,
    },
  });
}

/**
 * Yearly chance that a people breaks its own belief in two. It needs a reason to: a cult that
 * demands much and tolerates little, held by a people whose order has gone and whose ways have
 * drifted from those of the people that founded it.
 */
export function schismChance(ctx: SimContext, tribe: Tribe, belief: BeliefSystem): number {
  // The founders do not split from themselves, and a belief nobody else follows cannot schism.
  if (belief.foundedByTribeId === tribe.id) return 0;
  if ((tribe.beliefAdherence ?? 0) < 0.3) return 0;
  const founder = ctx.tribes.get(belief.foundedByTribeId);
  const drift = founder ? culturalDistance(tribe.culture, founder.culture) : 0.5;
  const strain = clamp(
    belief.authority * 0.4 + (1 - belief.tolerance) * 0.3 + (1 - tribe.stability.order) * 0.3,
  );
  return round(clamp(drift * strain * 0.02, 0, 0.02), 4);
}

/**
 * The splinter keeps the parent on record and inherits its shape, harder and less accommodating:
 * a people that breaks away over how a thing should be practised does not become more relaxed
 * about it. The parent belief is untouched — its other followers keep it.
 */
function schism(ctx: SimContext, tribe: Tribe, parent: BeliefSystem): BeliefSystem {
  const { id, seq } = nextId(ctx.state, "belief", "bs");
  const belief: BeliefSystem = {
    id,
    seq,
    name: `${parent.name.split(" ")[0]} di ${tribe.name}`,
    type: parent.type,
    foundedByTribeId: tribe.id,
    principles: [...parent.principles],
    authority: round(clamp(parent.authority + 0.1), 3),
    tolerance: round(clamp(parent.tolerance - 0.25), 3),
    missionaryPressure: round(clamp(parent.missionaryPressure + 0.1), 3),
    cohesionEffect: 0,
    legitimacyEffect: 0,
    conflictRisk: 0,
    createdAtTick: ctx.state.tick,
    createdYear: ctx.state.year,
    parentBeliefIds: [parent.id],
    status: "active",
    endedYear: null,
    causeEventId: null,
  };
  applyDerivedEffects(belief);
  ctx.state.beliefs.push(belief);
  tribe.beliefSystemId = belief.id;
  const event = emitEvent(ctx, {
    type: "belief",
    subtype: "schism",
    importance: 4,
    actors: [actor.tribe(tribe)],
    x: tribe.x,
    y: tribe.y,
    title: `Scisma: nasce ${belief.name}`,
    description: t(
      "{Art:people} non {v:people:riconosce|riconoscono} più il modo in cui {parent} viene praticata altrove: da qui in poi {v:people:segue|seguono} {belief}.",
      { people: peoplePhrase(tribe), parent: parent.name, belief: belief.name },
    ),
    metadata: {
      beliefId: belief.id,
      parentBeliefId: parent.id,
      authority: belief.authority,
      tolerance: belief.tolerance,
    },
  });
  belief.causeEventId = event.id.length > 0 ? event.id : null;
  return belief;
}
