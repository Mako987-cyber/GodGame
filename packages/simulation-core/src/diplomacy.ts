import { CONTACT_DISTANCE } from "./constants";
import type { Community, SimContext } from "./context";
import { exchangeGoods } from "./economy";
import { actor, emitEvent } from "./events";
import { clamp, distance } from "./grid";
import { shareKnowledge } from "./technology";
import type { Relationship, Tribe } from "./types";
import { combatSide, sidePower, wageConflict } from "./warfare";

export interface TribeProfile {
  tribe: Tribe;
  communities: Community[];
  population: number;
  aggression: number;
  cooperation: number;
  scarcity: number;
  power: number;
  hasCopperAccess: boolean;
  /** Population relative to what the tribe's land can hold (0..1): drives land hunger. */
  crowding: number;
}

export function relationshipKey(a: Tribe, b: Tribe): string {
  return a.seq < b.seq ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

export function buildProfiles(ctx: SimContext): Map<string, TribeProfile> {
  const profiles = new Map<string, TribeProfile>();
  for (const tribe of ctx.state.tribes) {
    if (tribe.status === "extinct") continue;
    const communities = ctx.communities.filter((c) => c.tribe.id === tribe.id);
    const members = communities.flatMap((c) => c.members).filter((p) => p.alive);
    if (members.length === 0) continue;
    const adults = members.filter((p) => p.age >= 16);
    const avg = (k: "aggression" | "cooperation") =>
      adults.length ? adults.reduce((acc, p) => acc + p.personality[k], 0) / adults.length : 0.5;
    const scarcity = Math.max(
      tribe.scarcityYears / 3,
      ...communities.map((c) => (c.settlement ? c.settlement.famineYears / 4 : 0)),
      ...communities.map((c) => 1 - Math.min(1, c.foodRatio)),
    );
    profiles.set(tribe.id, {
      tribe,
      communities,
      population: members.length,
      aggression: avg("aggression"),
      cooperation: avg("cooperation"),
      scarcity: clamp(scarcity),
      power: sidePower(combatSide(ctx, tribe, communities, null)),
      hasCopperAccess: communities.some((c) => c.area.some((cell) => cell.copper > 0)),
      crowding: clamp(
        Math.max(
          0,
          ...communities
            .filter((c) => c.settlement)
            .map(
              (c) =>
                c.members.length / Math.max(1, c.area.reduce((acc, cell) => acc + cell.habitability, 0) * 6),
            ),
        ),
      ),
    });
  }
  return profiles;
}

function closestPair(a: TribeProfile, b: TribeProfile): { ca: Community; cb: Community; d: number } | null {
  let best: { ca: Community; cb: Community; d: number } | null = null;
  for (const ca of a.communities) {
    for (const cb of b.communities) {
      let d = distance(ca.x, ca.y, cb.x, cb.y);
      // Roads shorten effective distance between linked settlements.
      if (ca.settlement && cb.settlement && ca.settlement.roadLinks.includes(cb.settlement.id))
        d = Math.ceil(d / 2);
      if (!best || d < best.d) best = { ca, cb, d };
    }
  }
  return best;
}

function allyBonus(
  ctx: SimContext,
  defender: Tribe,
  attacker: Tribe,
  profiles: Map<string, TribeProfile>,
  target: Community,
): number {
  let bonus = 0;
  for (const rel of ctx.state.relationships) {
    if (!rel.allied || (rel.aId !== defender.id && rel.bId !== defender.id)) continue;
    const allyId = rel.aId === defender.id ? rel.bId : rel.aId;
    if (allyId === attacker.id) continue;
    const ally = profiles.get(allyId);
    if (ally && ally.communities.some((c) => distance(c.x, c.y, target.x, target.y) <= 10)) bonus += 0.3;
  }
  return Math.min(0.6, bonus);
}

/**
 * Step 13: inter-group relations. Trust and hostility drift from personality, scarcity,
 * borders and past interactions; each pair then takes at most one action per year.
 */
export function updateDiplomacy(ctx: SimContext, profiles: Map<string, TribeProfile>) {
  const { state } = ctx;
  const byKey = new Map(state.relationships.map((r) => [r.id, r]));
  const list = [...profiles.values()].sort((a, b) => a.tribe.seq - b.tribe.seq);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!a || !b) continue;
      const pair = closestPair(a, b);
      if (!pair) continue;
      const key = relationshipKey(a.tribe, b.tribe);
      let rel = byKey.get(key);
      if (!rel) {
        if (pair.d > CONTACT_DISTANCE) continue;
        rel = {
          id: key,
          aId: a.tribe.seq < b.tribe.seq ? a.tribe.id : b.tribe.id,
          bId: a.tribe.seq < b.tribe.seq ? b.tribe.id : a.tribe.id,
          trust: Math.round((0.05 + (a.cooperation + b.cooperation) * 0.1) * 1000) / 1000,
          hostility: 0.05,
          tradeVolume: 0,
          conflictMemory: 0,
          atWar: false,
          warStartYear: null,
          allied: false,
          distance: pair.d,
          lastInteractionYear: state.year,
          battles: 0,
          truceUntilYear: null,
        };
        state.relationships.push(rel);
        byKey.set(key, rel);
      }
      rel.distance = pair.d;
      updateRelationValues(rel, a, b, pair.d);
      if (pair.d > CONTACT_DISTANCE && !rel.atWar) continue;
      decideAction(ctx, rel, a, b, pair, profiles);
      roundRelationship(rel);
    }
  }
}

function updateRelationValues(rel: Relationship, a: TribeProfile, b: TribeProfile, d: number) {
  const inContact = d <= CONTACT_DISTANCE;
  const border = d <= 5 ? 1 : d <= 8 ? 0.5 : 0;
  const scarcity = Math.max(a.scarcity, b.scarcity);
  const crowding = Math.max(a.crowding, b.crowding);
  const aggression = (a.aggression + b.aggression) / 2;
  const cooperation = (a.cooperation + b.cooperation) / 2;
  // Strategic resource: one side has copper in reach, the other knows how to use it but lacks it.
  const contested =
    (a.hasCopperAccess && !b.hasCopperAccess && b.tribe.techs.includes("copper_working")) ||
    (b.hasCopperAccess && !a.hasCopperAccess && a.tribe.techs.includes("copper_working"))
      ? 1
      : 0;
  if (inContact) {
    rel.hostility +=
      aggression * 0.012 +
      scarcity * border * 0.04 +
      border * (0.01 + crowding * 0.035) +
      contested * 0.015 +
      rel.conflictMemory * 0.01 -
      rel.trust * 0.02;
    rel.trust += cooperation * 0.01 - rel.hostility * 0.025 + (rel.allied ? 0.008 : 0);
  }
  rel.hostility = clamp(rel.hostility * 0.97);
  rel.trust = clamp(rel.trust * 0.98);
  rel.conflictMemory = clamp(rel.conflictMemory * 0.98);
  rel.tradeVolume = rel.tradeVolume * 0.98;
}

function roundRelationship(rel: Relationship) {
  rel.trust = Math.round(rel.trust * 1000) / 1000;
  rel.hostility = Math.round(rel.hostility * 1000) / 1000;
  rel.conflictMemory = Math.round(rel.conflictMemory * 1000) / 1000;
  rel.tradeVolume = Math.round(rel.tradeVolume * 100) / 100;
}

function decideAction(
  ctx: SimContext,
  rel: Relationship,
  a: TribeProfile,
  b: TribeProfile,
  pair: { ca: Community; cb: Community; d: number },
  profiles: Map<string, TribeProfile>,
) {
  const { state, rng } = ctx;
  const elapsed = state.tick;

  if (rel.atWar) {
    const years = state.year - (rel.warStartYear ?? state.year);
    const weariness = Math.min(0.5, years * 0.04);
    const exhausted = a.population < 12 || b.population < 12;
    if ((years >= 3 && rng.chance(0.08 + weariness)) || exhausted) {
      rel.atWar = false;
      rel.warStartYear = null;
      rel.truceUntilYear = state.year + rng.int(20, 40);
      rel.hostility = clamp(rel.hostility - 0.45);
      rel.trust = Math.max(rel.trust, 0.1);
      emitEvent(ctx, {
        type: "peace",
        importance: 4,
        actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
        x: pair.ca.x,
        y: pair.ca.y,
        title: `Pace tra ${a.tribe.name} e ${b.tribe.name}`,
        description: `Dopo ${years} anni di guerra e ${rel.battles} scontri, i ${a.tribe.name} e i ${b.tribe.name} hanno stipulato la pace.`,
        metadata: { years, battles: rel.battles },
      });
      return;
    }
    if (pair.d <= 12 && rng.chance(0.35)) {
      const [att, def, target] =
        a.power * (0.8 + rng.next() * 0.4) >= b.power ? [a, b, pair.cb] : [b, a, pair.ca];
      wageConflict(ctx, {
        attacker: att.tribe,
        defender: def.tribe,
        attackerCommunities: att.communities.filter((c) => distance(c.x, c.y, target.x, target.y) <= 12),
        target,
        defenderCommunities: def.communities,
        relationship: rel,
        kind: "battle",
        allyBonus: allyBonus(ctx, def.tribe, att.tribe, profiles, target),
      });
    }
    return;
  }

  // Aggressor is the side with the stronger motive (scarcity + aggression + military edge).
  const motive = (x: TribeProfile, y: TribeProfile) =>
    rel.hostility * 0.9 +
    x.scarcity * 0.4 +
    x.aggression * 0.3 +
    x.crowding * 0.35 +
    clamp(x.power / Math.max(1, y.power) - 1, 0, 1) * 0.4 +
    rel.conflictMemory * 0.2 +
    (y.population < x.population * 0.6 ? 0.2 : 0) -
    rel.trust * 0.8;
  const [att, def] = motive(a, b) >= motive(b, a) ? [a, b] : [b, a];
  const warScore = motive(att, def);
  const advantage = att.power / Math.max(1, def.power);
  const target = att === a ? pair.cb : pair.ca;

  if (
    elapsed >= state.settings.warGraceYears &&
    (rel.truceUntilYear === null || state.year >= rel.truceUntilYear) &&
    att.population >= 20 &&
    def.population >= 10 &&
    advantage > 1.1 &&
    warScore > 0.6 &&
    pair.d <= 10 &&
    rng.chance(0.05)
  ) {
    rel.atWar = true;
    rel.warStartYear = state.year;
    rel.allied = false;
    const reasons: string[] = [];
    if (att.scarcity > 0.3) reasons.push("dalla fame");
    if (att.crowding > 0.6) reasons.push("dalla fame di terre");
    if (rel.conflictMemory > 0.2) reasons.push("da vecchi rancori");
    if (att.aggression > 0.55) reasons.push("dall'indole bellicosa");
    if (advantage > 1.5) reasons.push("dalla superiorità numerica");
    emitEvent(ctx, {
      type: "conflict",
      importance: 4,
      actors: [actor.tribe(att.tribe), actor.tribe(def.tribe)],
      x: target.x,
      y: target.y,
      title: `Guerra tra ${att.tribe.name} e ${def.tribe.name}`,
      description: `I ${att.tribe.name} hanno dichiarato guerra ai ${def.tribe.name}${reasons.length ? `, spinti ${reasons.join(", ")}` : ""}.`,
      metadata: {
        attackerId: att.tribe.id,
        defenderId: def.tribe.id,
        warScore: Math.round(warScore * 100) / 100,
        advantage: Math.round(advantage * 100) / 100,
      },
    });
    return;
  }

  if (
    elapsed >= state.settings.raidGraceYears &&
    att.scarcity > 0.4 &&
    att.aggression > 0.5 &&
    advantage > 1.2 &&
    pair.d <= 8 &&
    target.stock.food > 5 &&
    rng.chance(0.01 + att.scarcity * 0.03)
  ) {
    wageConflict(ctx, {
      attacker: att.tribe,
      defender: def.tribe,
      attackerCommunities: [att === a ? pair.ca : pair.cb],
      target,
      defenderCommunities: def.communities,
      relationship: rel,
      kind: "raid",
      allyBonus: allyBonus(ctx, def.tribe, att.tribe, profiles, target),
    });
    return;
  }

  if (rel.trust > 0.25 && rel.hostility < 0.5 && pair.d <= 12) {
    const before = rel.tradeVolume;
    const volume = exchangeGoods(
      pair.ca.stock,
      pair.ca.members.length,
      pair.cb.stock,
      pair.cb.members.length,
    );
    if (volume > 0) {
      rel.tradeVolume += volume;
      rel.trust = clamp(rel.trust + 0.008);
      rel.lastInteractionYear = state.year;
      const firstTrade = before < 1;
      if (firstTrade || (before < 150 && rel.tradeVolume >= 150)) {
        emitEvent(ctx, {
          type: "trade",
          importance: 2,
          actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
          x: pair.ca.x,
          y: pair.ca.y,
          title: firstTrade
            ? `Primi scambi tra ${a.tribe.name} e ${b.tribe.name}`
            : `Rotta commerciale ${a.tribe.name}–${b.tribe.name}`,
          description: firstTrade
            ? `I ${a.tribe.name} e i ${b.tribe.name} hanno iniziato a scambiarsi cibo e materiali.`
            : `Gli scambi tra ${a.tribe.name} e ${b.tribe.name} sono diventati regolari: una vera rotta commerciale.`,
          metadata: { volume: Math.round(volume * 100) / 100, totalVolume: Math.round(rel.tradeVolume) },
        });
      }
    }
    if (rel.trust > 0.4) {
      const roads =
        pair.ca.settlement &&
        pair.cb.settlement &&
        pair.ca.settlement.roadLinks.includes(pair.cb.settlement.id)
          ? 0.03
          : 0;
      shareKnowledge(ctx, a.tribe, b.tribe, 0.04 + roads);
      shareKnowledge(ctx, b.tribe, a.tribe, 0.04 + roads);
    }
  } else if (pair.d <= 6 && rel.hostility < 0.4) {
    // Living side by side spreads know-how slowly even without formal trade.
    shareKnowledge(ctx, a.tribe, b.tribe, 0.012);
    shareKnowledge(ctx, b.tribe, a.tribe, 0.012);
  }

  if (!rel.allied && rel.trust > 0.7 && rel.hostility < 0.1 && rng.chance(0.1)) {
    rel.allied = true;
    emitEvent(ctx, {
      type: "alliance",
      importance: 3,
      actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
      x: pair.ca.x,
      y: pair.ca.y,
      title: `Alleanza tra ${a.tribe.name} e ${b.tribe.name}`,
      description: `Anni di fiducia reciproca hanno portato i ${a.tribe.name} e i ${b.tribe.name} a stringere un'alleanza.`,
      metadata: { trust: rel.trust },
    });
  } else if (rel.allied && rel.trust < 0.35) {
    rel.allied = false;
  }
}
