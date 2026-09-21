import { causesFrom } from "./causality";
import { AGE, GOVERNMENTS } from "./constants";
import { nextId, type SimContext } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { clamp, round } from "./grid";
import { identityOf } from "./identity/composite";
import { formatEventDescription as t, formatLeaderTitle, peoplePhrase } from "./language/format";
import { dynastyName } from "./names";
import type { Dynasty, DynastyEndReason, Person, SuccessionLaw, SuccessionOutcome, Tribe } from "./types";

/**
 * Leadership, dynasties and succession.
 *
 * A leader is never drawn at random: the group picks the person whose age, prestige,
 * leadership skill, wealth, knowledge and family weigh most, with the exact formula
 * depending on the form of government. Succession happens on death, on incapacity and
 * when legitimacy collapses.
 */

/** Youngest age at which an heir can rule in their own name; below it a regency is needed. */
export const MAJORITY_AGE = 20;

/**
 * The rule a people follows to choose its next ruler, read from the form of government it has.
 * A house founded under a monarchy keeps its law until the government itself changes.
 */
export function successionLawOf(tribe: Tribe): SuccessionLaw {
  switch (GOVERNMENTS[tribe.government].succession) {
    case "hereditary":
      return "hereditary";
    case "election":
      return "elective";
    case "seniority":
      return "council";
    case "strength":
      return "military";
    default:
      return tribe.culture.spirituality >= 70 ? "religious" : "meritocratic";
  }
}

export const SUCCESSION_LAW_LABELS: Record<SuccessionLaw, string> = {
  hereditary: "ereditaria",
  elective: "elettiva",
  council: "per consiglio",
  military: "militare",
  religious: "religiosa",
  meritocratic: "per merito",
};

export const SUCCESSION_OUTCOME_LABELS: Record<SuccessionOutcome, string> = {
  peaceful: "pacifica",
  regency: "reggenza",
  disputed: "contesa",
  usurpation: "usurpazione",
  interregnum: "interregno",
};

/** Everything that can turn a handover of power into a crisis. Each term is 0..1. */
export interface SuccessionRiskInput {
  /** Eligible claimants of the ruling house. */
  heirs: number;
  /** Claimants whose standing is close enough to the first to contest him. */
  rivals: number;
  /** The designated heir is below `MAJORITY_AGE`. */
  minorHeir: boolean;
  /** The ruler died before old age: nothing had been arranged. */
  suddenDeath: boolean;
  /** Legitimacy of the ruling house, 0..1. */
  dynastyLegitimacy: number;
  /** Legitimacy of the people's institutions, 0..1. */
  legitimacy: number;
  /** How far power is concentrated, 0..1: a scattered people has more claimants. */
  centralization: number;
  /** Vassals that could take the chance to break away, 0..1. */
  vassalPressure: number;
}

/**
 * Probability that a succession goes wrong, 0..1. Pure function: the same situation always
 * produces the same risk, and a strong house with one clear heir is never at risk.
 */
export function successionCrisisRisk(input: SuccessionRiskInput): number {
  if (input.heirs === 0) return 1;
  const contested = Math.min(0.35, Math.max(0, input.rivals) * 0.18);
  const weakHouse = Math.max(0, 0.7 - input.dynastyLegitimacy) * 0.5;
  const weakState = Math.max(0, 0.6 - input.legitimacy) * 0.55;
  const scattered = Math.max(0, 0.45 - input.centralization) * 0.35;
  return round(
    clamp(
      contested +
        weakHouse +
        weakState +
        scattered +
        (input.minorHeir ? 0.25 : 0) +
        (input.suddenDeath ? 0.15 : 0) +
        input.vassalPressure * 0.2,
    ),
    3,
  );
}

export function isEligibleLeader(p: Person): boolean {
  return p.alive && p.age >= 20 && p.age < 70 && p.health >= 0.35;
}

export interface LeaderScoreParts {
  age: number;
  prestige: number;
  leadership: number;
  wealth: number;
  war: number;
  knowledge: number;
  dynasty: number;
  support: number;
}

/** Weighted score of a candidate. The weights change with the form of government. */
export function leaderScore(
  person: Person,
  tribe: Tribe,
  context: { maxWealth: number; dynasties: Map<string, Dynasty> },
): number {
  const parts = leaderScoreParts(person, tribe, context);
  const gov = GOVERNMENTS[tribe.government];
  switch (gov.succession) {
    case "seniority":
      return parts.age * 0.4 + parts.prestige * 0.2 + parts.knowledge * 0.2 + parts.support * 0.2;
    case "strength":
      return parts.war * 0.35 + parts.prestige * 0.25 + parts.leadership * 0.2 + parts.support * 0.2;
    case "hereditary":
      return parts.dynasty * 0.4 + parts.prestige * 0.2 + parts.leadership * 0.2 + parts.wealth * 0.2;
    case "election":
      return (
        parts.prestige * 0.3 +
        parts.knowledge * 0.25 +
        parts.wealth * 0.2 +
        parts.leadership * 0.15 +
        parts.support * 0.1
      );
    default:
      return parts.support * 0.3 + parts.prestige * 0.25 + parts.leadership * 0.25 + parts.age * 0.2;
  }
}

export function leaderScoreParts(
  person: Person,
  tribe: Tribe,
  context: { maxWealth: number; dynasties: Map<string, Dynasty> },
): LeaderScoreParts {
  const dynasty = person.dynastyId ? context.dynasties.get(person.dynastyId) : undefined;
  const sameDynasty = dynasty && dynasty.tribeId === tribe.id && dynasty.endedYear === null;
  return {
    age: clamp(Math.min(1, (person.age - 18) / 32)),
    prestige: clamp(person.prestige),
    leadership: clamp(person.skills.leadership * 0.7 + person.personality.sociability * 0.3),
    wealth: clamp(person.wealth / Math.max(1, context.maxWealth)),
    war: clamp(person.skills.combat * 0.7 + person.personality.aggression * 0.3),
    knowledge: clamp(person.education * 0.6 + person.knowledge.length * 0.03),
    dynasty: sameDynasty ? clamp(0.6 + (dynasty?.prestige ?? 0) * 0.4) : 0,
    support: clamp(person.personality.cooperation * 0.5 + person.personality.sociability * 0.5),
  };
}

function dynastyMap(ctx: SimContext): Map<string, Dynasty> {
  return new Map(ctx.state.dynasties.map((d) => [d.id, d]));
}

/**
 * Children and close kin of the current leader, ranked. Used by hereditary succession and
 * to decide whether a succession crisis breaks out.
 */
export function heirsOf(ctx: SimContext, leader: Person, members: Person[]): Person[] {
  return members
    .filter((p) => isEligibleLeader(p) && (p.motherId === leader.id || p.fatherId === leader.id))
    .sort((a, b) => b.prestige - a.prestige || b.age - a.age || a.seq - b.seq);
}

/** Smallest group whose leadership is worth turning into a heritable claim. */
export const DYNASTY_MIN_POPULATION = 60;

/**
 * Whether a chief can make his command heritable. Without this a people could never reach a
 * monarchy at all: that form of government requires a ruling house, and a ruling house used to
 * require that very form of government.
 */
export function canFoundDynasty(ctx: SimContext, tribe: Tribe, leader: Person): boolean {
  if (leader.prestige < 0.5) return false;
  if (tribe.culture.hierarchy < 45 || tribe.culture.centralization < 40) return false;
  if (tribe.stability.legitimacy < 0.45) return false;
  const population = ctx.state.people.reduce(
    (acc, p) => acc + (p.alive && p.tribeId === tribe.id ? 1 : 0),
    0,
  );
  if (population < DYNASTY_MIN_POPULATION) return false;
  // Children to pass it on to: a claim with nobody behind it is not a house.
  return ctx.state.people.some((p) => p.alive && (p.motherId === leader.id || p.fatherId === leader.id));
}

export function ensureDynasty(ctx: SimContext, tribe: Tribe, leader: Person): Dynasty | null {
  if (leader.dynastyId) {
    const existing = ctx.state.dynasties.find((d) => d.id === leader.dynastyId);
    if (existing && existing.endedYear === null) {
      tribe.dynastyId = existing.id;
      return existing;
    }
  }
  const gov = GOVERNMENTS[tribe.government];
  if (gov.succession !== "hereditary" && tribe.government !== "chiefdom") return null;
  // A chief only turns his household into a ruling house when there is something to pass on:
  // a group large enough to be worth inheriting, and the standing to make the claim stick.
  if (gov.succession !== "hereditary" && !canFoundDynasty(ctx, tribe, leader)) return null;
  const { id, seq } = nextId(ctx.state, "dynasty", "dy");
  const dynasty: Dynasty = {
    id,
    seq,
    name: dynastyName(ctx.rng, leader.name),
    tribeId: tribe.id,
    founderId: leader.id,
    foundedYear: ctx.state.year,
    endedYear: null,
    prestige: round(clamp(leader.prestige)),
    rulers: 1,
    currentLeaderId: leader.id,
    legitimacy: round(clamp(0.45 + leader.prestige * 0.3 + tribe.stability.legitimacy * 0.25), 3),
    successionLaw: successionLawOf(tribe),
    status: "active",
    endReason: null,
    crises: 0,
  };
  ctx.state.dynasties.push(dynasty);
  leader.dynastyId = id;
  tribe.dynastyId = id;
  emitEvent(ctx, {
    type: "leadership",
    subtype: "dynasty_founded",
    importance: 4,
    actors: [actor.person(leader), actor.tribe(tribe), { kind: "dynasty", id, name: dynasty.name }],
    x: leader.x,
    y: leader.y,
    title: `Nasce la ${dynasty.name}`,
    description: t(
      "Il potere presso {art:people} non torna più al consiglio: {leader} lo trasmetterà ai suoi discendenti. Nasce la {dynasty}.",
      {
        people: peoplePhrase(tribe),
        leader: leader.name,
        dynasty: dynasty.name,
      },
    ),
    metadata: { dynastyId: id, founderId: leader.id, government: tribe.government },
  });
  return dynasty;
}

/** Marks a person as leader and records the event. */
function installLeader(
  ctx: SimContext,
  tribe: Tribe,
  leader: Person,
  reason: "succession" | "foundation" | "coup" | "election",
  previous: Person | null,
  outcome: SuccessionOutcome = "peaceful",
) {
  tribe.leaderId = leader.id;
  tribe.lastLeaderChangeYear = ctx.state.year;
  leader.notable = true;
  leader.title =
    tribe.government === "tribal_monarchy" || tribe.government === "city_state" ? "ruler" : "chief";
  leader.titleSinceYear = ctx.state.year;
  leader.prestige = round(clamp(leader.prestige + 0.15));
  const dynasty = leader.dynastyId ? ctx.state.dynasties.find((d) => d.id === leader.dynastyId) : null;
  if (dynasty && dynasty.tribeId === tribe.id && dynasty.endedYear !== null && reason !== "coup") {
    restoreDynasty(ctx, tribe, dynasty, leader);
  }
  if (dynasty && dynasty.tribeId === tribe.id && dynasty.endedYear === null) {
    dynasty.rulers += 1;
    dynasty.prestige = round(clamp(dynasty.prestige + 0.05));
    dynasty.currentLeaderId = leader.id;
    // An undisputed handover restores a little of what troubled ones cost the house.
    dynasty.legitimacy = round(clamp(dynasty.legitimacy + (outcome === "peaceful" ? 0.04 : 0)), 3);
    // The law follows the government: a house can outlive the rule that created it.
    dynasty.successionLaw = successionLawOf(tribe);
    tribe.dynastyId = dynasty.id;
  } else if (GOVERNMENTS[tribe.government].succession === "hereditary" || tribe.government === "chiefdom") {
    ensureDynasty(ctx, tribe, leader);
  }

  const gov = GOVERNMENTS[tribe.government];
  const how =
    reason === "coup"
      ? "ha preso il potere con la forza"
      : gov.succession === "hereditary"
        ? "ha ereditato il comando"
        : gov.succession === "election"
          ? "è stato scelto dall'assemblea"
          : gov.succession === "seniority"
            ? "è stato riconosciuto dagli anziani"
            : gov.succession === "strength"
              ? "si è imposto per prestigio e forza"
              : "ha ricevuto il consenso del gruppo";
  if (reason === "foundation" && previous === null && ctx.state.tick <= 1) return;
  // The chronicle only records the leaders of groups big enough to matter.
  const groupSize = ctx.state.people.reduce((acc, p) => acc + (p.alive && p.tribeId === tribe.id ? 1 : 0), 0);
  const settled = ctx.state.settlements.some((s) => s.status === "active" && s.tribeId === tribe.id);
  if (reason === "foundation" && groupSize < 40 && !settled) return;
  const importance: 1 | 2 | 3 | 4 =
    reason === "coup" ? 4 : groupSize >= 120 || settled ? (previous ? 3 : 2) : previous ? 2 : 1;
  emitEvent(ctx, {
    type: "leadership",
    subtype: reason,
    importance,
    actors: [actor.person(leader), actor.tribe(tribe), ...(previous ? [actor.person(previous)] : [])],
    x: leader.x,
    y: leader.y,
    title:
      reason === "coup"
        ? t("{leader} rovescia la guida {di:people}", { leader: leader.name, people: peoplePhrase(tribe) })
        : t("{leader} alla guida {di:people}", {
            leader: formatLeaderTitle(leader, tribe.government, identityOf(ctx.state, tribe.identityId)),
            people: peoplePhrase(tribe),
          }),
    description: `${leader.name}, ${leader.age} anni, ${how} presso ${describePlace(ctx.state, leader.x, leader.y)}${
      previous ? `, dopo ${previous.name}` : ""
    }.`,
    metadata: {
      personId: leader.id,
      previousLeaderId: previous?.id ?? null,
      government: tribe.government,
      succession: gov.succession,
      prestige: leader.prestige,
      dynastyId: leader.dynastyId,
      reason,
      outcome,
      successionLaw: successionLawOf(tribe),
    },
    // A succession follows the death of the ruler before, or the revolt that removed him.
    causeEventIds:
      reason === "foundation"
        ? []
        : causesFrom(ctx.state.year, [
            [tribe, "leader_death", 3],
            [tribe, "revolt", 5],
          ]),
  });
}

/**
 * Step 3/14: makes sure the tribe has a legitimate leader. Called after deaths and at the
 * end of the tick; leaders are not reshuffled every year.
 */
export function ensureLeader(ctx: SimContext, tribe: Tribe, members: Person[]) {
  const current = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const dynasties = dynastyMap(ctx);
  const maxWealth = members.reduce((acc, p) => Math.max(acc, p.wealth), 1);
  const context = { maxWealth, dynasties };

  if (current?.alive && current.tribeId === tribe.id) {
    // Incapacity: a leader too old or too sick steps aside.
    const incapable = current.age >= 72 || current.health < 0.25;
    if (!incapable) return;
    const candidates = members.filter((p) => isEligibleLeader(p) && p.id !== current.id);
    if (candidates.length === 0) return;
    const chosen = pickSuccessor(ctx, tribe, current, candidates, context);
    if (!chosen) return;
    current.title = "elder";
    tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - 0.05);
    installLeader(ctx, tribe, chosen.leader, "succession", current, chosen.outcome);
    return;
  }

  const candidates = members.filter(isEligibleLeader);
  if (candidates.length === 0) {
    tribe.leaderId = null;
    return;
  }
  const previous = current ?? null;
  const successor = pickSuccessor(ctx, tribe, previous, candidates, context);
  if (!successor) {
    tribe.leaderId = null;
    return;
  }
  installLeader(
    ctx,
    tribe,
    successor.leader,
    previous ? "succession" : "foundation",
    previous,
    successor.outcome,
  );
}

/**
 * Vassals that could use the handover to break away, 0..1. A people with no vassals feels no
 * such pressure; a lord whose vassals are already restless feels a lot of it.
 */
function vassalPressure(ctx: SimContext, tribe: Tribe): number {
  const bonds = ctx.state.vassalages.filter(
    (v) => v.overlordCivilizationId === tribe.id && v.endedAtTick === null,
  );
  if (bonds.length === 0) return 0;
  const restless = bonds.reduce((acc, v) => acc + (v.diplomaticStatus === "rebellion" ? 1 : v.autonomy), 0);
  return round(clamp(restless / bonds.length), 3);
}

/** Everything the succession needs to know about the moment the previous ruler left. */
export function successionSituation(
  ctx: SimContext,
  tribe: Tribe,
  previous: Person,
  candidates: Person[],
  dynasty: Dynasty | null,
): { heirs: Person[]; minor: Person | null; risk: SuccessionRiskInput } {
  const heirs = heirsOf(ctx, previous, candidates);
  // Children who would inherit but are still too young to rule in their own name.
  const minor =
    ctx.state.people.find(
      (p) =>
        p.alive &&
        p.tribeId === tribe.id &&
        p.age < MAJORITY_AGE &&
        (p.motherId === previous.id || p.fatherId === previous.id),
    ) ?? null;
  const first = heirs[0];
  const rivals = first
    ? heirs.filter((p) => p.id !== first.id && p.prestige >= first.prestige * 0.85).length
    : candidates.filter((p) => p.prestige >= (candidates[0]?.prestige ?? 0) * 0.85).length - 1;
  return {
    heirs,
    minor,
    risk: {
      heirs: heirs.length,
      rivals: Math.max(0, rivals),
      minorHeir: heirs.length === 0 && minor !== null,
      // A ruler who died before the elder years left nothing arranged.
      suddenDeath: !previous.alive && previous.age < AGE.elder,
      dynastyLegitimacy: dynasty?.legitimacy ?? 0.5,
      legitimacy: tribe.stability.legitimacy,
      centralization: tribe.culture.centralization / 100,
      vassalPressure: vassalPressure(ctx, tribe),
    },
  };
}

/** Best candidate by the rule the people actually follows. */
function bestCandidate(
  ctx: SimContext,
  tribe: Tribe,
  candidates: Person[],
  context: { maxWealth: number; dynasties: Map<string, Dynasty> },
): Person | null {
  let best: Person | null = null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    const score = leaderScore(p, tribe, context) + ctx.rng.next() * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * Who rules next, and how the handover went.
 *
 * A clear heir in a solid house simply inherits. Everything else — several claimants, a child
 * in the line, a discredited house, restless vassals — raises the risk that the handover turns
 * into a regency, a contested throne or an outright usurpation. The house pays for each of them
 * in legitimacy, and when the line runs out the house ends.
 */
function pickSuccessor(
  ctx: SimContext,
  tribe: Tribe,
  previous: Person | null,
  candidates: Person[],
  context: { maxWealth: number; dynasties: Map<string, Dynasty> },
): { leader: Person; outcome: SuccessionOutcome } | null {
  if (candidates.length === 0) return null;
  const dynasty = tribe.dynastyId ? (context.dynasties.get(tribe.dynastyId) ?? null) : null;
  const house = dynasty && dynasty.endedYear === null ? dynasty : null;

  // Without a ruling house there is nothing to inherit and nothing to contest: the group simply
  // picks the person its form of government points to.
  if (!house || !previous) {
    const chosen = bestCandidate(ctx, tribe, candidates, context);
    return chosen ? { leader: chosen, outcome: "peaceful" } : null;
  }

  const situation = successionSituation(ctx, tribe, previous, candidates, house);
  const risk = successionCrisisRisk(situation.risk);
  const troubled = ctx.rng.chance(risk);

  if (situation.heirs.length === 0) {
    // The line has run out: the house ends here, whoever takes its place.
    endDynasty(ctx, tribe, house, "no_heir");
    successionCrisis(ctx, tribe, previous, "interregnum", risk, situation.risk);
    const chosen = bestCandidate(ctx, tribe, candidates, context);
    return chosen ? { leader: chosen, outcome: "interregnum" } : null;
  }

  const heir = situation.heirs[0] as Person;
  if (!troubled) {
    heir.dynastyId ??= previous.dynastyId;
    return { leader: heir, outcome: "peaceful" };
  }

  // A troubled handover: a regency while the heir grows up, a contested throne among the
  // claimants of the house, or an outsider taking it altogether.
  const outsider = bestCandidate(
    ctx,
    tribe,
    candidates.filter((p) => !situation.heirs.some((h) => h.id === p.id)),
    context,
  );
  const usurped = outsider !== null && ctx.rng.chance(clamp(risk * 0.55));
  const outcome: SuccessionOutcome = usurped
    ? "usurpation"
    : situation.risk.minorHeir || situation.heirs[0]!.age < MAJORITY_AGE + 3
      ? "regency"
      : "disputed";
  const leader = usurped ? (outsider as Person) : heir;
  if (!usurped) leader.dynastyId ??= previous.dynastyId;
  if (usurped) {
    endDynasty(ctx, tribe, house, "usurpation");
  } else {
    house.legitimacy = round(clamp(house.legitimacy - (outcome === "disputed" ? 0.15 : 0.08)), 3);
    house.crises += 1;
  }
  successionCrisis(ctx, tribe, previous, outcome, risk, situation.risk);
  return { leader, outcome };
}

/**
 * Closes a ruling house without erasing it: the record keeps its name, its founder, the years
 * it ruled, how many rulers it gave and why it ended.
 */
export function endDynasty(
  ctx: SimContext,
  tribe: Tribe,
  dynasty: Dynasty | null,
  reason: DynastyEndReason,
): boolean {
  if (!dynasty || dynasty.endedYear !== null) return false;
  dynasty.endedYear = ctx.state.year;
  dynasty.currentLeaderId = null;
  dynasty.status = reason === "usurpation" ? "overthrown" : reason === "merged" ? "merged" : "extinct";
  dynasty.endReason = reason;
  if (tribe.dynastyId === dynasty.id) tribe.dynastyId = null;
  const why =
    reason === "no_heir"
      ? "senza più eredi riconosciuti"
      : reason === "usurpation"
        ? "spodestata da chi non le apparteneva"
        : reason === "extinct_people"
          ? "con il popolo che governava"
          : reason === "merged"
            ? "confluita in un altro popolo"
            : "perché il potere non si trasmette più per sangue";
  emitEvent(ctx, {
    type: "leadership",
    subtype: "dynasty_ended",
    importance: 4,
    actors: [actor.tribe(tribe), { kind: "dynasty", id: dynasty.id, name: dynasty.name }],
    x: tribe.x,
    y: tribe.y,
    title: `Finisce la ${dynasty.name}`,
    description: t(
      "Dopo {years} anni e {rulers}, la {dynasty} lascia il potere presso {art:people}, {why}.",
      {
        years: ctx.state.year - dynasty.foundedYear,
        rulers: dynasty.rulers === 1 ? "un solo sovrano" : `${dynasty.rulers} sovrani`,
        dynasty: dynasty.name,
        people: peoplePhrase(tribe),
        why,
      },
    ),
    metadata: {
      dynastyId: dynasty.id,
      foundedYear: dynasty.foundedYear,
      endedYear: dynasty.endedYear,
      rulers: dynasty.rulers,
      crises: dynasty.crises,
      reason,
      status: dynasty.status,
    },
    causeEventIds: causesFrom(ctx.state.year, [
      [tribe, "leader_death", 3],
      [tribe, "revolt", 10],
      [tribe, "collapse", 30],
    ]),
  });
  return true;
}

/**
 * A house that had lost the seat takes it back through one of its descendants. The years it
 * spent out of power are kept in the record: a restoration is a second chapter, not a new house.
 */
export function restoreDynasty(ctx: SimContext, tribe: Tribe, dynasty: Dynasty, leader: Person): boolean {
  if (dynasty.endedYear === null) return false;
  // A house nobody remembers, or one the people threw out yesterday, does not simply return.
  const away = ctx.state.year - dynasty.endedYear;
  if (away < 10) return false;
  if (GOVERNMENTS[tribe.government].succession !== "hereditary") return false;
  const interruption = dynasty.endedYear;
  dynasty.endedYear = null;
  dynasty.status = "active";
  dynasty.endReason = null;
  dynasty.currentLeaderId = leader.id;
  dynasty.legitimacy = round(clamp(dynasty.legitimacy * 0.6 + leader.prestige * 0.3), 3);
  tribe.dynastyId = dynasty.id;
  emitEvent(ctx, {
    type: "leadership",
    subtype: "dynasty_restored",
    importance: 4,
    actors: [
      actor.person(leader),
      actor.tribe(tribe),
      { kind: "dynasty", id: dynasty.id, name: dynasty.name },
    ],
    x: leader.x,
    y: leader.y,
    title: `Torna la ${dynasty.name}`,
    description: t(
      "Dopo {away} anni lontana dal potere, la {dynasty} torna alla guida {di:people}: {leader} ne discende.",
      { away, dynasty: dynasty.name, people: peoplePhrase(tribe), leader: leader.name },
    ),
    metadata: {
      dynastyId: dynasty.id,
      interruptedYear: interruption,
      yearsAway: away,
      leaderId: leader.id,
      previousRulers: dynasty.rulers,
    },
  });
  return true;
}

/**
 * Records a handover that did not go smoothly. The cost to the people depends on how it went:
 * a regency is a pause, a contested throne a wound, an interregnum a hole in the institutions.
 */
function successionCrisis(
  ctx: SimContext,
  tribe: Tribe,
  previous: Person,
  outcome: SuccessionOutcome,
  risk: number,
  detail: SuccessionRiskInput,
) {
  const severity =
    outcome === "interregnum" ? 0.6 : outcome === "usurpation" ? 0.5 : outcome === "disputed" ? 0.4 : 0.25;
  tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - severity * 0.35);
  tribe.stability.tension = clamp(tribe.stability.tension + severity * 0.4);
  ctx.state.crises.push({
    id: `cr${(ctx.state.counters.crisis += 1)}:succession`,
    kind: "succession",
    scope: "tribe",
    targetId: tribe.id,
    startYear: ctx.state.year,
    untilYear: ctx.state.year + (outcome === "regency" ? 5 : 3),
    severity: round(severity, 2),
    eventId: null,
  });
  const cause =
    detail.heirs === 0
      ? "non è rimasto nessun erede riconosciuto"
      : detail.minorHeir
        ? "l'erede è troppo giovane per regnare"
        : detail.rivals > 0
          ? `${detail.rivals + 1} pretendenti rivendicano lo stesso posto`
          : "la casa regnante ha perso il credito che aveva";
  const how =
    outcome === "regency"
      ? "il comando passa a chi custodirà il posto finché l'erede non sarà in età"
      : outcome === "usurpation"
        ? "il posto viene preso da chi non apparteneva alla casa"
        : outcome === "interregnum"
          ? "il posto resta vuoto finché il gruppo non trova un accordo"
          : "il posto viene conteso e assegnato a fatica";
  emitEvent(ctx, {
    type: "leadership",
    subtype: "succession_crisis",
    importance: 4,
    actors: [actor.tribe(tribe), actor.person(previous)],
    x: tribe.x,
    y: tribe.y,
    title: t("Crisi di successione presso {art:people}", { people: peoplePhrase(tribe) }),
    // The ruler may have died or merely stepped aside: the chronicle must not say otherwise.
    description: t("{leaving} {cause}: {how}.", {
      leaving: previous.alive ? `Al ritiro di ${previous.name}` : `Alla morte di ${previous.name}`,
      cause,
      how,
    }),
    metadata: {
      previousLeaderId: previous.id,
      dynastyId: tribe.dynastyId,
      outcome,
      risk: round(risk, 3),
      heirs: detail.heirs,
      rivals: detail.rivals,
      minorHeir: detail.minorHeir,
      suddenDeath: detail.suddenDeath,
      vassalPressure: detail.vassalPressure,
      legitimacy: tribe.stability.legitimacy,
      cause,
    },
    causeEventIds: causesFrom(ctx.state.year, [[tribe, "leader_death", 3]]),
  });
}

/**
 * Internal challenge: when legitimacy collapses a rival with enough prestige can seize power.
 * Rare by construction — the conditions have to persist for years.
 */
export function tryCoup(ctx: SimContext, tribe: Tribe, members: Person[]): boolean {
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  if (!leader?.alive) return false;
  if (tribe.stability.unrestYears < ctx.state.config.society.unrestYearsBeforeRevolt) return false;
  if (tribe.stability.legitimacy > 0.35) return false;
  const dynasties = dynastyMap(ctx);
  const maxWealth = members.reduce((acc, p) => Math.max(acc, p.wealth), 1);
  const rivals = members
    .filter((p) => isEligibleLeader(p) && p.id !== leader.id && p.prestige > leader.prestige * 0.9)
    .sort((a, b) => b.prestige - a.prestige);
  const rival = rivals[0];
  if (!rival) return false;
  if (!ctx.rng.chance(ctx.state.config.society.revoltChance * (1 - tribe.stability.legitimacy))) return false;

  leader.title = null;
  leader.prestige = round(clamp(leader.prestige - 0.2));
  // The house that held the seat does not survive being thrown out of it.
  const unseated = tribe.dynastyId ? (dynasties.get(tribe.dynastyId) ?? null) : null;
  if (unseated && rival.dynastyId !== unseated.id) endDynasty(ctx, tribe, unseated, "usurpation");
  tribe.stability.legitimacy = clamp(tribe.stability.legitimacy + 0.15);
  tribe.stability.tension = clamp(tribe.stability.tension - 0.2);
  tribe.stability.unrestYears = 0;
  tribe.morale = clamp(tribe.morale - 0.05, 0.2, 1);
  installLeader(ctx, tribe, rival, "coup", leader);
  void leaderScore(rival, tribe, { maxWealth, dynasties });
  return true;
}

/** Prestige and wealth of a leader grow while they rule well, and decay otherwise. */
export function updateLeaderStanding(ctx: SimContext, tribe: Tribe, foodRatio: number) {
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  if (!leader?.alive) return;
  const good = foodRatio >= 1 && tribe.stability.happiness > 0.55;
  leader.prestige = round(clamp(leader.prestige + (good ? 0.012 : -0.02)));
  leader.education = round(clamp(leader.education + 0.004));
  leader.skills.leadership = round(clamp(leader.skills.leadership + 0.006));
  // The leadership takes its share of what the group produces.
  const tax = GOVERNMENTS[tribe.government].taxation;
  if (tax > 0) leader.wealth = round(leader.wealth + tax * tribe.lastFoodProduced * 0.1, 2);
  const dynasty = tribe.dynastyId ? ctx.state.dynasties.find((d) => d.id === tribe.dynastyId) : null;
  if (dynasty) dynasty.prestige = round(clamp(dynasty.prestige + (good ? 0.006 : -0.01)));
}

/**
 * Inheritance: a dead person's movable wealth and standing pass to the partner and children;
 * what nobody claims goes back to the group.
 */
export function inherit(ctx: SimContext, person: Person, tribe: Tribe | undefined) {
  if (person.wealth <= 0) return;
  const heirs = ctx.state.people.filter(
    (p) => p.alive && (p.motherId === person.id || p.fatherId === person.id),
  );
  if (heirs.length === 0) {
    if (tribe) tribe.stock.food = round(tribe.stock.food + person.wealth * 0.2, 2);
    person.wealth = 0;
    return;
  }
  const share = person.wealth / heirs.length;
  for (const heir of heirs) {
    heir.wealth = round(heir.wealth + share, 2);
    heir.prestige = round(clamp(heir.prestige + person.prestige * 0.25));
    heir.dynastyId ??= person.dynastyId;
  }
  person.wealth = 0;
}

/** Elders and parents pass knowledge on: education rises slowly across generations. */
export function educate(person: Person, mentors: { education: number; knowledge: number }) {
  if (person.age > 25) return;
  const target = clamp(mentors.education * 0.8 + mentors.knowledge * 0.2);
  if (person.education >= target) return;
  person.education = round(clamp(person.education + (target - person.education) * 0.08));
}

export function notableThreshold(age: number): number {
  return age >= AGE.adult ? 0.55 : 0.75;
}
