import { createPerson } from "./agents";
import { winterMortalityFactor } from "./climate";
import { AGE, MORTALITY } from "./constants";
import type { Community, SimContext } from "./context";
import { nextId } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { cellAt, clamp, round } from "./grid";
import { educate, ensureLeader, inherit } from "./leadership";
import type { TechEffects } from "./technology";
import type { DeathCause, Household, Person, Tribe } from "./types";

export { ensureLeader };

export function baseMortality(age: number): number {
  for (const [limit, p] of MORTALITY) if (age < limit) return p;
  return 0.35;
}

export function householdMap(ctx: SimContext): Map<string, Household> {
  return new Map(ctx.state.households.map((h) => [h.id, h]));
}

export function isPartner(person: Person, households: Map<string, Household>): boolean {
  if (!person.householdId) return false;
  const h = households.get(person.householdId);
  return !!h && h.dissolvedYear === null && h.partnerIds.includes(person.id);
}

export function partnerOf(
  person: Person,
  households: Map<string, Household>,
  ctx: SimContext,
): Person | null {
  if (!person.householdId) return null;
  const h = households.get(person.householdId);
  if (!h || h.dissolvedYear !== null || !h.partnerIds.includes(person.id)) return null;
  const otherId = h.partnerIds[0] === person.id ? h.partnerIds[1] : h.partnerIds[0];
  const other = ctx.people.get(otherId);
  return other?.alive ? other : null;
}

export function killPerson(ctx: SimContext, person: Person, cause: DeathCause) {
  if (!person.alive) return;
  const { state } = ctx;
  person.alive = false;
  person.deathYear = state.year;
  person.deathCause = cause;
  person.action = "rest";
  ctx.counters.deaths++;
  if (cause === "starvation") ctx.counters.starvationDeaths++;
  if (cause === "conflict") ctx.counters.conflictDeaths++;

  if (person.householdId) {
    const h = state.households.find((x) => x.id === person.householdId);
    if (h && h.dissolvedYear === null && h.partnerIds.includes(person.id)) {
      h.dissolvedYear = state.year;
      const otherId = h.partnerIds[0] === person.id ? h.partnerIds[1] : h.partnerIds[0];
      const other = ctx.people.get(otherId);
      if (other?.alive && other.householdId === h.id) other.householdId = null;
    }
  }

  const tribe = ctx.tribes.get(person.tribeId);
  inherit(ctx, person, tribe);
  const causeText: Record<DeathCause, string> = {
    natural: "per vecchiaia",
    starvation: "di fame",
    conflict: "in battaglia",
    illness: "di malattia",
    epidemic: "durante l'epidemia",
    disaster: "in una calamità",
  };
  if (tribe && tribe.leaderId === person.id) {
    tribe.leaderId = null;
    tribe.stability.legitimacy = clamp(tribe.stability.legitimacy - 0.12);
    tribe.stability.tension = clamp(tribe.stability.tension + 0.08);
    const followers = state.people.reduce((acc, p) => acc + (p.alive && p.tribeId === tribe.id ? 1 : 0), 0);
    const settled = state.settlements.some((s) => s.status === "active" && s.tribeId === tribe.id);
    emitEvent(ctx, {
      type: "notable_death",
      subtype: "leader",
      importance: followers >= 150 ? 4 : followers >= 50 || settled ? 3 : 2,
      actors: [actor.person(person), actor.tribe(tribe)],
      x: person.x,
      y: person.y,
      title: `Muore ${person.name}, guida dei ${tribe.name}`,
      description: `${person.name}, guida della tribù ${tribe.name}, è morto ${causeText[cause]} a ${person.age} anni presso ${describePlace(ctx.state, person.x, person.y)}.`,
      metadata: {
        personId: person.id,
        cause,
        age: person.age,
        prestige: person.prestige,
        dynastyId: person.dynastyId,
        yearsInPower: person.titleSinceYear === null ? null : state.year - person.titleSinceYear,
      },
    });
  } else if (person.notable && person.prestige >= 0.8 && person.title !== null && person.age >= 30 && tribe) {
    emitEvent(ctx, {
      type: "notable_death",
      subtype: person.title,
      importance: 2,
      actors: [actor.person(person), actor.tribe(tribe)],
      x: person.x,
      y: person.y,
      title: `Muore ${person.name}`,
      description: `${person.name}, figura di rilievo tra i ${tribe.name}, è morto ${causeText[cause]} a ${person.age} anni.`,
      metadata: {
        personId: person.id,
        cause,
        age: person.age,
        title: person.title,
        prestige: person.prestige,
      },
    });
  }
  person.title = null;
}

/** Step 8: ageing and natural mortality (age curve x health x technology). */
export function ageAndNaturalDeaths(ctx: SimContext, community: Community, effects: TechEffects) {
  const cell = cellAt(ctx.state, community.x, community.y);
  // Winter kills: how much depends on the local climate and on the shelter available.
  const winter = winterMortalityFactor(ctx.state, cell);
  const shelter = community.settlement
    ? 1 -
      Math.min(0.35, community.settlement.buildings.hut * 0.02 + community.settlement.buildings.camp * 0.03)
    : 1;
  const clothing = community.tribe.techs.includes("clothing") ? 0.9 : 1;
  const cold = 1 + (winter - 1) * shelter * clothing;
  for (const p of community.members) {
    if (!p.alive) continue;
    p.age += 1;
    const frail = p.age < 5 || p.age >= AGE.elder ? cold : 1 + (cold - 1) * 0.5;
    const risk = baseMortality(p.age) * effects.mortalityMultiplier * (1.8 - p.health * 0.9) * frail;
    if (ctx.rng.chance(risk)) killPerson(ctx, p, p.health < 0.35 && p.age < 55 ? "illness" : "natural");
  }
}

/** Step 9 (hunger half): people whose health reached zero die of starvation or illness. */
export function starvationDeaths(ctx: SimContext, community: Community) {
  for (const p of community.members) {
    if (p.alive && p.health <= 0) killPerson(ctx, p, p.hunger > 0.5 ? "starvation" : "illness");
  }
}

/** Blocks siblings, half-siblings and parent/child pairs, in either direction. */
export function related(a: Person, b: Person): boolean {
  if (a.id === b.id) return true;
  if (a.motherId && a.motherId === b.motherId) return true;
  if (a.fatherId && a.fatherId === b.fatherId) return true;
  return a.motherId === b.id || a.fatherId === b.id || b.motherId === a.id || b.fatherId === a.id;
}

/** Couples form among single adults who socialize: households are the unit that can have children. */
export function formHouseholds(ctx: SimContext, community: Community, households: Map<string, Household>) {
  const singles = community.members.filter(
    (p) => p.alive && p.age >= AGE.adult && p.age <= 50 && !isPartner(p, households),
  );
  const men = singles.filter((p) => p.sex === "M");
  const women = singles.filter((p) => p.sex === "F");
  for (const woman of women) {
    const seeking = woman.action === "socialize" || woman.action === "reproduce" || ctx.rng.chance(0.25);
    if (!seeking) continue;
    const idx = men.findIndex((m) => Math.abs(m.age - woman.age) <= 15 && !related(m, woman));
    if (idx < 0) continue;
    const [man] = men.splice(idx, 1);
    if (!man) continue;
    const { id, seq } = nextId(ctx.state, "household", "h");
    const household: Household = {
      id,
      seq,
      tribeId: community.tribe.id,
      partnerIds: [man.id, woman.id],
      formedYear: ctx.state.year,
      dissolvedYear: null,
    };
    ctx.state.households.push(household);
    households.set(id, household);
    man.householdId = id;
    woman.householdId = id;
  }
}

function eligibleSingle(p: Person, households: Map<string, Household>): boolean {
  return p.alive && p.age >= AGE.adult && p.age <= 45 && !isPartner(p, households);
}

/**
 * Exogamy: singles without a local match find partners in nearby friendly communities
 * (other villages of the tribe or neighbouring tribes). The spouse from the community
 * with a surplus of their own sex moves, which keeps small groups demographically viable.
 */
export function crossCommunityMarriages(
  ctx: SimContext,
  households: Map<string, Household>,
  trustBetween: (a: string, b: string) => number,
) {
  const pool = ctx.communities
    .map((c) => ({
      community: c,
      men: c.members.filter((p) => p.sex === "M" && eligibleSingle(p, households)),
      women: c.members.filter((p) => p.sex === "F" && eligibleSingle(p, households)),
    }))
    .filter((entry) => entry.men.length > 0 || entry.women.length > 0);
  for (const entry of pool) {
    for (const woman of entry.women) {
      if (!eligibleSingle(woman, households) || !ctx.rng.chance(0.35)) continue;
      let best: { man: Person; community: Community; d: number } | null = null;
      for (const other of pool) {
        if (other === entry) continue;
        const d = Math.max(
          Math.abs(other.community.x - entry.community.x),
          Math.abs(other.community.y - entry.community.y),
        );
        if (d > 12) continue;
        const sameTribe = other.community.tribe.id === entry.community.tribe.id;
        if (!sameTribe && trustBetween(other.community.tribe.id, entry.community.tribe.id) < 0.15) continue;
        const man = other.men.find(
          (m) => eligibleSingle(m, households) && Math.abs(m.age - woman.age) <= 15 && !related(m, woman),
        );
        if (man && (!best || d < best.d)) best = { man, community: other.community, d };
      }
      if (!best) continue;
      const { man, community } = best;
      const menHere = entry.community.members.filter((p) => p.alive && p.sex === "M").length;
      const womenHere = entry.community.members.filter((p) => p.alive && p.sex === "F").length;
      const [mover, destination] = menHere > womenHere ? [man, entry.community] : [woman, community];
      moveToCommunity(mover, destination);
      const { id, seq } = nextId(ctx.state, "household", "h");
      const household: Household = {
        id,
        seq,
        tribeId: destination.tribe.id,
        partnerIds: [man.id, woman.id],
        formedYear: ctx.state.year,
        dissolvedYear: null,
      };
      ctx.state.households.push(household);
      households.set(id, household);
      man.householdId = id;
      woman.householdId = id;
    }
  }
}

function moveToCommunity(person: Person, destination: Community) {
  person.tribeId = destination.tribe.id;
  person.settlementId = destination.settlement?.id ?? null;
  person.x = destination.x;
  person.y = destination.y;
  for (const techId of destination.tribe.techs)
    if (!person.knowledge.includes(techId)) person.knowledge.push(techId);
}

export interface BirthConditions {
  foodRatio: number;
  storedPerCapita: number;
  housingOk: boolean;
  atWar: boolean;
  populationPressure: number;
}

/** Annual probability that a fertile woman in a valid couple gives birth. Zero when conditions are not met. */
export function birthProbability(mother: Person, father: Person | null, c: BirthConditions): number {
  if (!father || !father.alive || !mother.alive) return 0;
  if (mother.sex !== "F" || mother.age < AGE.fertileMin || mother.age > AGE.fertileMax) return 0;
  if (mother.health < 0.4 || mother.hunger > 0.6) return 0;
  if (c.foodRatio < 0.8) return 0;
  const food = clamp(0.5 + (c.foodRatio - 0.8) * 1.5 + Math.min(0.4, c.storedPerCapita * 0.3), 0, 1.3);
  const intent = mother.action === "reproduce" || father.action === "reproduce" ? 1.3 : 0.85;
  const age = mother.age > 35 ? 0.55 : 1;
  const safety = c.atWar ? 0.75 : 1;
  const housing = c.housingOk ? 1 : 0.55;
  return 0.24 * food * intent * age * safety * housing * mother.health * c.populationPressure;
}

/** Step 7: births. */
export function births(
  ctx: SimContext,
  community: Community,
  households: Map<string, Household>,
  conditions: Omit<BirthConditions, "foodRatio" | "storedPerCapita">,
): Person[] {
  const newborns: Person[] = [];
  const conditionsFull: BirthConditions = {
    ...conditions,
    foodRatio: community.foodRatio,
    storedPerCapita: community.stock.food / Math.max(1, community.members.length),
  };
  const mothers = community.members.filter((p) => p.alive && p.sex === "F" && isPartner(p, households));
  for (const mother of mothers) {
    if (mother.lastChildYear !== null && ctx.state.year - mother.lastChildYear < 2) continue;
    const father = partnerOf(mother, households, ctx);
    if (!father || father.settlementId !== mother.settlementId || father.tribeId !== mother.tribeId) continue;
    if (!ctx.rng.chance(birthProbability(mother, father, conditionsFull))) continue;
    const { id, seq } = nextId(ctx.state, "person", "p");
    const child = createPerson(ctx.rng, {
      id,
      seq,
      tribeId: mother.tribeId,
      settlementId: mother.settlementId,
      x: mother.x,
      y: mother.y,
      age: 0,
      sex: ctx.rng.chance(0.51) ? "M" : "F",
      birthYear: ctx.state.year,
      knowledge: community.tribe.techs,
      mother,
      father,
      householdId: mother.householdId,
    });
    child.birthSettlementId = mother.settlementId;
    child.dynastyId = father.dynastyId ?? mother.dynastyId;
    child.prestige = round(clamp((mother.prestige + father.prestige) * 0.3));
    child.wealth = 0;
    educate(child, {
      education: (mother.education + father.education) / 2,
      knowledge: Math.min(1, community.tribe.techs.length * 0.05),
    });
    mother.lastChildYear = ctx.state.year;
    newborns.push(child);
    ctx.counters.births++;
    const leader = community.tribe.leaderId;
    if (leader === mother.id || leader === father.id) {
      child.notable = true;
      emitEvent(ctx, {
        type: "birth",
        importance: 1,
        actors: [actor.person(child), actor.tribe(community.tribe)],
        x: mother.x,
        y: mother.y,
        title: `Nasce ${child.name}, figlio della guida dei ${community.tribe.name}`,
        description: `Nella tribù ${community.tribe.name} è nato ${child.name}, figlio di ${father.name} e ${mother.name}.`,
        metadata: { personId: child.id, motherId: mother.id, fatherId: father.id },
      });
    }
  }
  return newborns;
}

const MILESTONES = [50, 100, 200, 400, 800] as const;

export function checkPopulationMilestone(ctx: SimContext, tribe: Tribe, population: number) {
  const next = MILESTONES.find((m) => m > tribe.populationMilestone && population >= m);
  if (!next) return;
  tribe.populationMilestone = next;
  emitEvent(ctx, {
    type: "population_growth",
    importance: next >= 400 ? 4 : next >= 100 ? 3 : 2,
    actors: [actor.tribe(tribe)],
    x: tribe.x,
    y: tribe.y,
    title: `I ${tribe.name} superano i ${next} abitanti`,
    description: `La popolazione della tribù ${tribe.name} ha superato le ${next} persone (${population} oggi).`,
    metadata: { population, milestone: next },
  });
}

/** Children learn from the adults around them: education slowly compounds across generations. */
export function educateCommunity(community: Community) {
  const adults = community.members.filter((p) => p.alive && p.age >= AGE.adult);
  if (adults.length === 0) return;
  const education = adults.reduce((acc, p) => acc + p.education, 0) / adults.length;
  const knowledge = Math.min(1, community.tribe.techs.length * 0.05);
  for (const p of community.members) {
    if (p.alive && p.age < 26) educate(p, { education, knowledge });
  }
}

/** Prestige drifts: it grows with age and deeds, and decays for those who do nothing. */
export function updatePrestige(community: Community) {
  for (const p of community.members) {
    if (!p.alive || p.age < AGE.adult) continue;
    const working = p.action !== "rest" && p.action !== "socialize";
    const delta = (working ? 0.004 : -0.002) + (p.role === "leader" ? 0.01 : 0) + p.skills.leadership * 0.002;
    p.prestige = round(clamp(p.prestige + delta - 0.003));
  }
}
