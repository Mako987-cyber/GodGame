import { AGE, GOVERNMENTS } from "./constants";
import { nextId, type SimContext } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { clamp, round } from "./grid";
import { dynastyName } from "./names";
import type { Dynasty, Person, Tribe } from "./types";

/**
 * Leadership, dynasties and succession.
 *
 * A leader is never drawn at random: the group picks the person whose age, prestige,
 * leadership skill, wealth, knowledge and family weigh most, with the exact formula
 * depending on the form of government. Succession happens on death, on incapacity and
 * when legitimacy collapses.
 */

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
    description: `Il potere tra i ${tribe.name} non torna più al consiglio: ${leader.name} lo trasmetterà ai suoi discendenti. Nasce la ${dynasty.name}.`,
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
) {
  tribe.leaderId = leader.id;
  tribe.lastLeaderChangeYear = ctx.state.year;
  leader.notable = true;
  leader.title =
    tribe.government === "tribal_monarchy" || tribe.government === "city_state" ? "ruler" : "chief";
  leader.titleSinceYear = ctx.state.year;
  leader.prestige = round(clamp(leader.prestige + 0.15));
  const dynasty = leader.dynastyId ? ctx.state.dynasties.find((d) => d.id === leader.dynastyId) : null;
  if (dynasty && dynasty.tribeId === tribe.id) {
    dynasty.rulers += 1;
    dynasty.prestige = round(clamp(dynasty.prestige + 0.05));
    tribe.dynastyId = dynasty.id;
  } else if (GOVERNMENTS[tribe.government].succession === "hereditary") {
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
        ? `${leader.name} rovescia la guida dei ${tribe.name}`
        : `${leader.name} alla guida dei ${tribe.name}`,
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
    },
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
    const heir = pickSuccessor(ctx, tribe, current, candidates, context);
    if (!heir) return;
    current.title = "elder";
    tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - 0.05);
    installLeader(ctx, tribe, heir, "succession", current);
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
  installLeader(ctx, tribe, successor, previous ? "succession" : "foundation", previous);
}

function pickSuccessor(
  ctx: SimContext,
  tribe: Tribe,
  previous: Person | null,
  candidates: Person[],
  context: { maxWealth: number; dynasties: Map<string, Dynasty> },
): Person | null {
  if (candidates.length === 0) return null;
  const gov = GOVERNMENTS[tribe.government];
  if (gov.succession === "hereditary" && previous) {
    const heirs = heirsOf(ctx, previous, candidates);
    if (heirs.length > 0) {
      const heir = heirs[0];
      if (heir) {
        heir.dynastyId ??= previous.dynastyId;
        return heir;
      }
    }
    // No heir: the dynasty is in trouble and the group risks a succession crisis.
    successionCrisis(ctx, tribe, previous);
  }
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

function successionCrisis(ctx: SimContext, tribe: Tribe, previous: Person) {
  tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - 0.2);
  tribe.stability.tension = clamp(tribe.stability.tension + 0.2);
  const dynasty = tribe.dynastyId ? ctx.state.dynasties.find((d) => d.id === tribe.dynastyId) : null;
  if (dynasty) {
    dynasty.endedYear = ctx.state.year;
    tribe.dynastyId = null;
  }
  ctx.state.crises.push({
    id: `cr${(ctx.state.counters.crisis += 1)}:succession`,
    kind: "succession",
    scope: "tribe",
    targetId: tribe.id,
    startYear: ctx.state.year,
    untilYear: ctx.state.year + 3,
    severity: 0.5,
    eventId: null,
  });
  emitEvent(ctx, {
    type: "leadership",
    subtype: "succession_crisis",
    importance: 4,
    actors: [actor.tribe(tribe), actor.person(previous)],
    x: tribe.x,
    y: tribe.y,
    title: `Crisi di successione tra i ${tribe.name}`,
    description: `Alla morte di ${previous.name} non è rimasto nessun erede riconosciuto: tra i ${tribe.name} si apre una lotta per il comando.`,
    metadata: {
      previousLeaderId: previous.id,
      dynastyId: dynasty?.id ?? null,
      legitimacy: tribe.stability.legitimacy,
      cause: "nessun erede idoneo",
    },
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
