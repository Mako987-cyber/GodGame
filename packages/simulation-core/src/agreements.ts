import { nextId, type SimContext } from "./context";
import { related } from "./population";
import { actor, emitEvent } from "./events";
import { clamp, round } from "./grid";
import { formatEventDescription as t, peoplePhrase, polityPhrase } from "./language/format";
import { byReputation } from "./serialization";
import { np, type Gender, type NounPhrase } from "./language/italian";
import type {
  DiplomaticAgreement,
  Person,
  DiplomaticAgreementType,
  DiplomaticReputation,
  Relationship,
  Tribe,
} from "./types";

/**
 * Explicit pacts and the record a people builds by keeping or breaking them.
 *
 * `Relationship` already says how two peoples feel about each other. This says what they have
 * actually signed, and how each of them has behaved about it — a different thing: a people can
 * be liked and still be known for breaking its word, and the two must not be collapsed.
 *
 * Reputation is built only from what happened. Nothing here reads the historical identity.
 */

/**
 * Italian label of each pact, with its gender: the generated sentences run these through the
 * noun-phrase machinery, so it reads "la garanzia d'indipendenza" and "l'alleanza difensiva",
 * never "il garanzia" or "un alleanza".
 */
const AGREEMENT_NOUNS: Record<DiplomaticAgreementType, { text: string; gender: Gender }> = {
  trade: { text: "accordo commerciale", gender: "m" },
  non_aggression: { text: "patto di non aggressione", gender: "m" },
  defensive_alliance: { text: "alleanza difensiva", gender: "f" },
  military_alliance: { text: "alleanza militare", gender: "f" },
  passage: { text: "diritto di passaggio", gender: "m" },
  tribute: { text: "tributo", gender: "m" },
  technology_exchange: { text: "scambio di conoscenze", gender: "m" },
  independence_guarantee: { text: "garanzia d'indipendenza", gender: "f" },
  embargo: { text: "embargo", gender: "m" },
  peace: { text: "trattato di pace", gender: "m" },
  dynastic_marriage: { text: "matrimonio dinastico", gender: "m" },
};

export const AGREEMENT_LABELS: Record<DiplomaticAgreementType, string> = Object.fromEntries(
  (Object.keys(AGREEMENT_NOUNS) as DiplomaticAgreementType[]).map((k) => [k, AGREEMENT_NOUNS[k].text]),
) as Record<DiplomaticAgreementType, string>;

/** The pact as a noun phrase, so articles and prepositions agree with it. */
export function agreementPhrase(type: DiplomaticAgreementType): NounPhrase {
  const noun = AGREEMENT_NOUNS[type];
  return np(noun.text, noun.gender, "sg");
}

/** "un accordo commerciale", "una garanzia d'indipendenza", "un'alleanza difensiva". */
export function indefiniteAgreement(type: DiplomaticAgreementType): string {
  const noun = AGREEMENT_NOUNS[type];
  if (noun.gender === "f") return `${/^[aeiou]/i.test(noun.text) ? "un'" : "una "}${noun.text}`;
  return `un ${noun.text}`;
}

/** What each kind of pact asks of the pair before it can be signed, and how long it runs. */
interface AgreementRule {
  /** Trust the pair needs. Deliberately read against what this engine produces, not 0..1 ideals. */
  minTrust: number;
  /** Hostility above which nobody signs. */
  maxHostility: number;
  /** Years it runs; null for open-ended. */
  duration: number | null;
  /** Extra condition on the pair. */
  allows?: (rel: Relationship, a: Tribe, b: Tribe) => boolean;
}

const RULES: Record<DiplomaticAgreementType, AgreementRule> = {
  // Trade is the easy one: it needs traffic, not affection.
  trade: {
    minTrust: 0.08,
    maxHostility: 0.45,
    duration: 40,
    allows: (rel) => rel.tradeVolume > 5,
  },
  non_aggression: { minTrust: 0.12, maxHostility: 0.55, duration: 30 },
  passage: { minTrust: 0.2, maxHostility: 0.35, duration: 25 },
  technology_exchange: {
    minTrust: 0.25,
    maxHostility: 0.25,
    duration: 30,
    // Only worth signing when one side actually knows something the other does not.
    allows: (_rel, a, b) =>
      a.techs.some((id) => !b.techs.includes(id)) || b.techs.some((id) => !a.techs.includes(id)),
  },
  defensive_alliance: { minTrust: 0.35, maxHostility: 0.15, duration: 60 },
  military_alliance: { minTrust: 0.5, maxHostility: 0.1, duration: 60 },
  independence_guarantee: { minTrust: 0.3, maxHostility: 0.2, duration: null },
  // These three are not negotiated between friends: they are recorded when they happen.
  // Houses bind themselves to each other, and the bond outlives the couple.
  dynastic_marriage: {
    minTrust: 0.2,
    maxHostility: 0.3,
    duration: null,
    // Only two peoples that actually have a ruling house have houses to join.
    allows: (_rel, a, b) => a.dynastyId !== null && b.dynastyId !== null,
  },
  tribute: { minTrust: 0, maxHostility: 1, duration: null },
  embargo: { minTrust: 0, maxHostility: 1, duration: 20 },
  peace: { minTrust: 0, maxHostility: 1, duration: null },
};

/** Pacts a people can propose on its own. The other three are consequences, not proposals. */
export const NEGOTIABLE: readonly DiplomaticAgreementType[] = [
  "trade",
  "non_aggression",
  "passage",
  "technology_exchange",
  "defensive_alliance",
  "military_alliance",
  "independence_guarantee",
  "dynastic_marriage",
];

export function emptyReputation(civilizationId: string, tick: number): DiplomaticReputation {
  return {
    civilizationId,
    // A people nobody has dealt with is neither trusted nor distrusted.
    reliability: 0.5,
    aggression: 0.2,
    tradeReliability: 0.5,
    treatyRespect: 0.5,
    threatLevel: 0.2,
    agreementsSigned: 0,
    agreementsBroken: 0,
    updatedAtTick: tick,
  };
}

export function reputationOf(ctx: SimContext, civilizationId: string): DiplomaticReputation {
  const existing = ctx.state.reputations.find((r) => r.civilizationId === civilizationId);
  if (existing) return existing;
  const fresh = emptyReputation(civilizationId, ctx.state.tick);
  ctx.state.reputations.push(fresh);
  return fresh;
}

/** Canonical key of a pair, so the same two peoples never produce two orderings. */
export function pairKey(a: Tribe, b: Tribe): [string, string] {
  return a.seq <= b.seq ? [a.id, b.id] : [b.id, a.id];
}

export function activeAgreements(ctx: SimContext, aId: string, bId: string): DiplomaticAgreement[] {
  return ctx.state.agreements.filter(
    (ag) =>
      ag.status === "active" &&
      ((ag.firstCivilizationId === aId && ag.secondCivilizationId === bId) ||
        (ag.firstCivilizationId === bId && ag.secondCivilizationId === aId)),
  );
}

export function hasAgreement(
  ctx: SimContext,
  aId: string,
  bId: string,
  type: DiplomaticAgreementType,
): boolean {
  return activeAgreements(ctx, aId, bId).some((ag) => ag.type === type);
}

/**
 * Whether a pair could sign this pact right now. Pure with respect to the world: it reads the
 * relationship, the two peoples and their records, and decides nothing by itself.
 */
export function canSign(
  ctx: SimContext,
  rel: Relationship,
  a: Tribe,
  b: Tribe,
  type: DiplomaticAgreementType,
): boolean {
  if (a.id === b.id) return false;
  if (hasAgreement(ctx, a.id, b.id, type)) return false;
  const rule = RULES[type];
  if (rel.atWar && type !== "peace") return false;
  if (rel.trust < rule.minTrust) return false;
  if (rel.hostility > rule.maxHostility) return false;
  if (rule.allows && !rule.allows(rel, a, b)) return false;
  // Nobody signs with a people known for tearing up what it signs.
  const reputation = reputationOf(ctx, b.id);
  const other = reputationOf(ctx, a.id);
  const worstRespect = Math.min(reputation.treatyRespect, other.treatyRespect);
  return worstRespect >= 0.25;
}

/**
 * How willing the pair is to actually sign, 0..1. Trust and a clean record raise it; a
 * reputation for breaking pacts and a wide cultural distance lower it.
 */
export function signingChance(rel: Relationship, a: DiplomaticReputation, b: DiplomaticReputation): number {
  const record = (a.treatyRespect + b.treatyRespect) / 2;
  const reliability = (a.reliability + b.reliability) / 2;
  return round(
    clamp(
      rel.trust * 0.45 +
        record * 0.2 +
        reliability * 0.15 -
        rel.hostility * 0.3 -
        rel.culturalDistance * 0.15,
    ),
    3,
  );
}

export function signAgreement(
  ctx: SimContext,
  rel: Relationship,
  a: Tribe,
  b: Tribe,
  type: DiplomaticAgreementType,
  causeEventId: string | null = null,
): DiplomaticAgreement | null {
  if (a.id === b.id) return null;
  if (hasAgreement(ctx, a.id, b.id, type)) return null;
  const [firstCivilizationId, secondCivilizationId] = pairKey(a, b);
  const { id, seq } = nextId(ctx.state, "agreement", "ag");
  const rule = RULES[type];
  const agreement: DiplomaticAgreement = {
    id,
    seq,
    firstCivilizationId,
    secondCivilizationId,
    type,
    startedAtTick: ctx.state.tick,
    startedYear: ctx.state.year,
    expiresAtYear: rule.duration === null ? null : ctx.state.year + rule.duration,
    endedYear: null,
    trustAtStart: round(rel.trust, 3),
    status: "active",
    violationCount: 0,
    lastViolatorId: null,
    causeEventId,
  };
  ctx.state.agreements.push(agreement);
  for (const tribe of [a, b]) {
    const reputation = reputationOf(ctx, tribe.id);
    reputation.agreementsSigned += 1;
    reputation.updatedAtTick = ctx.state.tick;
  }
  const event = emitEvent(ctx, {
    type: "agreement",
    subtype: type,
    // Alliances make history; routine pacts are record-keeping. Measured: with every signing
    // at 3, pacts were the second largest share of the important chronicle.
    importance:
      type === "military_alliance" || type === "defensive_alliance"
        ? 4
        : type === "independence_guarantee" || type === "technology_exchange"
          ? 3
          : 2,
    actors: [actor.tribe(a), actor.tribe(b)],
    x: a.x,
    y: a.y,
    title: `${AGREEMENT_LABELS[type]}: ${a.name} e ${b.name}`,
    description: t("{Art:first} e {art:second} hanno stretto {what}.", {
      first: polityPhrase(a, ctx.state.civilizations),
      second: polityPhrase(b, ctx.state.civilizations),
      what: indefiniteAgreement(type),
    }),
    metadata: {
      agreementId: id,
      type,
      trustAtStart: agreement.trustAtStart,
      expiresAtYear: agreement.expiresAtYear,
    },
    causeEventIds: causeEventId ? [causeEventId] : [],
  });
  if (event.id.length > 0 && agreement.causeEventId === null) agreement.causeEventId = event.id;
  return agreement;
}

/** A pact is broken: it is recorded against whoever broke it, and never quietly removed. */
export function violateAgreement(
  ctx: SimContext,
  agreement: DiplomaticAgreement,
  violatorId: string,
  reason: string,
) {
  if (agreement.status !== "active") return false;
  agreement.violationCount += 1;
  agreement.lastViolatorId = violatorId;
  agreement.status = "violated";
  agreement.endedYear = ctx.state.year;
  const violator = ctx.tribes.get(violatorId);
  const otherId =
    agreement.firstCivilizationId === violatorId
      ? agreement.secondCivilizationId
      : agreement.firstCivilizationId;
  const other = ctx.tribes.get(otherId);
  const reputation = reputationOf(ctx, violatorId);
  reputation.agreementsBroken += 1;
  // Breaking a pact costs far more than keeping one earns: a record is easy to lose.
  reputation.treatyRespect = round(clamp(reputation.treatyRespect - 0.2), 3);
  reputation.reliability = round(clamp(reputation.reliability - 0.15), 3);
  if (agreement.type === "trade") {
    reputation.tradeReliability = round(clamp(reputation.tradeReliability - 0.2), 3);
  }
  reputation.updatedAtTick = ctx.state.tick;
  if (violator && other) {
    emitEvent(ctx, {
      type: "agreement",
      subtype: "violated",
      importance: 4,
      actors: [actor.tribe(violator), actor.tribe(other)],
      x: violator.x,
      y: violator.y,
      title: `${violator.name} rompe il patto con ${other.name}`,
      description: t("{Art:first} {v:first:ha|hanno} rotto {art:what} con {art:second}: {reason}.", {
        first: polityPhrase(violator, ctx.state.civilizations),
        second: polityPhrase(other, ctx.state.civilizations),
        what: agreementPhrase(agreement.type),
        reason,
      }),
      metadata: {
        agreementId: agreement.id,
        type: agreement.type,
        violatorId,
        years: ctx.state.year - agreement.startedYear,
        treatyRespect: reputation.treatyRespect,
        reason,
      },
      causeEventIds: agreement.causeEventId ? [agreement.causeEventId] : [],
    });
  }
  return true;
}

/**
 * Yearly update of what a people is known for. Reputation moves slowly and only because of
 * things that happened: wars started, pacts kept, trade honoured.
 */
export function updateReputation(
  ctx: SimContext,
  tribe: Tribe,
  input: { warsStarted: number; atWar: boolean; power: number; maxPower: number; tradeVolume: number },
) {
  const reputation = reputationOf(ctx, tribe.id);
  const pacts = ctx.state.agreements.filter(
    (ag) => ag.firstCivilizationId === tribe.id || ag.secondCivilizationId === tribe.id,
  );
  const broken = pacts.filter((ag) => ag.lastViolatorId === tribe.id).length;
  const honoured = pacts.filter((ag) => ag.status !== "violated").length;
  // A record built from pacts actually lived through; with no pacts at all it drifts to neutral.
  const respect = pacts.length === 0 ? 0.5 : honoured / pacts.length;
  reputation.treatyRespect = blend(reputation.treatyRespect, respect, 0.08);
  reputation.reliability = blend(
    reputation.reliability,
    clamp(respect * 0.7 + (1 - Math.min(1, broken * 0.3)) * 0.3),
    0.06,
  );
  reputation.tradeReliability = blend(
    reputation.tradeReliability,
    clamp(0.4 + Math.min(0.5, input.tradeVolume / 200) - Math.min(0.4, broken * 0.2)),
    0.05,
  );
  reputation.aggression = blend(
    reputation.aggression,
    clamp(Math.min(1, input.warsStarted * 0.25) + (input.atWar ? 0.2 : 0)),
    0.07,
  );
  // How dangerous others find it: how strong it is, times how willing it is to use that.
  reputation.threatLevel = blend(
    reputation.threatLevel,
    clamp((input.maxPower > 0 ? input.power / input.maxPower : 0) * 0.6 + reputation.aggression * 0.4),
    0.06,
  );
  reputation.updatedAtTick = ctx.state.tick;
}

function blend(current: number, target: number, rate: number): number {
  return round(clamp(current + (target - current) * rate), 3);
}

/** Pacts that have run their course end quietly; the record keeps them. */
export function expireAgreements(ctx: SimContext) {
  for (const agreement of ctx.state.agreements) {
    if (agreement.status !== "active") continue;
    if (agreement.expiresAtYear === null || agreement.expiresAtYear > ctx.state.year) continue;
    agreement.status = "expired";
    agreement.endedYear = ctx.state.year;
  }
}

/**
 * A pact is void when one of its two sides no longer exists. It is marked cancelled, never
 * deleted: the world's record must still show that it was once signed.
 */
export function cancelOrphanAgreements(ctx: SimContext) {
  for (const agreement of ctx.state.agreements) {
    if (agreement.status !== "active") continue;
    const a = ctx.tribes.get(agreement.firstCivilizationId);
    const b = ctx.tribes.get(agreement.secondCivilizationId);
    if (a && b && a.status !== "extinct" && b.status !== "extinct") continue;
    agreement.status = "cancelled";
    agreement.endedYear = ctx.state.year;
  }
}

/**
 * Step 13b: one year of explicit diplomacy. Pacts that ran out end, pacts whose sides no longer
 * exist are cancelled, neighbours who trust each other enough sign something, and every people
 * has its record updated from what it actually did.
 *
 * Nothing here starts a war or makes peace: those stay in `diplomacy.ts`. This records what the
 * two sides put in writing, and what that writing turned out to be worth.
 */
export function updateAgreements(
  ctx: SimContext,
  profiles: ReadonlyMap<string, { tribe: Tribe; power: number; population: number }>,
) {
  const { state } = ctx;
  expireAgreements(ctx);
  cancelOrphanAgreements(ctx);

  const list = [...profiles.values()].sort((a, b) => a.tribe.seq - b.tribe.seq);
  const byId = new Map(list.map((p) => [p.tribe.id, p]));
  const maxPower = list.reduce((acc, p) => Math.max(acc, p.power), 1);

  // Wars started this year, per attacker, so reputation reflects who actually opened them.
  const warsStarted = new Map<string, number>();
  for (const rel of state.relationships) {
    if (!rel.atWar || rel.warStartYear !== state.year) continue;
    for (const id of [rel.aId, rel.bId]) warsStarted.set(id, (warsStarted.get(id) ?? 0) + 1);
  }

  for (const rel of state.relationships) {
    const a = byId.get(rel.aId);
    const b = byId.get(rel.bId);
    if (!a || !b) continue;
    if (rel.atWar) continue;
    // Peoples only put things in writing once they have actually been dealing with each other.
    if (rel.phaseYears < 5) continue;
    const repA = reputationOf(ctx, a.tribe.id);
    const repB = reputationOf(ctx, b.tribe.id);
    const willingness = signingChance(rel, repA, repB);
    if (willingness <= 0) continue;
    for (const type of NEGOTIABLE) {
      if (!canSign(ctx, rel, a.tribe, b.tribe, type)) continue;
      // One pact per pair per year at most: treaties are not signed in batches.
      if (!ctx.rng.chance(willingness * 0.08)) continue;
      // A dynastic marriage is only worth writing down if there are two people to marry.
      if (type === "dynastic_marriage" && !marryHouses(ctx, rel, a.tribe, b.tribe)) continue;
      signAgreement(ctx, rel, a.tribe, b.tribe, type);
      break;
    }
  }

  for (const profile of list) {
    const rels = state.relationships.filter((r) => r.aId === profile.tribe.id || r.bId === profile.tribe.id);
    updateReputation(ctx, profile.tribe, {
      warsStarted: warsStarted.get(profile.tribe.id) ?? 0,
      atWar: rels.some((r) => r.atWar),
      power: profile.power,
      maxPower,
      tradeVolume: rels.reduce((acc, r) => acc + r.tradeVolume, 0),
    });
  }
  // `reputationOf` may have appended records: keep the order a reload would produce.
  state.reputations.sort(byReputation);
}

// --- Dynastic marriages ------------------------------------------------------------------------

/**
 * Ages at which a house can offer one of its own. The lower bound is below adulthood on purpose:
 * dynastic matches were promises between children, and this engine marries its adults off young
 * — measured with a floor of 16, in three worlds × 600 ticks there was never an unattached
 * kinsman on both sides at once. Nothing follows from the promise until they come of age:
 * `AGE.fertileMin` is 16, so no children are born of it before then.
 */
export const MARRIAGE_MIN_AGE = 12;
export const MARRIAGE_MAX_AGE = 45;

/**
 * Kin of the ruling house who could be married off: adults of the house, still unattached.
 *
 * "Of the house" is read widely on purpose — those carrying its name, the ruler's children and
 * the ruler's brothers and sisters. Measured with only the ruler's own children: in three worlds
 * × 600 ticks there was never an unattached one on both sides at once, because this engine
 * marries people off young.
 */
function marriageable(ctx: SimContext, tribe: Tribe, sex: "M" | "F"): Person | null {
  const dynastyId = tribe.dynastyId;
  if (!dynastyId) return null;
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const sibling = (p: Person) =>
    leader !== undefined &&
    p.id !== leader.id &&
    ((p.motherId !== null && p.motherId === leader.motherId) ||
      (p.fatherId !== null && p.fatherId === leader.fatherId));
  const candidates = ctx.state.people.filter(
    (p) =>
      p.alive &&
      p.tribeId === tribe.id &&
      p.sex === sex &&
      p.age >= MARRIAGE_MIN_AGE &&
      p.age <= MARRIAGE_MAX_AGE &&
      p.householdId === null &&
      (p.dynastyId === dynastyId ||
        (leader !== undefined && (p.motherId === leader.id || p.fatherId === leader.id)) ||
        sibling(p) ||
        // A ruler who has nobody can marry in person.
        p.id === leader?.id),
  );
  // The most prestigious match: a house offers its best, not whoever is left.
  return candidates.reduce<Person | null>(
    (best, p) =>
      !best || p.prestige > best.prestige || (p.prestige === best.prestige && p.seq < best.seq) ? p : best,
    null,
  );
}

/**
 * Marries the two ruling houses to each other, if each has someone to give. The bride or groom
 * moves to the other people and keeps their own house's name, so their children can carry a
 * claim in both: the pact is the political fact, this is the family one.
 *
 * Returns false when no couple could be made, and then no pact is signed either — a treaty that
 * marries nobody would be a lie in the chronicle.
 */
export function marryHouses(ctx: SimContext, rel: Relationship, a: Tribe, b: Tribe): boolean {
  // Deterministic: the people with the lower seq offers the groom, so the same world always
  // produces the same match.
  const [groomSide, brideSide] = a.seq <= b.seq ? [a, b] : [b, a];
  const groom = marriageable(ctx, groomSide, "M");
  const bride = marriageable(ctx, brideSide, "F");
  if (!groom || !bride) return false;
  if (related(groom, bride)) return false;

  // The bride joins her husband's people, as the ordinary exogamy in this engine does.
  bride.tribeId = groomSide.id;
  bride.settlementId = groom.settlementId;
  bride.x = groom.x;
  bride.y = groom.y;
  for (const techId of groomSide.techs) if (!bride.knowledge.includes(techId)) bride.knowledge.push(techId);
  const { id, seq } = nextId(ctx.state, "household", "h");
  ctx.state.households.push({
    id,
    seq,
    tribeId: groomSide.id,
    partnerIds: [groom.id, bride.id],
    formedYear: ctx.state.year,
    dissolvedYear: null,
  });
  groom.householdId = id;
  bride.householdId = id;
  groom.notable = true;
  bride.notable = true;
  // Binding the houses is worth more than any single exchange of goods.
  rel.trust = round(clamp(rel.trust + 0.15), 3);
  rel.hostility = round(clamp(rel.hostility - 0.1), 3);
  rel.respect = round(clamp(rel.respect + 0.1), 3);
  emitEvent(ctx, {
    type: "agreement",
    subtype: "dynastic_marriage",
    importance: 4,
    actors: [actor.tribe(groomSide), actor.tribe(brideSide), actor.person(groom), actor.person(bride)],
    x: groom.x,
    y: groom.y,
    title: `Nozze fra ${groomSide.name} e ${brideSide.name}`,
    description: t("{bride} {di:brideSide} ha sposato {groom} {di:groomSide}: le due case sono ora legate.", {
      bride: bride.name,
      brideSide: peoplePhrase(brideSide),
      groom: groom.name,
      groomSide: peoplePhrase(groomSide),
    }),
    metadata: {
      groomId: groom.id,
      brideId: bride.id,
      groomDynastyId: groomSide.dynastyId,
      brideDynastyId: brideSide.dynastyId,
      trust: rel.trust,
    },
  });
  return true;
}
