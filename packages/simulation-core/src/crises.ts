import { anchor, causesFrom } from "./causality";
import { HOUSING } from "./constants";
import type { Community, SimContext } from "./context";
import { actor, describePlace, emitEvent, pluralPeople } from "./events";
import { clamp, distance, round } from "./grid";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { killPerson } from "./population";
import type { ActiveCrisis, Settlement } from "./types";

/**
 * Crises: epidemics and their aftermath.
 *
 * Nothing here fires "at random": an outbreak needs density, poor sanitation, hunger and
 * contacts. Once it starts it runs for a few years, kills in proportion to how bad the
 * conditions are, and leaves a trace in the chronicle with its causes attached.
 */

export function crisisId(ctx: SimContext, kind: string): string {
  ctx.state.counters.crisis += 1;
  return `cr${ctx.state.counters.crisis}:${kind}`;
}

/** Sanitary conditions of a settlement, 0..1. Wells, low density and knowledge push it up. */
export function updateHygiene(ctx: SimContext, community: Community) {
  const s = community.settlement;
  if (!s) return;
  const housing = Math.max(1, s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut);
  const density = clamp(community.members.length / housing, 0, 3);
  const wells = Math.min(0.3, s.buildings.well * 0.15);
  const water = community.area.some((c) => c.river || c.water >= 0.7) ? 0.1 : 0;
  const knowledge = community.tribe.techs.includes("irrigation") ? 0.08 : 0;
  const target = clamp(0.85 - density * 0.4 + wells + water + knowledge);
  s.hygiene = round(clamp(s.hygiene + (target - s.hygiene) * 0.3));
}

export interface EpidemicRisk {
  density: number;
  hygiene: number;
  hunger: number;
  contacts: number;
  total: number;
}

/** Explains, in numbers, why an outbreak is (or is not) likely here. */
export function epidemicRisk(ctx: SimContext, community: Community): EpidemicRisk {
  const s = community.settlement;
  const config = ctx.state.config.crisis;
  if (!s) return { density: 0, hygiene: 1, hunger: 0, contacts: 0, total: 0 };
  const housing = Math.max(1, s.buildings.camp * HOUSING.camp + s.buildings.hut * HOUSING.hut);
  const density = clamp(community.members.length / housing / config.epidemicDensityThreshold, 0, 2.5);
  const hunger = clamp(1 - community.foodRatio);
  // Trade and neighbours bring pathogens in.
  const contacts = clamp(
    ctx.state.relationships.filter(
      (r) => (r.aId === community.tribe.id || r.bId === community.tribe.id) && r.tradeVolume > 5,
    ).length * 0.2,
  );
  const size = clamp(community.members.length / 250);
  const total = clamp(
    density * 0.45 + (1 - s.hygiene) * 0.35 + hunger * 0.25 + contacts * 0.15 + size * 0.2 - 0.35,
  );
  return {
    density: round(density, 3),
    hygiene: s.hygiene,
    hunger: round(hunger, 3),
    contacts: round(contacts, 3),
    total: round(total, 3),
  };
}

/** Step 16: an outbreak may start; existing outbreaks keep killing until they burn out. */
export function updateEpidemics(ctx: SimContext, communities: Community[]) {
  const { state } = ctx;
  const config = state.config.crisis;
  const active = new Map<string, ActiveCrisis>();
  for (const crisis of state.crises) {
    if (crisis.kind === "epidemic" && crisis.untilYear >= state.year && crisis.targetId) {
      active.set(crisis.targetId, crisis);
    }
  }

  for (const c of communities) {
    const s = c.settlement;
    if (!s || s.status !== "active" || c.members.length === 0) continue;
    updateHygiene(ctx, c);
    const ongoing = active.get(s.id);
    if (ongoing) {
      applyEpidemic(ctx, c, s, ongoing);
      continue;
    }
    // A settlement that just went through one keeps some immunity.
    // Survivors carry immunity for a generation: outbreaks in the same place stay rare.
    if (s.lastEpidemicYear !== null && state.year - s.lastEpidemicYear < 30) continue;
    const risk = epidemicRisk(ctx, c);
    if (risk.total <= 0) continue;
    const chance = clamp(config.epidemicBaseChance * (1 + risk.total * 5), 0, 0.08);
    if (!ctx.rng.chance(chance)) continue;
    startEpidemic(ctx, c, s, risk);
  }
}

function startEpidemic(ctx: SimContext, community: Community, settlement: Settlement, risk: EpidemicRisk) {
  const { state } = ctx;
  const severity = round(clamp(0.25 + risk.total * 0.6 + ctx.rng.range(-0.1, 0.15), 0.15, 0.95), 3);
  const years = ctx.rng.int(1, 3);
  const crisis: ActiveCrisis = {
    id: crisisId(ctx, "epidemic"),
    kind: "epidemic",
    scope: "settlement",
    targetId: settlement.id,
    startYear: state.year,
    untilYear: state.year + years - 1,
    severity,
    eventId: null,
  };
  const causes: string[] = [];
  if (risk.density > 0.8) causes.push("il sovraffollamento");
  if (risk.hygiene < 0.6) causes.push("le pessime condizioni igieniche");
  if (risk.hunger > 0.2) causes.push("la fame");
  if (risk.contacts > 0.3) causes.push("i contatti con i mercanti");
  const event = emitEvent(ctx, {
    type: "epidemic",
    subtype: "outbreak",
    importance: 4,
    actors: [actor.settlement(settlement), actor.tribe(community.tribe)],
    x: settlement.x,
    y: settlement.y,
    title: `Epidemia a ${settlement.name}`,
    description: `Un morbo si è diffuso a ${settlement.name}${causes.length ? `, favorito ${causes.length > 1 ? "da" : "da"} ${causes.join(", ")}` : ""}. Durerà circa ${years} ${years === 1 ? "anno" : "anni"}.`,
    metadata: {
      settlementId: settlement.id,
      severity,
      years,
      density: risk.density,
      hygiene: risk.hygiene,
      hunger: risk.hunger,
      contacts: risk.contacts,
      population: community.members.length,
    },
  });
  crisis.eventId = event.id || null;
  state.crises.push(crisis);
  settlement.lastEpidemicYear = state.year;
  applyEpidemic(ctx, community, settlement, crisis);
}

function applyEpidemic(ctx: SimContext, community: Community, settlement: Settlement, crisis: ActiveCrisis) {
  const config = ctx.state.config.crisis;
  const alive = community.members.filter((p) => p.alive);
  if (alive.length === 0) return;
  // Winter outbreaks are deadlier; knowledge and food reduce mortality.
  const winter = ctx.state.climate.winterSeverity;
  const knowledge =
    community.tribe.techs.includes("irrigation") || community.tribe.techs.includes("laws") ? 0.85 : 1;
  const rate = clamp(
    crisis.severity * 0.35 * (0.8 + winter * 0.4) * knowledge * (1.2 - settlement.hygiene * 0.4),
    0,
    config.epidemicMaxMortality,
  );
  let deaths = 0;
  for (const p of alive) {
    if (!p.alive) continue;
    // Frail people die first: the young, the old and the sick.
    const frailty = clamp(1.3 - p.health) * (p.age < 5 || p.age > 55 ? 1.5 : 1);
    if (ctx.rng.chance(clamp(rate * frailty, 0, 0.9))) {
      killPerson(ctx, p, "epidemic");
      deaths++;
    } else {
      p.health = clamp(p.health - ctx.rng.range(0.05, 0.25));
    }
  }
  ctx.counters.epidemicDeaths += deaths;
  settlement.unrest = clamp(settlement.unrest + 0.1);
  community.tribe.stability.happiness = clamp(community.tribe.stability.happiness - 0.08);
  community.tribe.morale = clamp(community.tribe.morale - 0.05, 0.2, 1);
  if (deaths > 0 && deaths >= alive.length * 0.15) {
    emitEvent(ctx, {
      type: "epidemic",
      subtype: "deaths",
      importance: deaths > 40 ? 4 : 3,
      actors: [actor.settlement(settlement), actor.tribe(community.tribe)],
      x: settlement.x,
      y: settlement.y,
      title: `Il morbo falcidia ${settlement.name}`,
      description: `L'epidemia ha ucciso ${pluralPeople(deaths)} a ${settlement.name}, ${Math.round((deaths / alive.length) * 100)}% degli abitanti.`,
      metadata: {
        settlementId: settlement.id,
        deaths,
        share: round(deaths / alive.length, 3),
        severity: crisis.severity,
      },
      causeEventIds: crisis.eventId ? [crisis.eventId] : [],
    });
  }
}

/** Removes crises that have run their course and reports the ones still active. */
export function expireCrises(ctx: SimContext) {
  const { state } = ctx;
  const remaining: ActiveCrisis[] = [];
  for (const crisis of state.crises) {
    if (crisis.untilYear >= state.year) {
      remaining.push(crisis);
      continue;
    }
    if (crisis.kind === "epidemic" && crisis.targetId) {
      const settlement = state.settlements.find((s) => s.id === crisis.targetId);
      if (settlement && settlement.status === "active") {
        emitEvent(ctx, {
          type: "epidemic",
          subtype: "ended",
          importance: 2,
          actors: [actor.settlement(settlement)],
          x: settlement.x,
          y: settlement.y,
          title: `L'epidemia di ${settlement.name} si spegne`,
          description: `Dopo ${state.year - crisis.startYear + 1} ${state.year - crisis.startYear + 1 === 1 ? "anno" : "anni"}, il morbo che colpiva ${settlement.name} si è esaurito.`,
          metadata: { settlementId: settlement.id, years: state.year - crisis.startYear + 1 },
          causeEventIds: crisis.eventId ? [crisis.eventId] : [],
        });
      }
    }
  }
  state.crises = remaining;
}

/** True while the settlement is quarantined by an ongoing outbreak (trade is suspended). */
export function isUnderEpidemic(ctx: SimContext, settlementId: string | null): boolean {
  if (!settlementId) return false;
  return ctx.state.crises.some(
    (c) => c.kind === "epidemic" && c.targetId === settlementId && c.untilYear >= ctx.state.year,
  );
}

/** Revolt: the accumulated unrest turns into open rebellion. Rare and always explained. */
export function tryRevolt(ctx: SimContext, community: Community): boolean {
  const tribe = community.tribe;
  const config = ctx.state.config.society;
  if (tribe.stability.unrestYears < config.unrestYearsBeforeRevolt) return false;
  if (!ctx.rng.chance(config.revoltChance * tribe.stability.revoltRisk)) return false;

  const settlement = community.settlement;
  const causes: string[] = [];
  if (tribe.stability.happiness < 0.4) causes.push("la fame e la miseria");
  if (tribe.distribution === "elite") causes.push("il privilegio di pochi");
  if (tribe.stability.legitimacy < 0.4) causes.push("un potere non più riconosciuto");
  if (tribe.stability.corruption > 0.4) causes.push("gli abusi di chi amministra");
  tribe.stability.tension = clamp(tribe.stability.tension - 0.3);
  tribe.stability.unrestYears = 0;
  tribe.stability.order = clamp(tribe.stability.order - 0.2);
  tribe.morale = clamp(tribe.morale - 0.1, 0.2, 1);
  if (settlement) settlement.unrest = clamp(settlement.unrest + 0.3);
  // A revolt costs lives and stored goods, but it resets the tension.
  const victims = Math.max(1, Math.round(community.members.length * 0.02));
  const pool = community.members.filter((p) => p.alive && p.age >= 16);
  ctx.rng.shuffle(pool);
  for (let i = 0; i < Math.min(victims, pool.length); i++) {
    const victim = pool[i];
    if (victim) killPerson(ctx, victim, "conflict");
  }
  community.stock.food = round(community.stock.food * 0.85, 2);
  const revolt = emitEvent(ctx, {
    type: "unrest",
    subtype: "revolt",
    importance: 4,
    actors: settlement ? [actor.settlement(settlement), actor.tribe(tribe)] : [actor.tribe(tribe)],
    x: community.x,
    y: community.y,
    title: settlement
      ? `Rivolta a ${settlement.name}`
      : t("Rivolta presso {art:people}", { people: peoplePhrase(tribe) }),
    description: t(
      "Dopo {years} anni di malcontento, la popolazione {whose} si è ribellata{causes}. {victims} hanno perso la vita presso {place}.",
      {
        years: config.unrestYearsBeforeRevolt,
        whose: settlement ? `di ${settlement.name}` : t("{di:people}", { people: peoplePhrase(tribe) }),
        causes: causes.length ? `: all'origine ${causes.join(", ")}` : "",
        victims: pluralPeople(victims),
        place: describePlace(ctx.state, community.x, community.y),
      },
    ),
    metadata: {
      tribeId: tribe.id,
      settlementId: settlement?.id ?? null,
      victims,
      legitimacy: tribe.stability.legitimacy,
      happiness: tribe.stability.happiness,
      distribution: tribe.distribution,
      government: tribe.government,
    },
    // Hunger is the commonest root of a revolt: a recent famine is named as its cause.
    causeEventIds: causesFrom(ctx.state.year, [[tribe, "famine", 8]]),
  });
  anchor(tribe, "revolt", revolt);
  return true;
}

/** Ongoing crises affecting a given entity, used to explain later events. */
export function crisesFor(ctx: SimContext, targetId: string): ActiveCrisis[] {
  return ctx.state.crises.filter((c) => c.targetId === targetId && c.untilYear >= ctx.state.year);
}

/** Hazards (drought, flood, fire) currently covering a point. */
export function hazardCauses(ctx: SimContext, x: number, y: number): string[] {
  return ctx.state.climate.hazards
    .filter((h) => distance(h.x, h.y, x, y) <= h.radius && h.eventId)
    .map((h) => h.eventId as string);
}
