import { AGE } from "./constants";
import type { Community, SimContext } from "./context";
import { actor, describePlace, emitEvent } from "./events";
import { cellAt, clamp, round } from "./grid";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { killPerson } from "./population";
import type { Rng } from "./prng";
import { addResource, consumeResource, getResourceAmount, RESOURCES } from "./stock";
import { onBattleResolved, startOccupation, vassalLevy } from "./politics";
import { tribeEffects } from "./technology";
import type { Person, Relationship, Tribe } from "./types";

export interface CombatSide {
  warriors: number;
  health: number;
  morale: number;
  technology: number;
  defense: number;
  terrain: number;
  /** Supply penalty for fighting far from home, 1 = no penalty (default). */
  logistics?: number;
  /** Quality of the military leadership, 1 = average (default). */
  leadership?: number;
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
  return (
    side.warriors *
    side.health *
    side.morale *
    side.technology *
    side.defense *
    side.terrain *
    (side.logistics ?? 1) *
    (side.leadership ?? 1)
  );
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
  options: { distance?: number } = {},
): CombatSide {
  const warriors = communities.flatMap((c) => fighters(c.members));
  const committed = Math.max(0, Math.round(warriors.length * commitment));
  const effects = tribeEffects(tribe);
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
  // Supplies: an army far from its storehouses loses bite, roads soften the blow.
  const far = options.distance ?? 0;
  const supplies = communities.reduce((acc, c) => acc + c.stock.food, 0) / Math.max(1, warriors.length);
  const logistics = clamp(1 - far * 0.03 + Math.min(0.15, supplies * 0.05), 0.5, 1.15);
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const commander = leader?.alive ? 1 + leader.skills.combat * 0.15 + leader.prestige * 0.1 : 0.95;
  const barracks = defending?.settlement ? 1 + defending.settlement.buildings.barracks * 0.1 : 1;
  return {
    warriors: committed,
    health: health * (0.8 + skill * 0.4),
    morale: clamp(tribe.morale + effects.cohesion + tribe.stability.cohesion * 0.15, 0.2, 1.3),
    technology: effects.militaryMultiplier * (tribe.culture.militarism / 100 + 0.6),
    defense: defense * barracks,
    terrain,
    logistics: round(logistics, 3),
    leadership: round(commander, 3),
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
  const origin = input.attackerCommunities[0];
  const marchDistance = origin ? Math.max(Math.abs(origin.x - target.x), Math.abs(origin.y - target.y)) : 0;
  const aSide = combatSide(ctx, attacker, input.attackerCommunities, null, commitment, {
    distance: marchDistance,
  });
  const dSide = combatSide(ctx, defender, [target], target);
  // Walls turn an assault into a siege: the attacker has to grind through the defences.
  const walls = target.settlement?.buildings.walls ?? 0;
  const siege = kind === "battle" && walls > 0;
  if (siege) dSide.defense *= 1 + walls * 0.4;
  dSide.warriors = Math.round(dSide.warriors * (1 + input.allyBonus));
  if (aSide.warriors === 0) return;
  // Vassals within reach send their levy (politics.ts); casualties fall on each side's own people.
  const aOwn = aSide.warriors;
  const dOwn = dSide.warriors;
  const aLevy = kind === "battle" ? vassalLevy(ctx, attacker, target) : 0;
  const dLevy = kind === "battle" ? vassalLevy(ctx, defender, target) : 0;
  aSide.warriors += aLevy;
  dSide.warriors += dLevy;
  const outcome = resolveBattle(aSide, dSide, ctx.rng);
  const scale = kind === "raid" ? 0.5 : 1;
  const attackerMembers = input.attackerCommunities.flatMap((c) => c.members);
  const aLosses = applyCasualties(ctx, attackerMembers, outcome.attackerLossRate * scale, aOwn);
  const dLosses = applyCasualties(ctx, target.members, outcome.defenderLossRate * scale, dOwn);
  ctx.counters.battles++;
  relationship.battles++;
  relationship.conflictMemory = clamp(relationship.conflictMemory + 0.3);
  relationship.hostility = clamp(relationship.hostility + 0.15);
  relationship.trust = clamp(relationship.trust - 0.2);
  relationship.lastInteractionYear = ctx.state.year;
  // Feeds `recentDefeat` in the stability model and the "last clash" shown in the UI.
  relationship.lastConflictYear = ctx.state.year;

  const winner = outcome.attackerWins ? attacker : defender;
  const loser = outcome.attackerWins ? defender : attacker;
  winner.morale = clamp(winner.morale + 0.08, 0.2, 1);
  loser.morale = clamp(loser.morale - 0.12, 0.2, 1);

  let loot = 0;
  if (outcome.attackerWins) {
    const share = kind === "raid" ? 0.3 : 0.45;
    const source = target.stock;
    const sink = input.attackerCommunities[0]?.stock ?? attacker.stock;
    for (const key of RESOURCES) {
      const amount = round(getResourceAmount(source, key) * share, 2);
      if (amount <= 0) continue;
      consumeResource(source, key, amount);
      // Part of the plunder is lost on the way home.
      addResource(sink, key, amount * 0.85);
      if (key === "food") loot = amount;
    }
    if (!target.settlement) defender.scarcityYears = Math.max(defender.scarcityYears, 2);
    // Sacking a settlement destroys what cannot be carried away.
    if (kind === "battle" && target.settlement && ctx.rng.chance(0.4)) {
      const s = target.settlement;
      for (const type of ["hut", "storehouse", "farm", "kiln", "market"] as const) {
        if (s.buildings[type] > 0 && ctx.rng.chance(0.35)) s.buildings[type] -= 1;
      }
      s.unrest = clamp(s.unrest + 0.2);
    }
  }
  // War wears down the losing side's legitimacy and cohesion.
  const loserTribe = outcome.attackerWins ? defender : attacker;
  loserTribe.stability.legitimacy = clamp(loserTribe.stability.legitimacy - 0.05);
  loserTribe.stability.tension = clamp(loserTribe.stability.tension + 0.06);
  const winnerTribe = outcome.attackerWins ? attacker : defender;
  winnerTribe.stability.legitimacy = clamp(winnerTribe.stability.legitimacy + 0.03);
  const commander = winnerTribe.leaderId ? ctx.people.get(winnerTribe.leaderId) : undefined;
  if (commander?.alive) {
    commander.prestige = clamp(commander.prestige + 0.06);
    // A victory makes a name for someone who had none; a chief already outranks a commander.
    if (!commander.title) commander.title = "commander";
  }

  const place = describePlace(ctx.state, target.x, target.y);
  const where = target.settlement ? target.settlement.name : place;
  const title =
    kind === "raid"
      ? t("Incursione {di:att} contro {art:def}", {
          att: peoplePhrase(attacker),
          def: peoplePhrase(defender),
        })
      : target.settlement
        ? `Battaglia di ${target.settlement.name}`
        : `Battaglia presso ${place}`;
  const result = outcome.attackerWins
    ? t("{Art:att} {v:att:ha|hanno} avuto la meglio{loot}", {
        att: peoplePhrase(attacker),
        loot: loot > 0 ? `, saccheggiando ${Math.round(loot)} unità di cibo` : "",
      })
    : t("{Art:def} {v:def:ha|hanno} respinto l'attacco", { def: peoplePhrase(defender) });
  const battle = emitEvent(ctx, {
    type: "battle",
    subtype: siege ? "siege" : kind,
    importance: kind === "raid" ? 2 : 3,
    actors: [
      actor.tribe(attacker),
      actor.tribe(defender),
      ...(target.settlement ? [actor.settlement(target.settlement)] : []),
    ],
    x: target.x,
    y: target.y,
    title,
    description: t(
      "{kind} presso {where}: {aw} guerrieri {di:att} contro {dw} {di:def}. {result}. Caduti: {al} attaccanti, {dl} difensori.",
      {
        kind: kind === "raid" ? "Incursione" : "Scontro",
        where,
        aw: aSide.warriors,
        att: peoplePhrase(attacker),
        dw: dSide.warriors,
        def: peoplePhrase(defender),
        result,
        al: aLosses,
        dl: dLosses,
      },
    ),
    metadata: {
      kind,
      siege,
      attackerWins: outcome.attackerWins,
      margin: outcome.margin,
      attackerLosses: aLosses,
      defenderLosses: dLosses,
      loot: Math.round(loot),
      attackerPower: round(outcome.attackerPower, 1),
      defenderPower: round(outcome.defenderPower, 1),
      attackerWarriors: aSide.warriors,
      defenderWarriors: dSide.warriors,
      attackerLevy: aLevy,
      defenderLevy: dLevy,
      defense: round(dSide.defense, 2),
      logistics: aSide.logistics ?? 1,
      marchDistance,
      walls,
      attackerId: attacker.id,
      defenderId: defender.id,
      warStartYear: relationship.warStartYear,
    },
  });

  onBattleResolved(ctx, winner, loser);
  if (kind === "battle" && outcome.attackerWins && target.settlement && outcome.margin >= 1.6) {
    const remaining = fighters(target.members).length;
    // Walls buy the defenders one more chance before the settlement falls. A fallen
    // settlement is occupied, not annexed (politics.ts): annexation may come years later.
    const threshold = walls > 0 ? 0.35 : 0.6;
    if (remaining < aSide.warriors * threshold)
      startOccupation(ctx, attacker, defender, target.settlement, battle.id || null);
  }
}
