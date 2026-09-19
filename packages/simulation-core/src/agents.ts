import { AGE } from "./constants";
import type { Community } from "./context";
import { clamp, round } from "./grid";
import type { NamingProfile } from "./identity/definition";
import { identityPersonName } from "./identity/naming";
import { personName } from "./names";
import type { Rng } from "./prng";
import type { Action, Person, Personality, Role, Sex, Skills } from "./types";

export interface NewPersonInput {
  id: string;
  seq: number;
  tribeId: string;
  settlementId: string | null;
  x: number;
  y: number;
  age: number;
  sex: Sex;
  birthYear: number;
  knowledge: string[];
  mother?: Person | null;
  father?: Person | null;
  householdId?: string | null;
  /**
   * Naming profile of the person's historical identity. Identity names come from a stream
   * derived from `nameSeed`, so they never consume the simulation RNG.
   */
  naming?: NamingProfile | null;
  nameSeed?: string;
}

function inheritTrait(rng: Rng, a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return rng.trait();
  return clamp((a + b) / 2 + rng.range(-0.15, 0.15));
}

export function createPerson(rng: Rng, input: NewPersonInput): Person {
  const m = input.mother?.personality;
  const f = input.father?.personality;
  const personality: Personality = {
    aggression: inheritTrait(rng, m?.aggression, f?.aggression),
    cooperation: inheritTrait(rng, m?.cooperation, f?.cooperation),
    curiosity: inheritTrait(rng, m?.curiosity, f?.curiosity),
    riskTolerance: inheritTrait(rng, m?.riskTolerance, f?.riskTolerance),
    sociability: inheritTrait(rng, m?.sociability, f?.sociability),
  };
  const experience = Math.min(1, Math.max(0, input.age - 8) / 30);
  const skill = () => clamp(rng.trait(0.35, 0.15) + experience * 0.3);
  const skills: Skills = {
    gathering: skill(),
    hunting: skill() * (input.sex === "M" ? 1.1 : 0.9),
    building: skill(),
    combat: skill() * (input.sex === "M" ? 1.15 : 0.85),
    crafting: skill(),
    leadership: skill(),
  };
  const inheritedPrestige = clamp(((input.mother?.prestige ?? 0) + (input.father?.prestige ?? 0)) * 0.3);
  return {
    id: input.id,
    seq: input.seq,
    name: input.naming
      ? identityPersonName(input.naming, input.nameSeed ?? input.id, input.sex)
      : personName(rng),
    tribeId: input.tribeId,
    settlementId: input.settlementId,
    householdId: input.householdId ?? null,
    motherId: input.mother?.id ?? null,
    fatherId: input.father?.id ?? null,
    birthYear: input.birthYear,
    age: input.age,
    sex: input.sex,
    health: input.age === 0 ? 0.8 : rng.range(0.75, 1),
    hunger: 0,
    energy: 1,
    x: input.x,
    y: input.y,
    role: input.age < AGE.adult ? "child" : input.age >= AGE.elder ? "elder" : "gatherer",
    action: "rest",
    skills,
    personality,
    alive: true,
    deathYear: null,
    deathCause: null,
    knowledge: [...input.knowledge],
    lastChildYear: null,
    notable: false,
    prestige: round(inheritedPrestige),
    education: round(clamp(((input.mother?.education ?? 0) + (input.father?.education ?? 0)) * 0.25)),
    wealth: 0,
    birthSettlementId: input.settlementId,
    dynastyId: input.father?.dynastyId ?? input.mother?.dynastyId ?? null,
    title: null,
    titleSinceYear: null,
  };
}

export interface CommunityNeeds {
  food: number;
  build: number;
  threat: number;
  migration: number;
  farmSlots: number;
  canFarm: boolean;
  /** Herding slots left on the community's pastures. */
  pastureSlots: number;
  canHerd: boolean;
  /** True when a river, a coast or a port makes fishing worthwhile. */
  canFish: boolean;
  /** How much the group needs ore and stone (mines, quarries, construction). */
  minerals: number;
  canMine: boolean;
  /** How much the group needs crafted tools and goods. */
  crafts: number;
  canCraft: boolean;
}

/** Role assignment: age first, then a weighted fit between personal skills and community needs. */
export function assignRole(
  person: Person,
  needs: CommunityNeeds,
  isLeader: boolean,
  hasMilitary: boolean,
  rng: Rng,
): Role {
  if (person.age < AGE.adult) return "child";
  if (isLeader) return "leader";
  if (person.age >= AGE.elder) return "elder";
  const s = person.skills;
  const p = person.personality;
  const scores: [Role, number][] = [
    ["gatherer", s.gathering + needs.food * 0.4 + p.cooperation * 0.1],
    ["hunter", s.hunting + needs.food * 0.4 + p.riskTolerance * 0.2],
    ["builder", s.building + needs.build * 0.6],
    ["farmer", needs.canFarm && needs.farmSlots > 0 ? s.gathering + 0.6 + needs.food * 0.3 : -1],
    [
      "herder",
      needs.canHerd && needs.pastureSlots > 0
        ? s.gathering * 0.6 + s.hunting * 0.4 + 0.5 + needs.food * 0.3
        : -1,
    ],
    ["fisher", needs.canFish ? s.hunting * 0.7 + 0.35 + needs.food * 0.35 : -1],
    ["miner", needs.canMine ? s.building * 0.6 + s.crafting * 0.3 + needs.minerals * 0.8 - 0.2 : -1],
    ["crafter", needs.canCraft ? s.crafting + needs.crafts * 0.7 - 0.25 : -1],
    [
      "warrior",
      hasMilitary || needs.threat > 0.5 ? s.combat + needs.threat * 0.6 + p.aggression * 0.2 - 0.3 : -1,
    ],
  ];
  let best: Role = "gatherer";
  let bestScore = -Infinity;
  for (const [role, base] of scores) {
    if (base < 0) continue;
    const score = base + (person.role === role ? 0.15 : 0) + rng.next() * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = role;
    }
  }
  if (best === "farmer") needs.farmSlots -= 1;
  if (best === "herder") needs.pastureSlots -= 1;
  return best;
}

const ROLE_ACTION: Partial<Record<Role, Action>> = {
  gatherer: "gather",
  hunter: "hunt",
  builder: "build",
  farmer: "farm",
  warrior: "defend",
  herder: "herd",
  fisher: "fish",
  miner: "mine",
  crafter: "craft",
};

/**
 * Deterministic utility scoring: every candidate action gets a weighted score from
 * needs, personality and role; seeded noise breaks ties. The highest score wins.
 */
export function chooseAction(
  person: Person,
  community: Community,
  needs: CommunityNeeds,
  single: boolean,
  rng: Rng,
): Action {
  if (!person.alive) return "rest";
  const p = person.personality;
  if (person.age < AGE.workingChild) return rng.chance(0.5) ? "socialize" : "rest";

  const roleAction = ROLE_ACTION[person.role];
  const fertile = person.age >= AGE.fertileMin && person.age <= AGE.fertileMax && person.householdId !== null;
  const smallGroup = community.members.length < 8 ? 1 : 0;
  const scores: [Action, number][] = [
    ["rest", (1 - person.energy) * 1.2 + (1 - person.health) * 0.9 + (person.age >= AGE.elder ? 0.35 : 0)],
    ["gather", 0.35 + needs.food * 0.8 + person.skills.gathering * 0.4],
    ["hunt", 0.3 + needs.food * 0.8 + person.skills.hunting * 0.4 + p.riskTolerance * 0.2],
    ["farm", needs.canFarm && person.role === "farmer" ? 0.5 + needs.food * 0.9 : -1],
    ["herd", needs.canHerd && person.role === "herder" ? 0.5 + needs.food * 0.8 : -1],
    ["fish", needs.canFish && person.role === "fisher" ? 0.45 + needs.food * 0.85 : -1],
    ["mine", needs.canMine && person.role === "miner" ? 0.35 + needs.minerals * 0.9 : -1],
    ["craft", needs.canCraft && person.role === "crafter" ? 0.35 + needs.crafts * 0.9 : -1],
    ["build", needs.build > 0 ? 0.2 + needs.build * 0.7 + person.skills.building * 0.4 : -1],
    [
      "socialize",
      p.sociability * 0.45 + (single && person.age >= AGE.adult ? 0.35 : 0) + (1 - needs.food) * 0.15,
    ],
    ["move", needs.migration > 0 ? p.curiosity * 0.4 + needs.migration * 0.7 : -1],
    ["join_group", smallGroup ? 0.4 + p.sociability * 0.3 : -1],
    ["reproduce", fertile ? 0.25 + (1 - needs.food) * 0.5 + p.sociability * 0.15 : -1],
    ["defend", needs.threat > 0 ? needs.threat * 1.1 + p.aggression * 0.3 + person.skills.combat * 0.3 : -1],
  ];
  let best: Action = "rest";
  let bestScore = -Infinity;
  for (const [action, base] of scores) {
    if (base < 0) continue;
    const roleBias = roleAction === action ? 0.35 : 0;
    const score = base + roleBias + rng.next() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

export function applyActionEffects(person: Person, action: Action) {
  const effort: Partial<Record<Action, number>> = {
    gather: 0.25,
    hunt: 0.35,
    farm: 0.3,
    build: 0.35,
    move: 0.3,
    defend: 0.3,
    herd: 0.25,
    fish: 0.28,
    mine: 0.4,
    craft: 0.25,
  };
  const cost = effort[action] ?? 0;
  person.energy = clamp(action === "rest" ? person.energy + 0.5 : person.energy - cost + 0.25);
  const learn = 0.012;
  if (action === "gather" || action === "farm" || action === "herd")
    person.skills.gathering = clamp(person.skills.gathering + learn);
  if (action === "hunt" || action === "fish") person.skills.hunting = clamp(person.skills.hunting + learn);
  if (action === "build" || action === "mine") person.skills.building = clamp(person.skills.building + learn);
  if (action === "defend") person.skills.combat = clamp(person.skills.combat + learn);
  if (action === "craft") person.skills.crafting = clamp(person.skills.crafting + learn);
  if (action === "socialize") person.skills.leadership = clamp(person.skills.leadership + learn * 0.5);
}

const WORKER_ACTIONS = new Set<Action>([
  "gather",
  "hunt",
  "farm",
  "build",
  "defend",
  "herd",
  "fish",
  "mine",
  "craft",
]);

export function isWorker(action: Action): boolean {
  return WORKER_ACTIONS.has(action);
}
