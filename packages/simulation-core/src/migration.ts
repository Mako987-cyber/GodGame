import { TRIBE_COLORS } from "./constants";
import type { Community, SimContext } from "./context";
import { emptyStock, nextId } from "./context";
import { initialStability } from "./culture";
import { actor, describePlace, emitEvent, pluralPeople } from "./events";
import { cellsInRadius, distance } from "./grid";
import { identityPlaceName, recordAbsorbedIdentity, successorName } from "./identity";
import { identityOf } from "./identity/composite";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { tribeName } from "./names";
import { areaQuality, workArea } from "./resources";
import { grantTech } from "./technology";
import type { Cell, Relationship, Tribe } from "./types";

export function migrationPressure(community: Community, hostileNearby: boolean): number {
  if (community.kind !== "band") return 0;
  const tribe = community.tribe;
  const quality = areaQuality(community.area);
  let pressure = 0;
  if (tribe.scarcityYears >= 2) pressure = Math.max(pressure, 1);
  else if (tribe.scarcityYears === 1) pressure = Math.max(pressure, 0.4);
  if (quality < 0.35) pressure = Math.max(pressure, 0.8);
  if (hostileNearby) pressure = Math.max(pressure, 0.6);
  if (tribe.yearsAtLocation > 15 && quality < 0.6) pressure = Math.max(pressure, 0.3);
  return pressure;
}

function siteScore(ctx: SimContext, tribe: Tribe, cell: Cell, from: { x: number; y: number }): number {
  if (cell.biome === "ocean" || cell.biome === "mountain") return -Infinity;
  const area = workArea(ctx.state, cell.x, cell.y, 1);
  let score = cell.habitability * 0.6 + areaQuality(area) * 0.5 + cell.water * 0.2;
  score -= distance(cell.x, cell.y, from.x, from.y) * 0.03;
  if (cell.ownerTribeId && cell.ownerTribeId !== tribe.id) score -= 0.5;
  const crowded = ctx.communities.some(
    (c) => c.tribe.id !== tribe.id && distance(c.x, c.y, cell.x, cell.y) <= 3,
  );
  if (crowded) score -= 0.4;
  return score;
}

/** Step 10: bands under pressure scout nearby land and move to the best reachable site. */
export function migrateBand(ctx: SimContext, community: Community, hostileNearby: boolean): boolean {
  const tribe = community.tribe;
  const pressure = migrationPressure(community, hostileNearby);
  if (pressure <= 0 || !ctx.rng.chance(pressure * 0.8)) {
    tribe.yearsAtLocation += 1;
    return false;
  }
  const scouts = community.members.filter((p) => p.action === "move").length;
  const radius = 5 + (scouts > 0 ? 2 : 0) + (tribe.scarcityYears >= 3 ? 2 : 0);
  const from = { x: community.x, y: community.y };
  const current = siteScore(ctx, tribe, ctx.state.cells[from.y * ctx.state.width + from.x] as Cell, from);
  let best: Cell | null = null;
  let bestScore = current + 0.05;
  for (const cell of cellsInRadius(ctx.state, from.x, from.y, radius)) {
    const score = siteScore(ctx, tribe, cell, from);
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  if (!best) {
    tribe.yearsAtLocation += 1;
    return false;
  }
  const dist = distance(best.x, best.y, from.x, from.y);
  const fromPlace = describePlace(ctx.state, from.x, from.y);
  tribe.x = best.x;
  tribe.y = best.y;
  community.x = best.x;
  community.y = best.y;
  const scarcity = tribe.scarcityYears;
  tribe.yearsAtLocation = 0;
  tribe.stock.food = Math.round(tribe.stock.food * 0.8 * 100) / 100;
  for (const p of community.members) {
    p.x = best.x;
    p.y = best.y;
    p.energy = Math.max(0, p.energy - 0.2);
  }
  ctx.counters.migrations += community.members.length;
  if (dist >= 3) {
    const drought = ctx.state.climate.hazards.filter((h) => distance(h.x, h.y, from.x, from.y) <= h.radius);
    const why =
      drought.length > 0
        ? `Spinti dalla ${drought[0]?.kind === "drought" ? "siccità" : "calamità"}`
        : scarcity >= 1
          ? `Dopo ${scarcity === 1 ? "un anno" : `${scarcity} anni`} di scarsità`
          : hostileNearby
            ? "Per sfuggire a vicini ostili"
            : "In cerca di terre più ricche";
    emitEvent(ctx, {
      type: "migration",
      subtype:
        drought.length > 0
          ? "climate"
          : scarcity >= 1
            ? "scarcity"
            : hostileNearby
              ? "threat"
              : "opportunity",
      importance: 2,
      actors: [actor.tribe(tribe)],
      x: best.x,
      y: best.y,
      title: t("{Art:people} {v:people:migra|migrano}", { people: peoplePhrase(tribe) }),
      description: t("{Art:people} {v:people:ha|hanno} lasciato {from}. {why}, {n} hanno raggiunto {to}.", {
        people: peoplePhrase(tribe),
        from: fromPlace,
        why,
        n: pluralPeople(community.members.length),
        to: describePlace(ctx.state, best.x, best.y),
      }),
      metadata: {
        from: [from.x, from.y],
        to: [best.x, best.y],
        distance: dist,
        scarcityYears: scarcity,
        population: community.members.length,
        hostileNearby,
        hazards: drought.map((h) => h.kind).join(","),
      },
      causeEventIds: drought.map((h) => h.eventId).filter((id): id is string => Boolean(id)),
    });
  }
  return true;
}

function newRelationship(a: Tribe, b: Tribe, year: number, trust: number): Relationship {
  const [x, y] = a.seq < b.seq ? [a, b] : [b, a];
  return {
    id: `${x.id}|${y.id}`,
    aId: x.id,
    bId: y.id,
    trust,
    hostility: 0,
    tradeVolume: 0,
    conflictMemory: 0,
    atWar: false,
    warStartYear: null,
    allied: false,
    distance: 0,
    lastInteractionYear: year,
    battles: 0,
    truceUntilYear: null,
    respect: 0.3,
    tradeDependency: 0,
    culturalDistance: 0,
    status: "neutral",
    phase: "peace",
    lastConflictYear: null,
    phaseYears: 0,
    fusionYears: 0,
  };
}

/** Large bands split: part of the households found a new tribe nearby. */
export function splitBand(ctx: SimContext, community: Community): Tribe | null {
  if (community.kind !== "band" || community.members.length <= 90 || !ctx.rng.chance(0.3)) return null;
  const parent = community.tribe;
  const { id, seq } = nextId(ctx.state, "tribe", "t");
  const used = new Set(ctx.state.tribes.map((t) => t.name));
  const identity = identityOf(ctx.state, parent.identityId);
  let name: string;
  if (identity) {
    // The band that leaves is still the same people: it is named after a new home of its own.
    const usedPlaces = new Set(ctx.state.settlements.map((s) => s.name));
    const home = identityPlaceName(identity.namingProfile, `${ctx.state.seed}:${id}:home`, usedPlaces);
    name = successorName(identity, parent, parent, home, used);
  } else {
    name = tribeName(ctx.rng);
    while (used.has(name)) name = tribeName(ctx.rng);
  }
  const target = Math.floor(community.members.length * 0.4);
  const moving = new Set<string>();
  for (const p of community.members) {
    if (moving.size >= target) break;
    if (!p.householdId || p.id === parent.leaderId) continue;
    for (const m of community.members)
      if (m.householdId === p.householdId && m.id !== parent.leaderId) moving.add(m.id);
  }
  if (moving.size < 10) return null;
  const child: Tribe = {
    ...parent,
    id,
    seq,
    name,
    color: TRIBE_COLORS[(seq - 1) % TRIBE_COLORS.length] ?? "#ffffff",
    status: "nomadic",
    stock: emptyStock(),
    techs: [...parent.techs],
    techProgress: { ...parent.techProgress },
    techAdoption: { ...parent.techAdoption },
    techLost: { ...parent.techLost },
    techVariants: { ...parent.techVariants },
    foundedYear: ctx.state.year,
    civilizationId: null,
    leaderId: null,
    parentTribeId: parent.id,
    populationMilestone: 0,
    yearsAtLocation: 0,
    scarcityYears: 0,
    culture: { ...parent.culture },
    government: "clan",
    stability: initialStability(),
    dynastyId: null,
    lastLeaderChangeYear: null,
    identityId: parent.identityId,
    identityType: parent.identityType,
    absorbedIdentityIds: [],
    absorbedByTribeId: null,
    beliefSystemId: null,
    beliefAdherence: 0,
    cultureHistory: [],
    resilience: null,
    causalAnchors: {},
  };
  child.stock.food = Math.round(parent.stock.food * 0.4 * 100) / 100;
  parent.stock.food = Math.round((parent.stock.food - child.stock.food) * 100) / 100;
  ctx.state.tribes.push(child);
  ctx.tribes.set(child.id, child);
  for (const p of community.members) {
    if (!moving.has(p.id)) continue;
    p.tribeId = child.id;
  }
  // The leavers are no longer part of the parent's band this year: if the band founds a
  // settlement later in the same tick, they must not be counted (or housed) as its members.
  community.members = community.members.filter((p) => !moving.has(p.id));
  for (const h of ctx.state.households) {
    const partner = ctx.people.get(h.partnerIds[0]);
    if (partner && moving.has(partner.id)) h.tribeId = child.id;
  }
  ctx.state.relationships.push(newRelationship(parent, child, ctx.state.year, 0.6));
  ctx.counters.migrations += moving.size;
  emitEvent(ctx, {
    type: "migration",
    subtype: "split",
    importance: 3,
    actors: [actor.tribe(child), actor.tribe(parent)],
    x: parent.x,
    y: parent.y,
    title: t("{v:child:Nasce|Nascono} {art:child}", { child: peoplePhrase(child) }),
    description: t(
      "{Art:parent} {v:parent:era diventata troppo numerosa|erano diventati troppo numerosi}: {n} si sono separate formando {art:child}.",
      { parent: peoplePhrase(parent), child: peoplePhrase(child), n: pluralPeople(moving.size) },
    ),
    metadata: { parentTribeId: parent.id, population: moving.size, identityId: parent.identityId },
  });
  return child;
}

/** Tiny tribes that choose to "join a group" merge into a nearby non-hostile tribe, bringing their knowledge. */
export function joinNearbyGroup(
  ctx: SimContext,
  tribe: Tribe,
  members: Community["members"],
  relationships: Map<string, Relationship>,
): boolean {
  if (members.length === 0 || members.length >= 8) return false;
  const joiners = members.filter((p) => p.action === "join_group").length;
  if (joiners < members.length / 2) return false;
  const candidates = ctx.communities.filter((c) => {
    if (c.tribe.id === tribe.id || c.tribe.status === "extinct") return false;
    const rel = relationships.get(
      tribe.seq < c.tribe.seq ? `${tribe.id}|${c.tribe.id}` : `${c.tribe.id}|${tribe.id}`,
    );
    return distance(c.x, c.y, tribe.x, tribe.y) <= 12 && (!rel || (!rel.atWar && rel.hostility < 0.5));
  });
  if (candidates.length === 0) return false;
  const host = candidates.reduce((best, c) =>
    distance(c.x, c.y, tribe.x, tribe.y) < distance(best.x, best.y, tribe.x, tribe.y) ? c : best,
  );
  const carried = new Set(members.flatMap((p) => p.knowledge));
  for (const p of members) {
    p.tribeId = host.tribe.id;
    p.settlementId = host.settlement?.id ?? null;
    p.x = host.x;
    p.y = host.y;
  }
  for (const h of ctx.state.households) if (h.tribeId === tribe.id) h.tribeId = host.tribe.id;
  host.stock.food += tribe.stock.food;
  tribe.stock = emptyStock();
  tribe.status = "extinct";
  tribe.extinctYear = ctx.state.year;
  tribe.absorbedByTribeId = host.tribe.id;
  // The people is not erased: its identity lives on inside the host.
  recordAbsorbedIdentity(host.tribe, tribe);
  ctx.counters.migrations += members.length;
  emitEvent(ctx, {
    type: "migration",
    subtype: "absorption",
    importance: 3,
    actors: [actor.tribe(tribe), actor.tribe(host.tribe)],
    x: host.x,
    y: host.y,
    title: t("{Art:people} si {v:people:unisce|uniscono} {a:host}", {
      people: peoplePhrase(tribe),
      host: peoplePhrase(host.tribe),
    }),
    description: t("Ridotti a {n}, gli ultimi membri {di:people} si sono uniti {a:host}{where}.", {
      n: pluralPeople(members.length),
      people: peoplePhrase(tribe),
      host: peoplePhrase(host.tribe),
      where: host.settlement ? ` presso ${host.settlement.name}` : "",
    }),
    metadata: {
      absorbedTribeId: tribe.id,
      hostTribeId: host.tribe.id,
      population: members.length,
      absorbedIdentityId: tribe.identityId,
      hostIdentityId: host.tribe.identityId,
    },
  });
  for (const techId of carried) grantTech(ctx, host.tribe, techId, "migration");
  return true;
}
