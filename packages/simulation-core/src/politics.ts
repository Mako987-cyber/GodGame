/**
 * Explicit political relations between peoples: vassalage and occupation.
 *
 * Before this module a won siege transferred a settlement on the spot. Now:
 * - a decisive victory over a settlement starts an **occupation**: the settlement keeps its
 *   owner, its people keep their identity; the occupier pays the garrison, extracts according
 *   to its policy and meets resistance. Years later the occupation ends in annexation,
 *   liberation, negotiated autonomy or abandonment — never silently;
 * - a peace imposed by a much stronger side can make the loser a **vassal**: it keeps
 *   identity, capital, culture and leader, pays tribute, sends a levy to its overlord's wars,
 *   gains autonomy over time and may rebel or become independent.
 *
 * Every change is an event; nothing is ever deleted (ended records keep their end year and
 * reason). No cycles: a people can have one overlord at a time and can never be, directly or
 * indirectly, the overlord of its own overlord.
 */
import { GOVERNMENTS } from "./constants";
import type { Community, SimContext } from "./context";
import { nextId } from "./context";
import { culturalDistance } from "./culture";
import type { TribeProfile } from "./diplomacy";
import { actor, emitEvent } from "./events";
import { clamp, distance, round } from "./grid";
import { recordAbsorbedIdentity } from "./identity/lineage";
import { formatEventDescription as t, peoplePhrase, polityPhrase, settlementPhrase } from "./language/format";
import { agree } from "./language/italian";
import { addResource, consumeResource, getResourceAmount, RESOURCES } from "./stock";
import { grantTech } from "./technology";
import type {
  Occupation,
  OccupationPolicy,
  Relationship,
  Settlement,
  Tribe,
  TributePolicy,
  VassalRelationship,
  WorldState,
} from "./types";
import { fighters } from "./warfare";

/** Tunables of the political model, in one place. */
export const POLITICS = {
  /** Share of the vassal's stored food paid each year, before autonomy. */
  tributeRate: { light: 0.05, standard: 0.1, heavy: 0.16 } as Record<TributePolicy, number>,
  /** Share of the occupied settlement's stock taken each year by policy. */
  extractionRate: { military: 0.08, administrative: 0.1, extractive: 0.2, integrative: 0.03 } as Record<
    OccupationPolicy,
    number
  >,
  /** Yearly resistance pressure of each policy (harsh policies breed resistance). */
  policyResistance: {
    military: 0.035,
    administrative: 0.015,
    extractive: 0.055,
    integrative: -0.01,
  } as Record<OccupationPolicy, number>,
  /** Yearly control gain of each policy. */
  policyControl: { military: 0.08, administrative: 0.06, extractive: 0.05, integrative: 0.045 } as Record<
    OccupationPolicy,
    number
  >,
  /** Garrison upkeep: fixed food per year plus food per cell of distance from the occupier. */
  upkeepBase: 2,
  upkeepPerCell: 0.25,
  annexYears: 8,
  annexControl: 0.75,
  annexMaxResistance: 0.35,
  liberationResistance: 0.75,
  autonomyYears: 25,
  independenceAutonomy: 0.85,
  levyRange: 15,
  levyShare: 0.3,
  /** A peace becomes vassalage only when the winner is at least this much stronger. */
  vassalPowerRatio: 2,
} as const;

// --- Queries -----------------------------------------------------------------------------

export function activeVassalageOf(state: WorldState, vassalId: string): VassalRelationship | undefined {
  return state.vassalages.find((v) => v.vassalCivilizationId === vassalId && v.diplomaticStatus !== "ended");
}

export function vassalsOf(state: WorldState, overlordId: string): VassalRelationship[] {
  return state.vassalages.filter(
    (v) => v.overlordCivilizationId === overlordId && v.diplomaticStatus !== "ended",
  );
}

/** The vassal relationship binding two peoples, in either direction. */
export function vassalBond(state: WorldState, aId: string, bId: string): VassalRelationship | undefined {
  return state.vassalages.find(
    (v) =>
      v.diplomaticStatus !== "ended" &&
      ((v.overlordCivilizationId === aId && v.vassalCivilizationId === bId) ||
        (v.overlordCivilizationId === bId && v.vassalCivilizationId === aId)),
  );
}

export function activeOccupationOf(state: WorldState, settlementId: string): Occupation | undefined {
  return state.occupations.find((o) => o.status === "active" && o.occupiedSettlementId === settlementId);
}

/** Overlords above a people, nearest first (stops on a malformed loop). */
export function overlordChain(state: WorldState, tribeId: string): string[] {
  const chain: string[] = [];
  let current = activeVassalageOf(state, tribeId);
  while (current && !chain.includes(current.overlordCivilizationId) && chain.length < 64) {
    chain.push(current.overlordCivilizationId);
    current = activeVassalageOf(state, current.overlordCivilizationId);
  }
  return chain;
}

export type VassalageRefusal = "self" | "extinct" | "already_vassal" | "cycle";

/** Whether `vassal` may become a vassal of `overlord` without breaking the rules above. */
export function canBecomeVassal(
  state: WorldState,
  overlordId: string,
  vassalId: string,
): VassalageRefusal | null {
  if (overlordId === vassalId) return "self";
  const tribes = new Map(state.tribes.map((tr) => [tr.id, tr]));
  if (tribes.get(overlordId)?.status === "extinct" || tribes.get(vassalId)?.status === "extinct")
    return "extinct";
  if (!tribes.has(overlordId) || !tribes.has(vassalId)) return "extinct";
  if (activeVassalageOf(state, vassalId)) return "already_vassal";
  // The vassal must not be (directly or indirectly) an overlord of the would-be overlord.
  if (overlordId === vassalId || overlordChain(state, overlordId).includes(vassalId)) return "cycle";
  return null;
}

// --- Food flows --------------------------------------------------------------------------

function communitiesOf(ctx: SimContext, tribeId: string): Community[] {
  return ctx.communities.filter((c) => c.tribe.id === tribeId);
}

/** Takes up to `amount` food from the communities, proportionally to what each holds. */
function takeFood(communities: Community[], amount: number): number {
  const available = communities.reduce((acc, c) => acc + c.stock.food, 0);
  if (available <= 0 || amount <= 0) return 0;
  const share = Math.min(1, amount / available);
  let taken = 0;
  for (const c of communities) {
    const part = round(c.stock.food * share, 2);
    if (part <= 0) continue;
    consumeResource(c.stock, "food", part);
    taken += part;
  }
  return round(taken, 2);
}

/** The community that receives tribute and loot: the most populous settlement, else the band. */
function seatOf(ctx: SimContext, tribe: Tribe): Community | undefined {
  const own = communitiesOf(ctx, tribe.id);
  return own.reduce<Community | undefined>((best, c) => {
    if (!best) return c;
    if (!!c.settlement !== !!best.settlement) return c.settlement ? c : best;
    return c.members.length > best.members.length ? c : best;
  }, undefined);
}

function nearestDistance(communities: Community[], x: number, y: number): number {
  return communities.reduce((best, c) => Math.min(best, distance(c.x, c.y, x, y)), Infinity);
}

// --- Vassalage ---------------------------------------------------------------------------

function tributePolicyFor(overlord: Tribe): TributePolicy {
  const c = overlord.culture.centralization;
  return c >= 62 ? "heavy" : c <= 38 ? "light" : "standard";
}

/**
 * Binds `vassal` to `overlord`. Returns null (and changes nothing) if the rules forbid it.
 */
export function createVassalage(
  ctx: SimContext,
  overlord: Tribe,
  vassal: Tribe,
  options: { causeEventId?: string | null; x?: number | null; y?: number | null } = {},
): VassalRelationship | null {
  if (canBecomeVassal(ctx.state, overlord.id, vassal.id)) return null;
  const { id, seq } = nextId(ctx.state, "vassalage", "v");
  const policy = tributePolicyFor(overlord);
  const rel: VassalRelationship = {
    id,
    seq,
    overlordCivilizationId: overlord.id,
    vassalCivilizationId: vassal.id,
    startedAtTick: ctx.state.tick,
    startedYear: ctx.state.year,
    endedAtTick: null,
    endedYear: null,
    tributePolicy: policy,
    autonomy: 0.35,
    militaryObligation: round(clamp(0.15 + overlord.culture.militarism / 250, 0.1, 0.6), 3),
    diplomaticStatus: "active",
    endReason: null,
    totalTribute: 0,
    lastTribute: 0,
    causeEventId: options.causeEventId || null,
  };
  ctx.state.vassalages.push(rel);
  const v = polityPhrase(vassal, ctx.state.civilizations);
  const o = polityPhrase(overlord, ctx.state.civilizations);
  const event = emitEvent(ctx, {
    type: "vassalage",
    subtype: "formed",
    importance: 4,
    actors: [actor.tribe(vassal), actor.tribe(overlord)],
    x: options.x ?? vassal.x,
    y: options.y ?? vassal.y,
    title: t("{Art:v} {v:v:diventa|diventano} {role} {di:o}", {
      v,
      o,
      role: agree(v, "vassallo", "vassalla", "vassalli", "vassalle"),
    }),
    description: t(
      "{Art:v} {v:v:conserva|conservano} identità, capitale, cultura e guida, ma {v:v:paga|pagano} un tributo {policy} {a:o} e {v:v:deve|devono} fornire guerrieri alle sue guerre.",
      { v, o, policy: { light: "leggero", standard: "ordinario", heavy: "pesante" }[policy] },
    ),
    metadata: {
      vassalageId: id,
      overlordId: overlord.id,
      vassalId: vassal.id,
      tributePolicy: policy,
      autonomy: rel.autonomy,
      militaryObligation: rel.militaryObligation,
    },
    causeEventIds: options.causeEventId ? [options.causeEventId] : [],
  });
  rel.causeEventId = rel.causeEventId ?? (event.id || null);
  return rel;
}

function endVassalage(
  ctx: SimContext,
  rel: VassalRelationship,
  reason: NonNullable<VassalRelationship["endReason"]>,
  causeEventIds: string[] = [],
) {
  rel.diplomaticStatus = "ended";
  rel.endReason = reason;
  rel.endedAtTick = ctx.state.tick;
  rel.endedYear = ctx.state.year;
  if (reason === "extinct" || reason === "merged") return;
  const vassal = ctx.tribes.get(rel.vassalCivilizationId);
  const overlord = ctx.tribes.get(rel.overlordCivilizationId);
  if (!vassal || !overlord) return;
  const v = polityPhrase(vassal, ctx.state.civilizations);
  const o = polityPhrase(overlord, ctx.state.civilizations);
  emitEvent(ctx, {
    type: "vassalage",
    subtype: reason,
    importance: 4,
    actors: [actor.tribe(vassal), actor.tribe(overlord)],
    x: vassal.x,
    y: vassal.y,
    title: t(
      reason === "independence"
        ? "{Art:v} {v:v:ottiene|ottengono} l'indipendenza"
        : "{Art:v} {v:v:vince|vincono} la ribellione",
      { v },
    ),
    description:
      reason === "independence"
        ? t(
            "Cresciut{e} in forza e autonomia, {art:v} non {v:v:riconosce|riconoscono} più l'autorità {di:o}: il vassallaggio finisce senza guerra.",
            {
              e: agree(v, "o", "a", "i", "e"),
              v,
              o,
            },
          )
        : t(
            "Con le armi {art:v} {v:v:ha|hanno} spezzato il vincolo che {v:v:la|li} legava {a:o}: il tributo non sarà più pagato.",
            {
              v,
              o,
            },
          ),
    metadata: {
      vassalageId: rel.id,
      reason,
      years: ctx.state.year - rel.startedYear,
      totalTribute: round(rel.totalTribute, 1),
    },
    causeEventIds,
  });
}

/** Warriors that active (non-rebel) vassals within reach send to their overlord's battle. */
export function vassalLevy(ctx: SimContext, overlord: Tribe, at: { x: number; y: number }): number {
  let levy = 0;
  for (const rel of vassalsOf(ctx.state, overlord.id)) {
    if (rel.diplomaticStatus !== "active") continue;
    const communities = communitiesOf(ctx, rel.vassalCivilizationId);
    if (nearestDistance(communities, at.x, at.y) > POLITICS.levyRange) continue;
    const warriors = communities.reduce((acc, c) => acc + fighters(c.members).length, 0);
    levy += Math.round(warriors * rel.militaryObligation * POLITICS.levyShare);
  }
  return levy;
}

function relationshipBetween(state: WorldState, aId: string, bId: string): Relationship | undefined {
  return state.relationships.find(
    (r) => (r.aId === aId && r.bId === bId) || (r.aId === bId && r.bId === aId),
  );
}

function updateVassalage(ctx: SimContext, rel: VassalRelationship, profiles: Map<string, TribeProfile>) {
  const { state } = ctx;
  const vassal = ctx.tribes.get(rel.vassalCivilizationId);
  const overlord = ctx.tribes.get(rel.overlordCivilizationId);
  if (!vassal || !overlord || vassal.status === "extinct" || overlord.status === "extinct") {
    endVassalage(ctx, rel, vassal?.absorbedByTribeId || overlord?.absorbedByTribeId ? "merged" : "extinct");
    return;
  }
  const vp = profiles.get(vassal.id)?.power ?? 0;
  const op = profiles.get(overlord.id)?.power ?? 0;
  const ratio = vp / Math.max(1, op);
  const bond = relationshipBetween(state, vassal.id, overlord.id);

  if (rel.diplomaticStatus === "rebellion") {
    // The rebellion is a war: it is decided when the war ends (peace from diplomacy).
    if (bond?.atWar) return;
    if (ratio >= 0.9) {
      endVassalage(ctx, rel, "rebellion_won");
    } else {
      rel.diplomaticStatus = "active";
      rel.autonomy = round(clamp(rel.autonomy - 0.2, 0.05, 0.95), 3);
      rel.tributePolicy = "heavy";
      const v = polityPhrase(vassal, state.civilizations);
      const o = polityPhrase(overlord, state.civilizations);
      emitEvent(ctx, {
        type: "vassalage",
        subtype: "rebellion_crushed",
        importance: 4,
        actors: [actor.tribe(vassal), actor.tribe(overlord)],
        x: vassal.x,
        y: vassal.y,
        title: t("Fallisce la ribellione {di:v}", { v }),
        description: t(
          "{Art:o} {v:o:ha|hanno} piegato la rivolta: {art:v} {v:v:resta|restano} {role}, con meno autonomia e un tributo più pesante.",
          {
            o,
            v,
            role: agree(v, "vassallo", "vassalla", "vassalli", "vassalle"),
          },
        ),
        metadata: { vassalageId: rel.id, autonomy: rel.autonomy },
      });
    }
    return;
  }

  // Tribute: a share of the vassal's stored food, lower the more autonomous it is.
  const vassalCommunities = communitiesOf(ctx, vassal.id);
  const seat = seatOf(ctx, overlord);
  const rate = POLITICS.tributeRate[rel.tributePolicy] * (1 - rel.autonomy * 0.5);
  const stored = vassalCommunities.reduce((acc, c) => acc + c.stock.food, 0);
  const due = round(stored * rate, 2);
  const paid = seat ? takeFood(vassalCommunities, due) : 0;
  if (seat && paid > 0) {
    const d = nearestDistance(vassalCommunities, seat.x, seat.y);
    addResource(seat.stock, "food", round(paid * clamp(1 - d * 0.01, 0.5, 1), 2));
  }
  rel.lastTribute = paid;
  rel.totalTribute = round(rel.totalTribute + paid, 2);
  // Tribute breeds resentment in the vassal and prestige for the overlord.
  vassal.stability.legitimacy = clamp(vassal.stability.legitimacy - rate * 0.05);
  overlord.stability.legitimacy = clamp(overlord.stability.legitimacy + rate * 0.02);
  if (bond) bond.hostility = clamp(bond.hostility + rate * 0.04);

  // Autonomy drifts with relative strength and distance.
  const far = seat ? nearestDistance(vassalCommunities, seat.x, seat.y) > 15 : true;
  rel.autonomy = round(clamp(rel.autonomy + (ratio - 0.5) * 0.02 + (far ? 0.005 : -0.002), 0.05, 0.95), 3);
  if (rel.autonomy >= POLITICS.independenceAutonomy) {
    endVassalage(ctx, rel, "independence");
    return;
  }

  // Rebellion: a strong, resentful vassal takes up arms.
  const resentment = (bond?.hostility ?? 0) + (rel.tributePolicy === "heavy" ? 0.2 : 0);
  if (bond && ratio >= 0.8 && resentment > 0.45 && ctx.rng.chance(0.06)) {
    rel.diplomaticStatus = "rebellion";
    bond.atWar = true;
    bond.warStartYear = state.year;
    bond.phase = "war";
    bond.status = "war";
    bond.truceUntilYear = null;
    bond.allied = false;
    const v = polityPhrase(vassal, state.civilizations);
    const o = polityPhrase(overlord, state.civilizations);
    emitEvent(ctx, {
      type: "vassalage",
      subtype: "rebellion",
      importance: 4,
      actors: [actor.tribe(vassal), actor.tribe(overlord)],
      x: vassal.x,
      y: vassal.y,
      title: t("{Art:v} si {v:v:ribella|ribellano} {a:o}", { v, o }),
      description: t(
        "Stanch{e} del tributo, {art:v} {v:v:rifiuta|rifiutano} di pagare e {v:v:prende|prendono} le armi contro {art:o}.",
        {
          e: agree(v, "o", "a", "i", "e"),
          v,
          o,
        },
      ),
      metadata: { vassalageId: rel.id, powerRatio: round(ratio, 2), tributePolicy: rel.tributePolicy },
    });
  }
}

// --- Occupation --------------------------------------------------------------------------

function occupationPolicyFor(occupier: Tribe): OccupationPolicy {
  const c = occupier.culture;
  const scores: [OccupationPolicy, number][] = [
    ["military", c.militarism],
    ["administrative", c.centralization],
    ["extractive", 100 - c.cooperation],
    ["integrative", c.cooperation * 0.6 + c.tradeOpenness * 0.4],
  ];
  return scores.reduce((best, s) => (s[1] > best[1] ? s : best))[0];
}

const POLICY_LABELS: Record<OccupationPolicy, string> = {
  military: "militare",
  administrative: "amministrativa",
  extractive: "estrattiva",
  integrative: "integrativa",
};

/**
 * A decisive victory over a settlement: the settlement is occupied, not annexed. Returns null
 * when it is already occupied (by anyone).
 */
export function startOccupation(
  ctx: SimContext,
  occupier: Tribe,
  owner: Tribe,
  settlement: Settlement,
  causeEventId: string | null = null,
): Occupation | null {
  if (activeOccupationOf(ctx.state, settlement.id) || occupier.id === owner.id) return null;
  const { id, seq } = nextId(ctx.state, "occupation", "o");
  const policy = occupationPolicyFor(occupier);
  const occ: Occupation = {
    id,
    seq,
    occupyingCivilizationId: occupier.id,
    occupiedCivilizationId: owner.id,
    occupiedSettlementId: settlement.id,
    occupiedTerritory: {
      settlementId: settlement.id,
      x: settlement.x,
      y: settlement.y,
      radius: settlement.territoryRadius,
    },
    startedAtTick: ctx.state.tick,
    startedYear: ctx.state.year,
    endedAtTick: null,
    endedYear: null,
    occupationPolicy: policy,
    resistance: round(clamp(0.2 + culturalDistance(occupier.culture, owner.culture) * 0.4), 3),
    control: 0.35,
    status: "active",
    upkeepPaid: 0,
    extracted: 0,
    causeEventId,
  };
  ctx.state.occupations.push(occ);
  settlement.construction = null;
  settlement.unrest = clamp(settlement.unrest + 0.25);
  occupier.stability.legitimacy = clamp(occupier.stability.legitimacy + 0.05);
  owner.stability.legitimacy = clamp(owner.stability.legitimacy - 0.12);
  owner.stability.tension = clamp(owner.stability.tension + 0.12);
  const occupierPhrase = polityPhrase(occupier, ctx.state.civilizations);
  const event = emitEvent(ctx, {
    type: "occupation",
    subtype: "started",
    importance: 5,
    actors: [actor.tribe(occupier), actor.tribe(owner), actor.settlement(settlement)],
    x: settlement.x,
    y: settlement.y,
    title: t("{place} occupata {da:occ}", { place: settlement.name, occ: occupierPhrase }),
    description: t(
      "{Art:s} è passata sotto occupazione {di:occ}, con un'amministrazione {policy}. Non è un'annessione: gli abitanti restano {art:owner} e la resistenza può crescere.",
      {
        s: settlementPhrase(settlement),
        occ: occupierPhrase,
        policy: POLICY_LABELS[policy],
        owner: peoplePhrase(owner),
      },
    ),
    metadata: {
      occupationId: id,
      settlementId: settlement.id,
      occupierId: occupier.id,
      ownerId: owner.id,
      policy,
      control: occ.control,
      resistance: occ.resistance,
    },
    causeEventIds: causeEventId ? [causeEventId] : [],
  });
  occ.causeEventId = occ.causeEventId ?? (event.id || null);
  return occ;
}

/**
 * Annexation at the end of an occupation: the settlement, its land and its people pass to the
 * occupier; their identity lives on inside the new owner (never erased).
 */
function annex(ctx: SimContext, occ: Occupation, occupier: Tribe, owner: Tribe, s: Settlement) {
  s.tribeId = occupier.id;
  s.civilizationId = occupier.civilizationId;
  s.construction = null;
  const survivors = ctx.state.people.filter(
    (p) => p.alive && p.settlementId === s.id && p.tribeId === owner.id,
  );
  const carried = new Set(survivors.flatMap((p) => p.knowledge));
  for (const p of survivors) p.tribeId = occupier.id;
  for (const h of ctx.state.households) {
    const partner = ctx.people.get(h.partnerIds[0]);
    if (partner && partner.settlementId === s.id && h.tribeId === owner.id) h.tribeId = occupier.id;
  }
  if (owner.leaderId && survivors.some((p) => p.id === owner.leaderId)) owner.leaderId = null;
  const remaining = ctx.state.settlements.filter((o) => o.status === "active" && o.tribeId === owner.id);
  if (remaining.length === 0 && owner.status === "settled") owner.status = "nomadic";
  for (const cell of ctx.state.cells) if (cell.settlementId === s.id) cell.ownerTribeId = occupier.id;
  recordAbsorbedIdentity(occupier, owner);
  closeOccupation(ctx, occ, "annexed");
  const occupierPhrase = polityPhrase(occupier, ctx.state.civilizations);
  emitEvent(ctx, {
    type: "conquest",
    subtype: "annexation",
    importance: 5,
    actors: [actor.tribe(occupier), actor.tribe(owner), actor.settlement(s)],
    x: s.x,
    y: s.y,
    title: t("{place} annessa {da:occ}", { place: s.name, occ: occupierPhrase }),
    description: t(
      "Dopo {years} anni di occupazione {art:s} entra a far parte dei domini {di:occ}. I suoi {n} abitanti portano con sé l'identità {di:owner}, che non scompare.",
      {
        years: ctx.state.year - occ.startedYear,
        s: settlementPhrase(s),
        occ: occupierPhrase,
        n: survivors.length,
        owner: peoplePhrase(owner),
      },
    ),
    metadata: {
      occupationId: occ.id,
      settlementId: s.id,
      previousTribeId: owner.id,
      newTribeId: occupier.id,
      conqueredIdentityId: owner.identityId,
      survivors: survivors.length,
      control: occ.control,
      resistance: occ.resistance,
    },
    causeEventIds: occ.causeEventId ? [occ.causeEventId] : [],
  });
  for (const techId of carried) grantTech(ctx, occupier, techId, "conquest", owner);
}

function closeOccupation(ctx: SimContext, occ: Occupation, status: Exclude<Occupation["status"], "active">) {
  occ.status = status;
  occ.endedAtTick = ctx.state.tick;
  occ.endedYear = ctx.state.year;
}

/** Ends an occupation without annexation (liberation, autonomy, return, abandonment) with an event. */
export function releaseOccupation(
  ctx: SimContext,
  occ: Occupation,
  status: "liberated" | "autonomous" | "returned" | "abandoned",
) {
  closeOccupation(ctx, occ, status);
  const s = occ.occupiedSettlementId ? ctx.settlements.get(occ.occupiedSettlementId) : undefined;
  const occupier = ctx.tribes.get(occ.occupyingCivilizationId);
  if (!s || s.status !== "active" || !occupier) return;
  if (status === "liberated") {
    occupier.stability.legitimacy = clamp(occupier.stability.legitimacy - 0.06);
    s.unrest = clamp(s.unrest - 0.2);
  }
  const occupierPhrase = polityPhrase(occupier, ctx.state.civilizations);
  const text: Record<typeof status, { title: string; description: string }> = {
    liberated: {
      title: "{place} si libera dall'occupazione",
      description:
        "La resistenza ha avuto la meglio: la guarnigione {di:occ} lascia {art:s} dopo {years} anni.",
    },
    autonomous: {
      title: "{place} ottiene l'autonomia",
      description:
        "Senza un controllo saldo né una rivolta aperta, l'occupazione {di:occ} si chiude con un accordo: {art:s} torna ad amministrarsi da sé.",
    },
    returned: {
      title: "{place} restituita",
      description:
        "Con la pace, {art:occ} {v:occ:restituisce|restituiscono} {art:s} ai suoi abitanti dopo {years} anni di occupazione.",
    },
    abandoned: {
      title: "Fine dell'occupazione di {place}",
      description: "La guarnigione {di:occ} abbandona {art:s}: non c'è più chi possa sostenerla.",
    },
  };
  emitEvent(ctx, {
    type: "occupation",
    subtype: status,
    importance: 4,
    actors: [actor.tribe(occupier), actor.settlement(s)],
    x: s.x,
    y: s.y,
    title: t(text[status].title, { place: s.name }),
    description: t(text[status].description, {
      occ: occupierPhrase,
      s: settlementPhrase(s),
      years: ctx.state.year - occ.startedYear,
    }),
    metadata: { occupationId: occ.id, settlementId: s.id, control: occ.control, resistance: occ.resistance },
    causeEventIds: occ.causeEventId ? [occ.causeEventId] : [],
  });
}

function updateOccupation(ctx: SimContext, occ: Occupation, profiles: Map<string, TribeProfile>) {
  const { state } = ctx;
  const s = occ.occupiedSettlementId ? ctx.settlements.get(occ.occupiedSettlementId) : undefined;
  const occupier = ctx.tribes.get(occ.occupyingCivilizationId);
  const owner = occ.occupiedCivilizationId ? ctx.tribes.get(occ.occupiedCivilizationId) : undefined;
  if (
    !s ||
    s.status !== "active" ||
    !owner ||
    owner.status === "extinct" ||
    !occupier ||
    occupier.status === "extinct"
  ) {
    closeOccupation(ctx, occ, "abandoned");
    return;
  }
  if (s.tribeId !== owner.id) {
    // The settlement changed hands another way (secession, another annexation): superseded.
    closeOccupation(ctx, occ, "abandoned");
    return;
  }
  const occupierCommunities = communitiesOf(ctx, occupier.id);
  if (occupierCommunities.length === 0) {
    releaseOccupation(ctx, occ, "abandoned");
    return;
  }
  const community = ctx.communities.find((c) => c.settlement?.id === s.id);

  // Garrison upkeep: the occupier pays; an unpaid garrison loses its grip.
  const d = nearestDistance(occupierCommunities, s.x, s.y);
  const upkeep = round(POLITICS.upkeepBase + d * POLITICS.upkeepPerCell, 2);
  const paid = takeFood(occupierCommunities, upkeep);
  occ.upkeepPaid = round(occ.upkeepPaid + paid, 2);
  const unpaid = paid < upkeep * 0.8;

  // Extraction by policy, from the occupied settlement to the occupier's seat.
  const seat = seatOf(ctx, occupier);
  const rate = POLITICS.extractionRate[occ.occupationPolicy];
  let taken = 0;
  for (const key of RESOURCES) {
    const amount = round(getResourceAmount(s.stock, key) * rate, 2);
    if (amount <= 0) continue;
    consumeResource(s.stock, key, amount);
    if (seat) addResource(seat.stock, key, round(amount * 0.8, 2));
    taken += amount;
  }
  occ.extracted = round(occ.extracted + taken, 2);

  // Control follows the balance of force near the settlement; resistance the policy, the
  // cultural distance, discontent and whether the owner is still around to be liberated by.
  const occupierPower = profiles.get(occupier.id)?.power ?? 0;
  const ownerPower = profiles.get(owner.id)?.power ?? 0;
  const edge = occupierPower / Math.max(1, occupierPower + ownerPower);
  const ownerNear =
    nearestDistance(
      communitiesOf(ctx, owner.id).filter((c) => c.settlement?.id !== s.id),
      s.x,
      s.y,
    ) <= 12;
  const cultural = culturalDistance(occupier.culture, owner.culture);
  occ.control = round(
    clamp(
      occ.control +
        POLITICS.policyControl[occ.occupationPolicy] * edge * 2 -
        occ.resistance * 0.05 -
        (unpaid ? 0.1 : 0),
    ),
    3,
  );
  occ.resistance = round(
    clamp(
      occ.resistance +
        POLITICS.policyResistance[occ.occupationPolicy] +
        s.unrest * 0.03 +
        cultural * 0.03 +
        (ownerNear ? 0.02 : -0.01) -
        occ.control * 0.03,
    ),
    3,
  );
  s.unrest = clamp(s.unrest + occ.resistance * 0.04 - 0.01);
  // A badly held occupation destabilises the occupier.
  occupier.stability.tension = clamp(occupier.stability.tension + occ.resistance * 0.01);
  if (occ.control < 0.3) occupier.stability.legitimacy = clamp(occupier.stability.legitimacy - 0.01);
  if (community) for (const p of community.members) p.hunger = clamp(p.hunger + rate * 0.05);

  const years = state.year - occ.startedYear;
  if (occ.resistance >= POLITICS.liberationResistance && occ.resistance > occ.control) {
    releaseOccupation(ctx, occ, "liberated");
    return;
  }
  if (
    years >= POLITICS.annexYears &&
    occ.control >= POLITICS.annexControl &&
    occ.resistance <= POLITICS.annexMaxResistance
  ) {
    annex(ctx, occ, occupier, owner, s);
    return;
  }
  const bond = relationshipBetween(state, occupier.id, owner.id);
  if (years >= POLITICS.autonomyYears && !bond?.atWar && occ.control < 0.5)
    releaseOccupation(ctx, occ, "autonomous");
}

// --- Tick step ---------------------------------------------------------------------------

/** Yearly step of vassal relationships and occupations (after diplomacy). */
export function updatePolitics(ctx: SimContext, profiles: Map<string, TribeProfile>) {
  for (const occ of ctx.state.occupations) if (occ.status === "active") updateOccupation(ctx, occ, profiles);
  for (const rel of ctx.state.vassalages)
    if (rel.diplomaticStatus !== "ended") updateVassalage(ctx, rel, profiles);
}

/**
 * Peace terms. Called by diplomacy when a war ends: if the winner is much stronger and holds
 * the loser's settlements (or won many battles), the loser becomes its vassal and the occupied
 * settlements are returned to its administration. Returns the vassalage, or null for a plain peace.
 */
export function imposePeaceTerms(
  ctx: SimContext,
  winner: Tribe,
  loser: Tribe,
  context: { winnerPower: number; loserPower: number; battles: number; causeEventId: string | null },
): VassalRelationship | null {
  const { state } = ctx;
  if (vassalBond(state, winner.id, loser.id)) return null;
  const held = state.occupations.filter(
    (o) =>
      o.status === "active" &&
      o.occupyingCivilizationId === winner.id &&
      o.occupiedCivilizationId === loser.id,
  );
  if (context.winnerPower < context.loserPower * POLITICS.vassalPowerRatio) return null;
  if (held.length === 0 && context.battles < 4) return null;
  const rel = createVassalage(ctx, winner, loser, { causeEventId: context.causeEventId });
  if (!rel) return null;
  for (const occ of held) releaseOccupation(ctx, occ, "returned");
  return rel;
}

/** Government rank (order of `GOVERNMENTS`), used when two polities merge (fusion.ts). */
export function governmentRank(government: Tribe["government"]): number {
  return Object.keys(GOVERNMENTS).indexOf(government);
}

/** A won battle emboldens the people whose settlements the loser occupies. */
export function onBattleResolved(ctx: SimContext, winner: Tribe, loser: Tribe) {
  for (const occ of ctx.state.occupations) {
    if (
      occ.status !== "active" ||
      occ.occupyingCivilizationId !== loser.id ||
      occ.occupiedCivilizationId !== winner.id
    )
      continue;
    occ.resistance = round(clamp(occ.resistance + 0.15), 3);
    occ.control = round(clamp(occ.control - 0.1), 3);
  }
}

/**
 * End-of-tick bookkeeping: a people that died out this tick cannot hold an occupation or a
 * vassal bond. Closed without an event: the extinction itself is the event.
 */
export function cleanupPolitics(ctx: SimContext) {
  const extinct = (id: string | null) =>
    !id || ctx.tribes.get(id)?.status === "extinct" || !ctx.tribes.has(id);
  for (const occ of ctx.state.occupations) {
    if (occ.status !== "active") continue;
    const s = occ.occupiedSettlementId ? ctx.settlements.get(occ.occupiedSettlementId) : undefined;
    if (
      extinct(occ.occupyingCivilizationId) ||
      extinct(occ.occupiedCivilizationId) ||
      !s ||
      s.tribeId !== occ.occupiedCivilizationId
    )
      closeOccupation(ctx, occ, "abandoned");
  }
  for (const rel of ctx.state.vassalages) {
    if (rel.diplomaticStatus === "ended") continue;
    if (extinct(rel.overlordCivilizationId) || extinct(rel.vassalCivilizationId)) {
      const merged =
        ctx.tribes.get(rel.overlordCivilizationId)?.absorbedByTribeId ||
        ctx.tribes.get(rel.vassalCivilizationId)?.absorbedByTribeId;
      endVassalage(ctx, rel, merged ? "merged" : "extinct");
    }
  }
}

// --- Invariants --------------------------------------------------------------------------

export function checkPoliticalInvariants(state: WorldState): string[] {
  const problems: string[] = [];
  const tribes = new Map(state.tribes.map((tr) => [tr.id, tr]));
  const settlements = new Map(state.settlements.map((s) => [s.id, s]));
  const activeVassals = new Map<string, VassalRelationship>();
  for (const v of state.vassalages) {
    if (v.overlordCivilizationId === v.vassalCivilizationId)
      problems.push(`vassallaggio ${v.id}: vassallo di sé stesso`);
    if (!tribes.has(v.overlordCivilizationId) || !tribes.has(v.vassalCivilizationId))
      problems.push(`vassallaggio ${v.id} riferisce una civiltà inesistente`);
    if (v.diplomaticStatus === "ended") {
      if (v.endedYear === null) problems.push(`vassallaggio ${v.id} concluso senza anno di fine`);
      continue;
    }
    if (activeVassals.has(v.vassalCivilizationId))
      problems.push(`${v.vassalCivilizationId} ha due signori contemporaneamente`);
    activeVassals.set(v.vassalCivilizationId, v);
    if (
      tribes.get(v.overlordCivilizationId)?.status === "extinct" ||
      tribes.get(v.vassalCivilizationId)?.status === "extinct"
    )
      problems.push(`vassallaggio ${v.id} attivo con una civiltà estinta`);
  }
  for (const start of activeVassals.keys()) {
    const seen = new Set<string>([start]);
    let current = activeVassals.get(start);
    while (current) {
      if (seen.has(current.overlordCivilizationId)) {
        problems.push(`ciclo di vassallaggio che passa per ${start}`);
        break;
      }
      seen.add(current.overlordCivilizationId);
      current = activeVassals.get(current.overlordCivilizationId);
    }
  }
  const occupied = new Set<string>();
  for (const o of state.occupations) {
    if (!tribes.has(o.occupyingCivilizationId))
      problems.push(`occupazione ${o.id} con occupante inesistente`);
    if (o.status !== "active") {
      if (o.endedYear === null) problems.push(`occupazione ${o.id} conclusa senza anno di fine`);
      continue;
    }
    if (o.occupyingCivilizationId === o.occupiedCivilizationId)
      problems.push(`occupazione ${o.id} di sé stessi`);
    if (tribes.get(o.occupyingCivilizationId)?.status === "extinct")
      problems.push(`occupazione ${o.id} di una civiltà estinta`);
    const s = o.occupiedSettlementId ? settlements.get(o.occupiedSettlementId) : undefined;
    if (o.occupiedSettlementId && !s) problems.push(`occupazione ${o.id} di un insediamento inesistente`);
    if (s && s.tribeId !== o.occupiedCivilizationId)
      problems.push(`occupazione ${o.id}: l'insediamento ha cambiato proprietario`);
    if (o.occupiedSettlementId) {
      if (occupied.has(o.occupiedSettlementId))
        problems.push(`insediamento ${o.occupiedSettlementId} occupato due volte`);
      occupied.add(o.occupiedSettlementId);
    }
    if (o.control < 0 || o.control > 1 || o.resistance < 0 || o.resistance > 1)
      problems.push(`occupazione ${o.id}: controllo/resistenza fuori scala`);
  }
  return problems;
}
