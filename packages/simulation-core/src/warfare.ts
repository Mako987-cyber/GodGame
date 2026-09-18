import { AGE } from "./constants";
import type { Community, SimContext } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { cellAt, clamp } from "./grid";
import { killPerson } from "./population";
import type { Rng } from "./prng";
import { grantTech, techEffects } from "./technology";
import type { Person, Relationship, Tribe } from "./types";

export interface CombatSide {
  warriors: number;
  health: number;
  morale: number;
  technology: number;
  defense: number;
  terrain: number;
}

export interface BattleOutcome {
  attackerPower: number;
  defenderPower: number;
  attackerWins: boolean;
  /** Winner roll / loser roll (≥ 1). */
  margin: number;
  attackerLossRate: number;
  defenderLossRate: number;
}

export function sidePower(side: CombatSide): number {
  return side.warriors * side.health * side.morale * side.technology * side.defense * side.terrain;
}

/**
 * Abstract battle: each side's power is multiplied by a seeded roll in [0.75, 1.25].
 * Same inputs + same RNG state = same result.
 */
export function resolveBattle(attacker: CombatSide, defender: CombatSide, rng: Rng): BattleOutcome {
  const attackerPower = sidePower(attacker);
  const defenderPower = sidePower(defender);
  const aRoll = attackerPower * (0.75 + rng.next() * 0.5);
  const dRoll = defenderPower * (0.75 + rng.next() * 0.5);
  const attackerWins = aRoll > dRoll;
  const margin = attackerWins ? aRoll / Math.max(0.01, dRoll) : dRoll / Math.max(0.01, aRoll);
  const loserRate = clamp(0.1 + 0.07 * Math.min(margin, 4), 0.1, 0.4);
  const winnerRate = clamp(0.03 + 0.08 / margin, 0.03, 0.12);
  return {
    attackerPower,
    defenderPower,
    attackerWins,
    margin: Math.round(margin * 100) / 100,
    attackerLossRate: Math.round((attackerWins ? winnerRate : loserRate) * 1000) / 1000,
    defenderLossRate: Math.round((attackerWins ? loserRate : winnerRate) * 1000) / 1000,
  };
}

export function fighters(members: Person[]): Person[] {
  return members.filter((p) => p.alive && p.age >= AGE.adult && p.age <= AGE.combatMax && p.health > 0.3);
}

export function combatSide(
  ctx: SimContext,
  tribe: Tribe,
  communities: Community[],
  defending: Community | null,
  commitment = 1,
): CombatSide {
  const warriors = communities.flatMap((c) => fighters(c.members));
  const committed = Math.max(0, Math.round(warriors.length * commitment));
  const effects = techEffects(tribe.techs);
  const health = warriors.length ? warriors.reduce((acc, p) => acc + p.health, 0) / warriors.length : 0;
  const skill = warriors.length ? warriors.reduce((acc, p) => acc + p.skills.combat, 0) / warriors.length : 0;
  const defenders = defending ? defending.members.filter((p) => p.action === "defend").length : 0;
  let defense = 1;
  let terrain = 1;
  if (defending) {
    defense = defending.settlement ? defending.settlement.defense : 1;
    defense *= 1 + Math.min(0.3, (defenders / Math.max(1, warriors.length)) * 0.5);
    const cell = cellAt(ctx.state, defending.x, defending.y);
    terrain =
      cell.biome === "hills" ? 1.15 : cell.biome === "mountain" ? 1.3 : cell.biome === "forest" ? 1.1 : 1;
  }
  return {
    warriors: committed,
    health: health * (0.8 + skill * 0.4),
    morale: clamp(tribe.morale + effects.cohesion, 0.2, 1.3),
    technology: effects.militaryMultiplier,
    defense,
    terrain,
  };
}

function applyCasualties(ctx: SimContext, members: Person[], rate: number, committed: number): number {
  const pool = fighters(members);
  const count = Math.min(pool.length, Math.round(committed * rate));
  ctx.rng.shuffle(pool);
  for (let i = 0; i < count; i++) {
    const p = pool[i];
    if (p) killPerson(ctx, p, "conflict");
  }
  return count;
}

export interface ConflictInput {
  attacker: Tribe;
  defender: Tribe;
  attackerCommunities: Community[];
  target: Community;
  defenderCommunities: Community[];
  relationship: Relationship;
  kind: "raid" | "battle";
  allyBonus: number;
}

/** Applies a battle or raid: casualties, looting, morale, possible occupation of a settlement. */
export function wageConflict(ctx: SimContext, input: ConflictInput) {
  const { attacker, defender, target, relationship, kind } = input;
  const commitment = kind === "raid" ? 0.5 : 1;
  const aSide = combatSide(ctx, attacker, input.attackerCommunities, null, commitment);
  const dSide = combatSide(ctx, defender, [target], target);
  dSide.warriors = Math.round(dSide.warriors * (1 + input.allyBonus));
  if (aSide.warriors === 0) return;
  const outcome = resolveBattle(aSide, dSide, ctx.rng);
  const scale = kind === "raid" ? 0.5 : 1;
  const attackerMembers = input.attackerCommunities.flatMap((c) => c.members);
  const aLosses = applyCasualties(ctx, attackerMembers, outcome.attackerLossRate * scale, aSide.warriors);
  const dLosses = applyCasualties(ctx, target.members, outcome.defenderLossRate * scale, dSide.warriors);
  ctx.counters.battles++;
  relationship.battles++;
  relationship.conflictMemory = clamp(relationship.conflictMemory + 0.3);
  relationship.hostility = clamp(relationship.hostility + 0.15);
  relationship.trust = clamp(relationship.trust - 0.2);
  relationship.lastInteractionYear = ctx.state.year;

  const winner = outcome.attackerWins ? attacker : defender;
  const loser = outcome.attackerWins ? defender : attacker;
  winner.morale = clamp(winner.morale + 0.08, 0.2, 1);
  loser.morale = clamp(loser.morale - 0.12, 0.2, 1);

  let loot = 0;
  if (outcome.attackerWins) {
    const share = kind === "raid" ? 0.3 : 0.45;
    const source = target.stock;
    const sink = input.attackerCommunities[0]?.stock ?? attacker.stock;
    for (const key of ["food", "wood", "stone", "copper"] as const) {
      const amount = Math.round(source[key] * share * 100) / 100;
      source[key] = Math.round((source[key] - amount) * 100) / 100;
      sink[key] = Math.round((sink[key] + amount) * 100) / 100;
      if (key === "food") loot = amount;
    }
    if (!target.settlement) defender.scarcityYears = Math.max(defender.scarcityYears, 2);
  }

  const place = describePlace(ctx.state, target.x, target.y);
  const where = target.settlement ? target.settlement.name : place;
  const title =
    kind === "raid"
      ? `Incursione dei ${attacker.name} contro i ${defender.name}`
      : target.settlement
        ? `Battaglia di ${target.settlement.name}`
        : `Battaglia presso ${place}`;
  const result = outcome.attackerWins
    ? `I ${attacker.name} hanno avuto la meglio${loot > 0 ? `, saccheggiando ${Math.round(loot)} unità di cibo` : ""}`
    : `I ${defender.name} hanno respinto l'attacco`;
  emitEvent(ctx, {
    type: "battle",
    importance: kind === "raid" ? 2 : 3,
    actors: [
      actor.tribe(attacker),
      actor.tribe(defender),
      ...(target.settlement ? [actor.settlement(target.settlement)] : []),
    ],
    x: target.x,
    y: target.y,
    title,
    description: `${kind === "raid" ? "Incursione" : "Scontro"} presso ${where}: ${aSide.warriors} guerrieri ${attacker.name} contro ${dSide.warriors} ${defender.name}. ${result}. Caduti: ${aLosses} attaccanti, ${dLosses} difensori.`,
    metadata: {
      kind,
      attackerWins: outcome.attackerWins,
      margin: outcome.margin,
      attackerLosses: aLosses,
      defenderLosses: dLosses,
      loot: Math.round(loot),
      attackerPower: Math.round(outcome.attackerPower * 10) / 10,
      defenderPower: Math.round(outcome.defenderPower * 10) / 10,
    },
  });

  if (kind === "battle" && outcome.attackerWins && target.settlement && outcome.margin >= 1.6) {
    const remaining = fighters(target.members).length;
    if (remaining < aSide.warriors * 0.6) occupySettlement(ctx, attacker, defender, target);
  }
}

function occupySettlement(ctx: SimContext, attacker: Tribe, defender: Tribe, target: Community) {
  const s = target.settlement;
  if (!s) return;
  s.tribeId = attacker.id;
  s.civilizationId = attacker.civilizationId;
  s.construction = null;
  const survivors = target.members.filter((p) => p.alive);
  const carried = new Set(survivors.flatMap((p) => p.knowledge));
  for (const p of survivors) p.tribeId = attacker.id;
  for (const h of ctx.state.households) {
    const partner = ctx.people.get(h.partnerIds[0]);
    if (partner && partner.settlementId === s.id) h.tribeId = attacker.id;
  }
  if (defender.leaderId && survivors.some((p) => p.id === defender.leaderId)) defender.leaderId = null;
  const remainingOwn = ctx.state.settlements.filter(
    (o) => o.status === "active" && o.tribeId === defender.id,
  );
  if (remainingOwn.length === 0 && defender.status === "settled") {
    defender.status = "nomadic";
  }
  target.tribe = attacker;
  emitEvent(ctx, {
    type: "conquest",
    importance: 5,
    actors: [actor.tribe(attacker), actor.tribe(defender), actor.settlement(s)],
    x: s.x,
    y: s.y,
    title: `${s.name} conquistata dai ${attacker.name}`,
    description: `Dopo la sconfitta, ${s.name} è passata sotto il controllo dei ${attacker.name}. ${survivors.length} abitanti sono stati assorbiti dai vincitori.`,
    metadata: { settlementId: s.id, previousTribeId: defender.id, survivors: survivors.length },
  });
  for (const techId of carried) grantTech(ctx, attacker, techId, "conquest", defender);
}
