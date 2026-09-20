import { CONTACT_DISTANCE } from "./constants";
import { agree } from "./language/italian";
import { formatEventDescription as t, polityPhrase } from "./language/format";
import type { Community, SimContext } from "./context";
import { isUnderEpidemic } from "./crises";
import { culturalDistance } from "./culture";
import { exchangeGoods } from "./economy";
import { actor, emitEvent } from "./events";
import { clamp, distance, round } from "./grid";
import { areaDeposits } from "./resources";
import { getResourceAmount } from "./stock";
import { shareKnowledge, tribeEffects } from "./technology";
import type { ConflictPhase, DiplomaticStatus, Relationship, Tribe } from "./types";
import { imposePeaceTerms, vassalBond } from "./politics";
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
  /** Deposits of tin and iron reachable from the tribe's territory. */
  hasTinAccess: boolean;
  hasIronAccess: boolean;
  /** Surplus and deficits driving trade. */
  foodPerCapita: number;
  toolsPerCapita: number;
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
      hasTinAccess: communities.some((c) => areaDeposits(c.area).tin > 0),
      hasIronAccess: communities.some((c) => areaDeposits(c.area).iron > 0),
      foodPerCapita: round(
        communities.reduce((acc, c) => acc + c.stock.food, 0) / Math.max(1, members.length),
        2,
      ),
      toolsPerCapita: round(
        communities.reduce((acc, c) => acc + getResourceAmount(c.stock, "tools"), 0) /
          Math.max(1, members.length),
        3,
      ),
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
          respect: 0.1,
          tradeDependency: 0,
          culturalDistance: culturalDistance(a.tribe.culture, b.tribe.culture),
          status: "contact",
          phase: "peace",
          lastConflictYear: null,
          phaseYears: 0,
          fusionYears: 0,
        };
        state.relationships.push(rel);
        byKey.set(key, rel);
        // Two handfuls of people meeting is not a historical event.
        if (a.population >= 25 && b.population >= 25)
          emitEvent(ctx, {
            type: "trade",
            subtype: "first_contact",
            importance: 2,
            actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
            x: pair.ca.x,
            y: pair.ca.y,
            title: t("{Art:a} {v:a:incontra|incontrano} {art:b}", {
              a: polityPhrase(a.tribe, state.civilizations),
              b: polityPhrase(b.tribe, state.civilizations),
            }),
            description: `Due gruppi finora ignari l'uno dell'altro si sono incontrati a ${pair.d} celle di distanza.`,
            metadata: {
              distance: pair.d,
              culturalDistance: rel.culturalDistance,
              populationA: a.population,
              populationB: b.population,
            },
          });
      }
      rel.distance = pair.d;
      const phaseBefore = rel.phase;
      updateRelationValues(rel, a, b, pair.d);
      if (pair.d > CONTACT_DISTANCE && !rel.atWar) {
        updateStatus(rel, state.year, phaseBefore);
        // Explicit political bonds are visible in diplomacy (unless the pair is at war).
        if (!rel.atWar && vassalBond(state, rel.aId, rel.bId)) rel.status = "vassalage";
        else if (!rel.atWar && occupies(state, rel.aId, rel.bId)) rel.status = "occupation";
        continue;
      }
      decideAction(ctx, rel, a, b, pair, profiles);
      updateStatus(rel, state.year, phaseBefore);
      roundRelationship(rel);
    }
  }
}

/**
 * Diplomatic label derived from the underlying values, kept consistent with `atWar`/`allied`.
 * `phaseYears` counts the years spent in the current *phase* of the escalation ladder, which is
 * what the ladder itself gates on; an expired truce drops back to peace so a new cycle can start.
 */
function updateStatus(rel: Relationship, year: number, phaseBefore: ConflictPhase) {
  const truceHolds = rel.truceUntilYear !== null && year < rel.truceUntilYear;
  if (!truceHolds && rel.phase === "truce" && !rel.atWar) rel.phase = "peace";

  let status: DiplomaticStatus;
  if (rel.atWar) status = "war";
  else if (truceHolds) status = "truce";
  else if (rel.allied) status = "allied";
  else if (rel.hostility > 0.5 && rel.trust < 0.3) status = "rival";
  else if (rel.tradeVolume > 20 && rel.trust > 0.25) status = "trade_partner";
  else if (rel.lastInteractionYear !== 0) status = rel.trust > 0.15 ? "neutral" : "contact";
  else status = "contact";
  rel.status = status;
  rel.phaseYears = rel.phase === phaseBefore ? rel.phaseYears + 1 : 0;
}

/** One side of the pair holds settlements of the other under occupation. */
function occupies(state: SimContext["state"], aId: string, bId: string): boolean {
  return state.occupations.some(
    (o) =>
      o.status === "active" &&
      ((o.occupyingCivilizationId === aId && o.occupiedCivilizationId === bId) ||
        (o.occupyingCivilizationId === bId && o.occupiedCivilizationId === aId)),
  );
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
  // Cultures that are far apart trust each other less and clash more easily.
  rel.culturalDistance = culturalDistance(a.tribe.culture, b.tribe.culture);
  const militarism = (a.tribe.culture.militarism + b.tribe.culture.militarism) / 200;
  const openness = (a.tribe.culture.tradeOpenness + b.tribe.culture.tradeOpenness) / 200;
  if (inContact) {
    rel.hostility +=
      aggression * 0.012 +
      scarcity * border * 0.04 +
      border * (0.01 + crowding * 0.035) +
      contested * 0.015 +
      rel.conflictMemory * 0.01 +
      rel.culturalDistance * 0.012 +
      militarism * 0.01 -
      rel.trust * 0.02;
    rel.trust +=
      cooperation * 0.01 +
      openness * 0.008 -
      rel.hostility * 0.025 +
      (rel.allied ? 0.008 : 0) -
      rel.culturalDistance * 0.006;
    // Respect tracks the other side's power and reliability, independently of liking them.
    const strength = clamp(b.power / Math.max(1, a.power + b.power));
    rel.respect = clamp(rel.respect + (strength - rel.respect) * 0.05 + rel.tradeDependency * 0.01);
  }
  rel.hostility = clamp(rel.hostility * 0.97);
  rel.trust = clamp(rel.trust * 0.98);
  rel.conflictMemory = clamp(rel.conflictMemory * 0.98);
  rel.tradeVolume = rel.tradeVolume * 0.98;
  rel.tradeDependency = clamp(rel.tradeDependency * 0.95 + Math.min(0.4, rel.tradeVolume / 300) * 0.1);
}

function roundRelationship(rel: Relationship) {
  rel.trust = round(rel.trust);
  rel.hostility = round(rel.hostility);
  rel.conflictMemory = round(rel.conflictMemory);
  rel.tradeVolume = round(rel.tradeVolume, 2);
  rel.respect = round(rel.respect);
  rel.tradeDependency = round(rel.tradeDependency);
  rel.culturalDistance = round(rel.culturalDistance);
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
    rel.phase = "war";
    const years = state.year - (rel.warStartYear ?? state.year);
    const weariness = Math.min(0.5, years * 0.04);
    const exhausted = a.population < 12 || b.population < 12;
    if ((years >= 3 && rng.chance(0.08 + weariness)) || exhausted) {
      rel.atWar = false;
      rel.warStartYear = null;
      rel.phase = "truce";
      rel.truceUntilYear = state.year + rng.int(20, 40);
      rel.hostility = clamp(rel.hostility - 0.45);
      rel.trust = Math.max(rel.trust, 0.1);
      const peace = emitEvent(ctx, {
        type: "peace",
        subtype: exhausted ? "exhaustion" : "weariness",
        importance: 4,
        actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
        x: pair.ca.x,
        y: pair.ca.y,
        title: t("Pace tra {art:a} e {art:b}", {
          a: polityPhrase(a.tribe, state.civilizations),
          b: polityPhrase(b.tribe, state.civilizations),
        }),
        description: t(
          "Dopo {years} anni di guerra e {battles} scontri, {art:a} e {art:b} hanno stipulato la pace{why}.",
          {
            years,
            battles: rel.battles,
            a: polityPhrase(a.tribe, state.civilizations),
            b: polityPhrase(b.tribe, state.civilizations),
            why: exhausted ? ": entrambi i popoli sono allo stremo" : "",
          },
        ),
        metadata: {
          years,
          battles: rel.battles,
          truceUntilYear: rel.truceUntilYear,
          cause: exhausted ? "sfinimento" : "stanchezza di guerra",
          populationA: a.population,
          populationB: b.population,
        },
      });
      // A peace dictated by a much stronger side can make the loser a vassal (politics.ts).
      // A war that was a vassal's rebellion is settled there instead.
      if (!vassalBond(state, a.tribe.id, b.tribe.id)) {
        const [winner, loser] = a.power >= b.power ? [a, b] : [b, a];
        imposePeaceTerms(ctx, winner.tribe, loser.tribe, {
          winnerPower: winner.power,
          loserPower: loser.power,
          battles: rel.battles,
          causeEventId: peace.id || null,
        });
      }
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
  // Rounded here so the thresholds below and the numbers stored in the event are the same
  // value: an event must always justify the decision that produced it.
  const warScore = round(motive(att, def), 2);
  const advantage = round(att.power / Math.max(1, def.power), 2);
  const target = att === a ? pair.cb : pair.ca;
  // A vassal and its overlord never escalate: their disputes become rebellions (politics.ts).
  const bound = vassalBond(state, a.tribe.id, b.tribe.id) !== undefined;

  // --- Escalation ladder: tension → demand → threat → war -------------------
  const truceHolds = rel.truceUntilYear !== null && state.year < rel.truceUntilYear;
  if (!truceHolds && rel.truceUntilYear !== null) rel.truceUntilYear = null;
  if (!truceHolds && !bound) {
    if (warScore > 0.3 && rel.phase === "peace") {
      rel.phase = "tension";
    } else if (
      warScore > 0.5 &&
      rel.phase === "tension" &&
      rel.phaseYears >= 3 &&
      pair.d <= 10 &&
      att.population >= 25 &&
      def.population >= 15 &&
      rng.chance(0.08)
    ) {
      rel.phase = "demand";
      emitEvent(ctx, {
        type: "conflict",
        subtype: "demand",
        importance: 2,
        actors: [actor.tribe(att.tribe), actor.tribe(def.tribe)],
        x: target.x,
        y: target.y,
        title: t("{Art:att} {v:att:avanza|avanzano} pretese {su:def}", {
          att: polityPhrase(att.tribe, state.civilizations),
          def: polityPhrase(def.tribe, state.civilizations),
        }),
        description: t("{Art:att} {v:att:chiede|chiedono} {a:def} terre e scorte: {why}.", {
          att: polityPhrase(att.tribe, state.civilizations),
          def: polityPhrase(def.tribe, state.civilizations),
          why: att.scarcity > 0.3 ? "la fame morde" : "la pressione sui confini cresce",
        }),
        metadata: {
          warScore: round(warScore, 2),
          scarcity: round(att.scarcity, 2),
          crowding: round(att.crowding, 2),
          hostility: rel.hostility,
        },
      });
      // A demand accepted under pressure buys time; refused, it hardens both sides.
      if (rel.respect > 0.5 && def.power < att.power * 0.8) {
        rel.hostility = clamp(rel.hostility - 0.1);
        rel.phase = "tension";
      } else {
        rel.hostility = clamp(rel.hostility + 0.08);
      }
      return;
    } else if (warScore > 0.55 && rel.phase === "demand" && rel.phaseYears >= 2 && rng.chance(0.15)) {
      rel.phase = "threat";
      emitEvent(ctx, {
        type: "conflict",
        subtype: "threat",
        importance: 3,
        actors: [actor.tribe(att.tribe), actor.tribe(def.tribe)],
        x: target.x,
        y: target.y,
        title: t("Minaccia di guerra: {att} contro {def}", {
          att: polityPhrase(att.tribe, state.civilizations),
          def: polityPhrase(def.tribe, state.civilizations),
        }),
        description: t(
          "Respinte le richieste, {art:att} {v:att:raduna|radunano} i guerrieri lungo il confine con {art:def}.",
          {
            att: polityPhrase(att.tribe, state.civilizations),
            def: polityPhrase(def.tribe, state.civilizations),
          },
        ),
        metadata: { warScore, advantage, distance: pair.d },
      });
      return;
    } else if (rel.phase !== "peace" && warScore < 0.2) {
      rel.phase = "peace";
    }
  }

  if (
    elapsed >= state.settings.warGraceYears &&
    !truceHolds &&
    !bound &&
    (rel.phase === "threat" || rel.phase === "raid") &&
    att.population >= 20 &&
    def.population >= 10 &&
    advantage > 1.1 &&
    warScore > 0.6 &&
    pair.d <= 10 &&
    rng.chance(0.25)
  ) {
    rel.atWar = true;
    rel.phase = "war";
    rel.warStartYear = state.year;
    rel.allied = false;
    const reasons: string[] = [];
    if (att.scarcity > 0.3) reasons.push("dalla fame");
    if (att.crowding > 0.6) reasons.push("dalla fame di terre");
    if (rel.conflictMemory > 0.2) reasons.push("da vecchi rancori");
    if (att.aggression > 0.55) reasons.push("dall'indole bellicosa");
    if (advantage > 1.5) reasons.push("dalla superiorità numerica");
    if (rel.culturalDistance > 0.4) reasons.push("da una distanza culturale incolmabile");
    emitEvent(ctx, {
      type: "conflict",
      subtype: "war_declared",
      importance: 4,
      actors: [actor.tribe(att.tribe), actor.tribe(def.tribe)],
      x: target.x,
      y: target.y,
      title: t("Guerra tra {art:att} e {art:def}", {
        att: polityPhrase(att.tribe, state.civilizations),
        def: polityPhrase(def.tribe, state.civilizations),
      }),
      description: t("{Art:att} {v:att:ha|hanno} dichiarato guerra {a:def}{why}.", {
        att: polityPhrase(att.tribe, state.civilizations),
        def: polityPhrase(def.tribe, state.civilizations),
        why: reasons.length
          ? `, ${agree(polityPhrase(att.tribe, state.civilizations), "spinto", "spinta", "spinti", "spinte")} ${reasons.join(", ")}`
          : "",
      }),
      metadata: {
        attackerId: att.tribe.id,
        defenderId: def.tribe.id,
        warScore,
        advantage,
        scarcity: round(att.scarcity, 2),
        crowding: round(att.crowding, 2),
        conflictMemory: rel.conflictMemory,
        culturalDistance: rel.culturalDistance,
        militarism: att.tribe.culture.militarism,
      },
    });
    return;
  }

  if (
    elapsed >= state.settings.raidGraceYears &&
    !bound &&
    att.scarcity > 0.4 &&
    att.aggression > 0.5 &&
    advantage > 1.2 &&
    pair.d <= 8 &&
    target.stock.food > 5 &&
    rng.chance(0.01 + att.scarcity * 0.03)
  ) {
    rel.phase = "raid";
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

  const quarantined =
    isUnderEpidemic(ctx, pair.ca.settlement?.id ?? null) ||
    isUnderEpidemic(ctx, pair.cb.settlement?.id ?? null);
  if (rel.trust > 0.25 && rel.hostility < 0.5 && pair.d <= 12 && !quarantined) {
    const before = rel.tradeVolume;
    const effectsA = tribeEffects(a.tribe);
    const effectsB = tribeEffects(b.tribe);
    const markets =
      (pair.ca.settlement?.buildings.market ?? 0) + (pair.cb.settlement?.buildings.market ?? 0) > 0 ? 1.3 : 1;
    const roadLink =
      pair.ca.settlement &&
      pair.cb.settlement &&
      pair.ca.settlement.roadLinks.includes(pair.cb.settlement.id);
    // Distance costs cargo; roads and ports halve the loss.
    const transportLoss = clamp(
      state.config.economy.transportCostPerCell * pair.d * (roadLink ? 0.5 : 1),
      0,
      0.6,
    );
    const volume = exchangeGoods(
      pair.ca.stock,
      pair.ca.members.length,
      pair.cb.stock,
      pair.cb.members.length,
      {
        surplusShare: clamp(
          state.config.economy.tradeSurplusShare *
            ((effectsA.tradeMultiplier + effectsB.tradeMultiplier) / 2) *
            markets,
          0.05,
          0.6,
        ),
        transportLoss,
      },
    );
    if (volume > 0) {
      rel.tradeVolume += volume;
      rel.trust = clamp(rel.trust + 0.008);
      rel.tradeDependency = clamp(rel.tradeDependency + volume / 400);
      rel.lastInteractionYear = state.year;
      ctx.counters.tradeVolume += volume;
      const firstTrade = before < 1;
      if (firstTrade || (before < 150 && rel.tradeVolume >= 150)) {
        emitEvent(ctx, {
          type: "trade",
          importance: 2,
          actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
          x: pair.ca.x,
          y: pair.ca.y,
          subtype: firstTrade ? "first_trade" : "trade_route",
          title: t(firstTrade ? "Primi scambi tra {art:a} e {art:b}" : "Rotta commerciale {a}–{b}", {
            a: polityPhrase(a.tribe, state.civilizations),
            b: polityPhrase(b.tribe, state.civilizations),
          }),
          description: t(
            firstTrade
              ? "{Art:a} e {art:b} hanno iniziato a scambiarsi cibo e materiali."
              : "Gli scambi tra {art:a} e {art:b} sono diventati regolari: una vera rotta commerciale.",
            { a: polityPhrase(a.tribe, state.civilizations), b: polityPhrase(b.tribe, state.civilizations) },
          ),
          metadata: {
            volume: round(volume, 2),
            totalVolume: Math.round(rel.tradeVolume),
            distance: pair.d,
            transportLoss: round(transportLoss, 3),
            dependency: rel.tradeDependency,
            road: Boolean(roadLink),
          },
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
    rel.phase = "peace";
    emitEvent(ctx, {
      type: "alliance",
      subtype: "formed",
      importance: 3,
      actors: [actor.tribe(a.tribe), actor.tribe(b.tribe)],
      x: pair.ca.x,
      y: pair.ca.y,
      title: t("Alleanza tra {art:a} e {art:b}", {
        a: polityPhrase(a.tribe, state.civilizations),
        b: polityPhrase(b.tribe, state.civilizations),
      }),
      description: t("Anni di fiducia reciproca hanno portato {art:a} e {art:b} a stringere un'alleanza.", {
        a: polityPhrase(a.tribe, state.civilizations),
        b: polityPhrase(b.tribe, state.civilizations),
      }),
      metadata: {
        trust: rel.trust,
        tradeVolume: Math.round(rel.tradeVolume),
        culturalDistance: rel.culturalDistance,
        dependency: rel.tradeDependency,
      },
    });
  } else if (rel.allied && rel.trust < 0.35) {
    rel.allied = false;
  }
}
