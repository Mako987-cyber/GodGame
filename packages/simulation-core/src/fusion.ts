/**
 * Fusion of peoples into a composite identity.
 *
 * A fusion is never a random roll. Two peoples with *different* identities must live side by
 * side under persistent conditions — alliance or a long, tight vassal bond, trust, no
 * hostility, compatible cultures, closeness — and every such year adds to `fusionYears` on
 * their relationship (more with a shared enemy or deep trade ties); any year without them wears
 * it down. Only when the pressure has lasted long enough (`FUSION.yearsRequired`) do they fuse:
 *
 * - a new composite identity is created ("Romano-Celti"), referencing both source identities
 *   and both political instances, with blended naming, palette and culture;
 * - a new political instance carries it; the two sources end as `merged` (extinct with
 *   `absorbedByTribeId`), their people, settlements, land and bonds pass to the new one;
 * - one event tells the story; the same set of identities can never fuse twice in a world.
 *
 * Deterministic: same state, same result (no randomness is consumed).
 */
import { TRIBE_COLORS } from "./constants";
import type { SimContext } from "./context";
import { nextId } from "./context";
import { initialStability } from "./culture";
import type { TribeProfile } from "./diplomacy";
import { actor, emitEvent } from "./events";
import { clamp, distance, round } from "./grid";
import {
  compositeGrammar,
  identityOf,
  memberKeyOf,
  mergeCulture,
  mergeNaming,
  mergeVisual,
} from "./identity/composite";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { governmentRank, overlordChain, vassalBond } from "./politics";
import { addBundle, emptyStock, stockToBundle } from "./stock";
import { recordCivilizationCollapse } from "./settlements";
import type { CompositeIdentity, Relationship, Tribe } from "./types";

export const FUSION = {
  /** Years of favourable conditions before two peoples become one. */
  yearsRequired: 30,
  maxCulturalDistance: 0.22,
  minTrust: 0.6,
  maxHostility: 0.15,
  maxDistance: 8,
  minPopulation: 25,
  /** A tight vassal bond also leads to fusion: low autonomy, for this many years. */
  vassalMaxAutonomy: 0.3,
  vassalMinYears: 20,
  /** Years lost for every year without the conditions. */
  decay: 2,
} as const;

export interface FusionAssessment {
  eligible: boolean;
  /** Pressure added this year when eligible (1–3). */
  pressure: number;
  reasons: string[];
  blockers: string[];
}

function sharedEnemy(ctx: SimContext, a: Tribe, b: Tribe): boolean {
  const enemies = (id: string) =>
    new Set(
      ctx.state.relationships
        .filter((r) => r.atWar && (r.aId === id || r.bId === id))
        .map((r) => (r.aId === id ? r.bId : r.aId)),
    );
  const ea = enemies(a.id);
  return [...enemies(b.id)].some((id) => ea.has(id));
}

/** Whether this year counts towards a fusion of the pair, and why (or why not). */
export function assessFusion(
  ctx: SimContext,
  rel: Relationship,
  a: TribeProfile,
  b: TribeProfile,
  d: number,
): FusionAssessment {
  const blockers: string[] = [];
  const reasons: string[] = [];
  const { state } = ctx;
  if (!a.tribe.identityId || !b.tribe.identityId) blockers.push("popolo senza identità");
  else if (memberKeyOf(state, [a.tribe.identityId]) === memberKeyOf(state, [b.tribe.identityId]))
    blockers.push("stessa identità");
  if (rel.atWar) blockers.push("in guerra");
  if (a.population < FUSION.minPopulation || b.population < FUSION.minPopulation)
    blockers.push("popolazione troppo piccola");
  if (d > FUSION.maxDistance) blockers.push("troppo lontani");
  if (rel.culturalDistance > FUSION.maxCulturalDistance) blockers.push("culture troppo distanti");
  if (rel.hostility > FUSION.maxHostility) blockers.push("ostilità");
  const bond = vassalBond(state, a.tribe.id, b.tribe.id);
  const allied = rel.allied && rel.trust >= FUSION.minTrust;
  const integrating =
    bond?.diplomaticStatus === "active" &&
    bond.autonomy <= FUSION.vassalMaxAutonomy &&
    state.year - bond.startedYear >= FUSION.vassalMinYears;
  if (bond?.diplomaticStatus === "rebellion") blockers.push("ribellione in corso");
  if (!allied && !integrating) blockers.push("nessun legame politico stabile");
  if (allied) reasons.push("alleanza e fiducia");
  if (integrating) reasons.push("lunga integrazione di un vassallo");
  let pressure = 1;
  if (sharedEnemy(ctx, a.tribe, b.tribe)) {
    pressure += 1;
    reasons.push("nemico comune");
  }
  if (rel.tradeDependency > 0.2 || rel.tradeVolume > 80) {
    pressure += 1;
    reasons.push("scambi intensi");
  }
  if (d <= 4) reasons.push("convivenza");
  return { eligible: blockers.length === 0, pressure: blockers.length ? 0 : pressure, reasons, blockers };
}

function closest(a: TribeProfile, b: TribeProfile): number {
  let best = Infinity;
  for (const ca of a.communities)
    for (const cb of b.communities) best = Math.min(best, distance(ca.x, ca.y, cb.x, cb.y));
  return best;
}

/** Yearly step (after politics): accumulate fusion pressure and resolve the ripe fusions. */
export function updateFusions(ctx: SimContext, profiles: Map<string, TribeProfile>) {
  const fused = new Set<string>();
  const relationships = [...ctx.state.relationships].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const rel of relationships) {
    const a = profiles.get(rel.aId);
    const b = profiles.get(rel.bId);
    if (!a || !b || a.tribe.status === "extinct" || b.tribe.status === "extinct") continue;
    const assessment = assessFusion(ctx, rel, a, b, closest(a, b));
    rel.fusionYears = assessment.eligible
      ? rel.fusionYears + assessment.pressure
      : Math.max(0, rel.fusionYears - FUSION.decay);
    // Only a year that itself meets the conditions can conclude a fusion.
    if (
      !assessment.eligible ||
      rel.fusionYears < FUSION.yearsRequired ||
      fused.has(a.tribe.id) ||
      fused.has(b.tribe.id)
    )
      continue;
    const composite = fuse(ctx, a, b, rel, assessment.reasons);
    if (composite) {
      fused.add(a.tribe.id);
      fused.add(b.tribe.id);
    }
  }
}

/**
 * Fuses two peoples. Returns the new composite identity, or null (nothing changed) when the
 * same set of identities already fused in this world.
 */
export function fuse(
  ctx: SimContext,
  a: TribeProfile,
  b: TribeProfile,
  rel: Relationship,
  reasons: string[] = [],
): CompositeIdentity | null {
  const { state } = ctx;
  // The larger people leads the name and inherits the seat; ties by seniority.
  const [major, minor] =
    a.population > b.population || (a.population === b.population && a.tribe.seq < b.tribe.seq)
      ? [a, b]
      : [b, a];
  const first = identityOf(state, major.tribe.identityId);
  const second = identityOf(state, minor.tribe.identityId);
  if (!first || !second) return null;
  const memberKey = memberKeyOf(state, [first.key, second.key]);
  // One identity is not a composite; and the same set never fuses twice in a world.
  if (memberKey === memberKeyOf(state, [first.key]) || memberKey === memberKeyOf(state, [second.key]))
    return null;
  if (state.composites.some((c) => c.memberKey === memberKey)) return null;

  const { id: compositeId, seq: compositeSeq } = nextId(state, "composite", "ci");
  const { id: tribeId, seq: tribeSeq } = nextId(state, "tribe", "t");
  const grammar = compositeGrammar(first.language, second.language);
  const usedNames = new Set(state.tribes.filter((tr) => tr.status !== "extinct").map((tr) => tr.name));
  const displayName = usedNames.has(grammar.displayName)
    ? `${grammar.displayName} di ${tribeSeq}`
    : grammar.displayName;
  const culture = mergeCulture(
    { culture: major.tribe.culture, population: major.population, tags: first.culturalTags },
    { culture: minor.tribe.culture, population: minor.population, tags: second.culturalTags },
  );
  const visual = mergeVisual(first.visualProfile, second.visualProfile);
  const composite: CompositeIdentity = {
    id: compositeId,
    seq: compositeSeq,
    sourceIdentityIds: [first.key, second.key],
    sourceCivilizationIds: [major.tribe.id, minor.tribe.id],
    memberKey,
    displayName,
    singularNoun: grammar.singularNoun,
    adjective: grammar.adjective,
    adjectiveFeminine: grammar.adjectiveFeminine,
    collectiveName: grammar.collectiveName.replace(grammar.displayName, displayName),
    namingProfile: mergeNaming(first.namingProfile, second.namingProfile),
    visualProfile: visual,
    culturalProfile: culture,
    createdAtTick: state.tick,
    createdYear: state.year,
    origin: "fusion",
    status: "active",
    civilizationId: tribeId,
    causeEventId: null,
  };
  state.composites.push(composite);

  const sources = [major.tribe, minor.tribe];
  const settled = state.settlements.some(
    (s) => s.status === "active" && sources.some((src) => src.id === s.tribeId),
  );
  const leader =
    [major.tribe.leaderId, minor.tribe.leaderId].find((id) => id && ctx.people.get(id)?.alive) ?? null;
  const government =
    governmentRank(major.tribe.government) >= governmentRank(minor.tribe.government)
      ? major.tribe.government
      : minor.tribe.government;
  const stock = emptyStock();
  addBundle(stock, stockToBundle(major.tribe.stock));
  addBundle(stock, stockToBundle(minor.tribe.stock));
  const techs = [...new Set([...major.tribe.techs, ...minor.tribe.techs])];
  const techAdoption: Record<string, number> = {};
  for (const tech of techs)
    techAdoption[tech] = Math.max(major.tribe.techAdoption[tech] ?? 0, minor.tribe.techAdoption[tech] ?? 0);
  const techLost: Record<string, number> = {};
  for (const [id, year] of Object.entries({ ...minor.tribe.techLost, ...major.tribe.techLost })) {
    if (!techs.includes(id)) techLost[id] = year;
  }
  const absorbed = [
    ...new Set(
      [first.key, second.key, ...major.tribe.absorbedIdentityIds, ...minor.tribe.absorbedIdentityIds].filter(
        (id) => id !== compositeId,
      ),
    ),
  ];
  const tribe: Tribe = {
    id: tribeId,
    seq: tribeSeq,
    name: displayName,
    color: visual.primaryColor ?? TRIBE_COLORS[0] ?? "#ffffff",
    status: settled ? "settled" : "nomadic",
    x: major.tribe.x,
    y: major.tribe.y,
    stock,
    techs,
    techProgress: { ...minor.tribe.techProgress, ...major.tribe.techProgress },
    techAdoption,
    // A fusion inherits what BOTH peoples had forgotten, minus what either still knows.
    techLost,
    // A fused people keeps the local ways of the larger partner, then of the smaller.
    techVariants: { ...minor.tribe.techVariants, ...major.tribe.techVariants },
    yearsAtLocation: major.tribe.yearsAtLocation,
    scarcityYears: 0,
    foundedYear: state.year,
    extinctYear: null,
    civilizationId: null,
    leaderId: leader,
    parentTribeId: major.tribe.id,
    morale: round((major.tribe.morale + minor.tribe.morale) / 2, 3),
    populationMilestone: Math.max(major.tribe.populationMilestone, minor.tribe.populationMilestone),
    lastFoodProduced: major.tribe.lastFoodProduced + minor.tribe.lastFoodProduced,
    lastFoodConsumed: major.tribe.lastFoodConsumed + minor.tribe.lastFoodConsumed,
    lastFoodRatio: round((major.tribe.lastFoodRatio + minor.tribe.lastFoodRatio) / 2, 3),
    culture: culture.traits,
    government,
    stability: {
      ...initialStability(),
      legitimacy: round((major.tribe.stability.legitimacy + minor.tribe.stability.legitimacy) / 2, 3),
      cohesion: round(clamp((major.tribe.stability.cohesion + minor.tribe.stability.cohesion) / 2 - 0.05), 3),
    },
    distribution: major.tribe.distribution,
    dynastyId: leader === major.tribe.leaderId ? major.tribe.dynastyId : minor.tribe.dynastyId,
    lastLeaderChangeYear: state.year,
    identityId: compositeId,
    identityType: "composite",
    absorbedIdentityIds: absorbed,
    absorbedByTribeId: null,
    beliefSystemId: null,
    beliefAdherence: 0,
    cultureHistory: [],
    resilience: null,
    causalAnchors: {},
  };
  state.tribes.push(tribe);
  ctx.tribes.set(tribeId, tribe);

  // Everything of the sources passes to the new people. The sources are ended, never erased.
  const endedStates = state.civilizations.filter(
    (civ) => civ.status === "active" && sources.some((src) => src.id === civ.founderTribeId),
  );
  for (const src of sources) {
    for (const p of state.people) if (p.tribeId === src.id) p.tribeId = tribeId;
    for (const h of state.households) if (h.tribeId === src.id) h.tribeId = tribeId;
    for (const s of state.settlements) {
      if (s.tribeId !== src.id) continue;
      s.tribeId = tribeId;
      s.civilizationId = null;
    }
    for (const cell of state.cells) if (cell.ownerTribeId === src.id) cell.ownerTribeId = tribeId;
    for (const d of state.dynasties) if (d.tribeId === src.id && d.endedYear === null) d.tribeId = tribeId;
    for (const occ of state.occupations) {
      if (occ.status !== "active") continue;
      if (occ.occupyingCivilizationId === src.id) occ.occupyingCivilizationId = tribeId;
      if (occ.occupiedCivilizationId === src.id) occ.occupiedCivilizationId = tribeId;
    }
    src.status = "extinct";
    src.extinctYear = state.year;
    src.absorbedByTribeId = tribeId;
    src.leaderId = null;
    src.stock = emptyStock();
  }
  // The states of the sources end with them (the new people founds its own when it can).
  for (const civ of endedStates) {
    civ.status = "collapsed";
    recordCivilizationCollapse(ctx, civ);
  }
  inheritRelationships(ctx, tribe, sources);
  // An occupation between the two sources is now inside one people: it ends.
  for (const occ of state.occupations)
    if (
      occ.status === "active" &&
      occ.occupyingCivilizationId === tribeId &&
      occ.occupiedCivilizationId === tribeId
    ) {
      occ.status = "returned";
      occ.endedAtTick = state.tick;
      occ.endedYear = state.year;
    }
  // Bonds with third parties are inherited; a bond between the two sources ends with them.
  for (const v of state.vassalages) {
    if (v.diplomaticStatus === "ended") continue;
    const inside =
      sources.some((s) => s.id === v.overlordCivilizationId) &&
      sources.some((s) => s.id === v.vassalCivilizationId);
    if (inside) {
      v.diplomaticStatus = "ended";
      v.endReason = "merged";
      v.endedAtTick = state.tick;
      v.endedYear = state.year;
      continue;
    }
    if (sources.some((s) => s.id === v.overlordCivilizationId)) v.overlordCivilizationId = tribeId;
    if (sources.some((s) => s.id === v.vassalCivilizationId)) v.vassalCivilizationId = tribeId;
  }
  breakInheritedCycles(ctx, tribeId);
  rel.fusionYears = 0;

  const years = FUSION.yearsRequired;
  const event = emitEvent(ctx, {
    type: "fusion",
    subtype: "composite_identity",
    importance: 5,
    actors: [actor.tribe(tribe), actor.tribe(major.tribe), actor.tribe(minor.tribe)],
    x: tribe.x,
    y: tribe.y,
    title: t("{Art:a} e {art:b} si fondono: {v:c:nasce|nascono} {art:c}", {
      a: peoplePhrase(major.tribe),
      b: peoplePhrase(minor.tribe),
      c: peoplePhrase(tribe),
    }),
    description: t(
      "Dopo oltre {years} anni di {why}, {art:a} e {art:b} sono diventati un solo popolo: {art:c}. È un'identità composita generata dalla simulazione, non una civiltà storica; le identità d'origine restano nella sua memoria.",
      {
        years,
        why: reasons.length ? reasons.join(", ") : "vita comune",
        a: peoplePhrase(major.tribe),
        b: peoplePhrase(minor.tribe),
        c: peoplePhrase(tribe),
      },
    ),
    metadata: {
      compositeId,
      memberKey,
      sourceIdentityIds: composite.sourceIdentityIds,
      sourceCivilizationIds: composite.sourceCivilizationIds,
      newCivilizationId: tribeId,
      reasons,
    },
  });
  composite.causeEventId = event.id || null;
  return composite;
}

/**
 * The new people inherits the relations of its sources with everyone else: at war if either was,
 * allied only if both were, trust averaged, hostility and memory of conflicts the worst of the two.
 */
function inheritRelationships(ctx: SimContext, tribe: Tribe, sources: Tribe[]) {
  const { state } = ctx;
  const sourceIds = new Set(sources.map((s) => s.id));
  const byOther = new Map<string, Relationship[]>();
  for (const r of state.relationships) {
    const inA = sourceIds.has(r.aId);
    const inB = sourceIds.has(r.bId);
    if (inA === inB) continue;
    const other = inA ? r.bId : r.aId;
    if (ctx.tribes.get(other)?.status === "extinct") continue;
    byOther.set(other, [...(byOther.get(other) ?? []), r]);
  }
  for (const [otherId, rels] of [...byOther.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const other = ctx.tribes.get(otherId);
    if (!other) continue;
    const [aId, bId] = other.seq < tribe.seq ? [other.id, tribe.id] : [tribe.id, other.id];
    const n = rels.length;
    const avg = (f: (r: Relationship) => number) => round(rels.reduce((acc, r) => acc + f(r), 0) / n, 3);
    const max = (f: (r: Relationship) => number) => Math.max(...rels.map(f));
    const atWar = rels.some((r) => r.atWar);
    state.relationships.push({
      id: `${aId}|${bId}`,
      aId,
      bId,
      trust: avg((r) => r.trust),
      hostility: max((r) => r.hostility),
      tradeVolume: round(
        rels.reduce((acc, r) => acc + r.tradeVolume, 0),
        2,
      ),
      conflictMemory: max((r) => r.conflictMemory),
      atWar,
      warStartYear: atWar
        ? Math.min(...rels.filter((r) => r.atWar).map((r) => r.warStartYear ?? state.year))
        : null,
      allied: !atWar && rels.length === sources.length && rels.every((r) => r.allied),
      distance: Math.min(...rels.map((r) => r.distance)),
      lastInteractionYear: state.year,
      battles: rels.reduce((acc, r) => acc + r.battles, 0),
      // Only a truce that is still running carries over: inheriting an expired one would
      // leave the new relationship permanently labelled as a truce nobody signed.
      truceUntilYear: atWar
        ? null
        : (rels.map((r) => r.truceUntilYear).find((y) => y !== null && y > state.year) ?? null),
      respect: avg((r) => r.respect),
      tradeDependency: max((r) => r.tradeDependency),
      culturalDistance: avg((r) => r.culturalDistance),
      status: atWar ? "war" : "contact",
      phase: atWar ? "war" : "peace",
      lastConflictYear: rels
        .map((r) => r.lastConflictYear)
        .reduce<number | null>((acc, y) => (y === null ? acc : Math.max(acc ?? y, y)), null),
      phaseYears: 0,
      fusionYears: 0,
    });
  }
}

/**
 * Inheriting the bonds of two peoples can produce a second overlord or a loop (the new people
 * both above and below someone). The oldest bond is kept; the others end as "merged".
 */
function breakInheritedCycles(ctx: SimContext, tribeId: string) {
  const { state } = ctx;
  const end = (v: (typeof state.vassalages)[number]) => {
    v.diplomaticStatus = "ended";
    v.endReason = "merged";
    v.endedAtTick = state.tick;
    v.endedYear = state.year;
  };
  const above = state.vassalages
    .filter((v) => v.diplomaticStatus !== "ended" && v.vassalCivilizationId === tribeId)
    .sort((x, y) => x.seq - y.seq);
  for (const extra of above.slice(1)) end(extra);
  const kept = above[0];
  if (kept && overlordChain(state, kept.overlordCivilizationId).includes(tribeId)) end(kept);
}
