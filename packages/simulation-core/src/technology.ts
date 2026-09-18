import type { Community, SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { cellsInRadius } from "./grid";
import type { Cell, Tribe } from "./types";

export interface TechEffects {
  gatherMultiplier: number;
  huntMultiplier: number;
  farmMultiplier: number;
  storageMultiplier: number;
  spoilageMultiplier: number;
  mortalityMultiplier: number;
  buildMultiplier: number;
  militaryMultiplier: number;
  defenseMultiplier: number;
  innovationMultiplier: number;
  diffusionMultiplier: number;
  cohesion: number;
}

/** Snapshot of a tribe's situation used to evaluate technology conditions. */
export interface TechConditionInput {
  tribe: Tribe;
  population: number;
  settled: boolean;
  settlements: number;
  maxSettlementLevel: number;
  area: Cell[];
  maxHostility: number;
  conflictMemory: number;
}

export interface TechnologyDefinition {
  id: string;
  name: string;
  description: string;
  prerequisites: string[];
  /** Research effort; progress accumulates each year while conditions hold. */
  cost: number;
  minPopulation: number;
  requiresSettlement: boolean;
  resourceRequirement: string;
  geographyRequirement: string | null;
  condition: (input: TechConditionInput) => boolean;
  effects: Partial<TechEffects>;
  effectSummary: string;
}

const sum = (cells: Cell[], pick: (c: Cell) => number) => cells.reduce((acc, c) => acc + pick(c), 0);

export const TECHNOLOGIES: readonly TechnologyDefinition[] = [
  {
    id: "fire",
    name: "Controllo del fuoco",
    description: "Cottura dei cibi, calore e protezione notturna.",
    prerequisites: [],
    cost: 60,
    minPopulation: 10,
    requiresSettlement: false,
    resourceRequirement: "Legname nel territorio ≥ 30",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.wood) >= 30,
    effects: { gatherMultiplier: 1.1, huntMultiplier: 1.1, mortalityMultiplier: 0.85 },
    effectSummary: "+10% cibo, -15% mortalità",
  },
  {
    id: "stone_tools",
    name: "Utensili di pietra",
    description: "Lame, raschiatoi e punte scheggiate.",
    prerequisites: [],
    cost: 70,
    minPopulation: 10,
    requiresSettlement: false,
    resourceRequirement: "Pietra nel territorio ≥ 60",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.stone) >= 60,
    effects: { huntMultiplier: 1.2, gatherMultiplier: 1.1, buildMultiplier: 1.2, militaryMultiplier: 1.1 },
    effectSummary: "+20% caccia, +20% costruzione",
  },
  {
    id: "agriculture",
    name: "Agricoltura",
    description: "Coltivazione stabile di cereali e legumi.",
    prerequisites: ["stone_tools"],
    cost: 200,
    minPopulation: 20,
    requiresSettlement: false,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Terre fertili (fertilità ≥ 0,55) e permanenza ≥ 4 anni",
    condition: (i) =>
      (i.settled || i.tribe.yearsAtLocation >= 4) && i.area.some((c) => c.baseFertility >= 0.55),
    effects: { farmMultiplier: 1 },
    effectSummary: "Sblocca i campi agricoli",
  },
  {
    id: "pottery",
    name: "Ceramica",
    description: "Vasi di argilla per conservare cibo e acqua.",
    prerequisites: ["fire", "agriculture"],
    cost: 180,
    minPopulation: 25,
    requiresSettlement: true,
    resourceRequirement: "Argilla: acqua abbondante nel territorio",
    geographyRequirement: "Fiume o costa vicini",
    condition: (i) => i.area.some((c) => c.water >= 0.7),
    effects: { storageMultiplier: 1.5, spoilageMultiplier: 0.5 },
    effectSummary: "+50% magazzino, -50% deperimento",
  },
  {
    id: "animal_husbandry",
    name: "Allevamento",
    description: "Addomesticamento di capre, pecore e bovini.",
    prerequisites: ["agriculture"],
    cost: 220,
    minPopulation: 30,
    requiresSettlement: true,
    resourceRequirement: "Fauna selvatica abbondante",
    geographyRequirement: "Pianure o colline",
    condition: (i) =>
      i.area.some((c) => c.biome === "plains" || c.biome === "hills") &&
      sum(i.area, (c) => c.maxFauna) >= 200,
    effects: { farmMultiplier: 1.25, huntMultiplier: 1.1 },
    effectSummary: "+25% resa agricola, fertilità recupera più in fretta",
  },
  {
    id: "copper_working",
    name: "Lavorazione del rame",
    description: "Fusione e martellatura del rame nativo.",
    prerequisites: ["fire", "stone_tools"],
    cost: 280,
    minPopulation: 35,
    requiresSettlement: true,
    resourceRequirement: "Giacimento di rame nel territorio",
    geographyRequirement: "Colline o montagne con rame",
    condition: (i) => i.area.some((c) => c.copper > 0),
    effects: { buildMultiplier: 1.3, militaryMultiplier: 1.3, defenseMultiplier: 1.2, farmMultiplier: 1.1 },
    effectSummary: "+30% costruzione e forza militare, +20% difesa",
  },
  {
    id: "writing",
    name: "Scrittura",
    description: "Registri, contabilità e trasmissione del sapere.",
    prerequisites: ["pottery"],
    cost: 480,
    minPopulation: 80,
    requiresSettlement: true,
    resourceRequirement: "Surplus alimentare",
    geographyRequirement: "Insediamento di livello ≥ 2",
    condition: (i) => i.maxSettlementLevel >= 2,
    effects: { innovationMultiplier: 1.4, diffusionMultiplier: 1.5, storageMultiplier: 1.2, cohesion: 0.1 },
    effectSummary: "+40% innovazione, +50% diffusione, amministrazione migliore",
  },
  {
    id: "military_org",
    name: "Organizzazione militare",
    description: "Gerarchie, addestramento e tattiche coordinate.",
    prerequisites: ["copper_working"],
    cost: 320,
    minPopulation: 60,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Esperienza di conflitto o vicini ostili",
    condition: (i) => i.conflictMemory > 0.2 || i.maxHostility > 0.45,
    effects: { militaryMultiplier: 1.4, defenseMultiplier: 1.2, cohesion: 0.15 },
    effectSummary: "+40% forza militare, maggiore coesione",
  },
];

export const TECH_BY_ID = new Map(TECHNOLOGIES.map((t) => [t.id, t]));

const NEUTRAL: TechEffects = {
  gatherMultiplier: 1,
  huntMultiplier: 1,
  farmMultiplier: 0,
  storageMultiplier: 1,
  spoilageMultiplier: 1,
  mortalityMultiplier: 1,
  buildMultiplier: 1,
  militaryMultiplier: 1,
  defenseMultiplier: 1,
  innovationMultiplier: 1,
  diffusionMultiplier: 1,
  cohesion: 0,
};

export function techEffects(techs: readonly string[]): TechEffects {
  const result = { ...NEUTRAL };
  for (const id of techs) {
    const effects = TECH_BY_ID.get(id)?.effects;
    if (!effects) continue;
    for (const key of Object.keys(effects) as (keyof TechEffects)[]) {
      const value = effects[key] ?? 0;
      if (key === "cohesion") result.cohesion += value;
      else if (key === "farmMultiplier")
        result.farmMultiplier = result.farmMultiplier === 0 ? value : result.farmMultiplier * value;
      else result[key] *= value;
    }
  }
  return result;
}

export function hasTech(tribe: Tribe, id: string): boolean {
  return tribe.techs.includes(id);
}

export function prerequisitesMet(tribe: Tribe, tech: TechnologyDefinition): boolean {
  return tech.prerequisites.every((p) => tribe.techs.includes(p));
}

export function canResearch(tech: TechnologyDefinition, input: TechConditionInput): boolean {
  if (hasTech(input.tribe, tech.id)) return false;
  if (!prerequisitesMet(input.tribe, tech)) return false;
  if (input.population < tech.minPopulation) return false;
  if (tech.requiresSettlement && !input.settled) return false;
  return tech.condition(input);
}

export type DiscoveryMethod = "invention" | "diffusion" | "conquest" | "migration";

export function grantTech(
  ctx: SimContext,
  tribe: Tribe,
  techId: string,
  method: DiscoveryMethod,
  sourceTribe?: Tribe,
) {
  const tech = TECH_BY_ID.get(techId);
  if (!tech || tribe.techs.includes(techId) || !prerequisitesMet(tribe, tech)) return false;
  tribe.techs.push(techId);
  delete tribe.techProgress[techId];
  for (const p of ctx.state.people) {
    if (p.alive && p.tribeId === tribe.id && !p.knowledge.includes(techId)) p.knowledge.push(techId);
  }
  const major = techId === "agriculture" || techId === "writing";
  const how =
    method === "invention"
      ? "ha scoperto"
      : method === "diffusion"
        ? `ha appreso dai ${sourceTribe?.name ?? "vicini"}`
        : method === "conquest"
          ? "ha acquisito con la conquista"
          : "ha appreso dai nuovi arrivati";
  emitEvent(ctx, {
    type: "tech_discovered",
    importance: major ? 4 : 3,
    actors: sourceTribe ? [actor.tribe(tribe), actor.tribe(sourceTribe)] : [actor.tribe(tribe)],
    x: tribe.x,
    y: tribe.y,
    title: `${tribe.name}: ${tech.name}`,
    description: `La tribù ${tribe.name} ${how} la tecnica: ${tech.name.toLowerCase()}. ${tech.effectSummary}.`,
    metadata: { techId, method, sourceTribeId: sourceTribe?.id ?? null },
  });
  return true;
}

/** Research step for one tribe: progress depends on curious adults, food surplus and existing knowledge. */
export function advanceResearch(
  ctx: SimContext,
  tribe: Tribe,
  communities: Community[],
  input: Omit<TechConditionInput, "area">,
) {
  const members = communities.flatMap((c) => c.members);
  const area = communities.flatMap((c) => cellsInRadius(ctx.state, c.x, c.y, c.radius));
  const conditionInput: TechConditionInput = { ...input, area };
  const adults = members.filter((p) => p.age >= 16);
  const curiosity = adults.slice(0, 60).reduce((acc, p) => acc + p.personality.curiosity, 0);
  const foodRatio = communities.length
    ? communities.reduce((acc, c) => acc + c.foodRatio * c.members.length, 0) / Math.max(1, members.length)
    : 0;
  const surplus =
    foodRatio >= 1
      ? 1 +
        Math.min(
          0.5,
          (tribe.stock.food + communities.reduce((a, c) => a + c.stock.food, 0)) /
            Math.max(1, members.length) /
            2,
        )
      : foodRatio * 0.6;
  const effects = techEffects(tribe.techs);
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const leaderBonus = leader?.alive ? 1 + leader.personality.curiosity * 0.2 : 1;
  const effort = (0.15 + curiosity * 0.025) * surplus * effects.innovationMultiplier * leaderBonus;

  for (const tech of TECHNOLOGIES) {
    if (!canResearch(tech, conditionInput)) continue;
    const progress = (tribe.techProgress[tech.id] ?? 0) + effort * ctx.rng.range(0.6, 1.4);
    tribe.techProgress[tech.id] = Math.round(progress * 1000) / 1000;
    if (progress >= tech.cost) grantTech(ctx, tribe, tech.id, "invention");
  }
}

/** Knowledge sharing between groups: speeds up research instead of instantly copying technology. */
export function shareKnowledge(ctx: SimContext, from: Tribe, to: Tribe, intensity: number) {
  const effects = techEffects(to.techs);
  for (const techId of from.techs) {
    const tech = TECH_BY_ID.get(techId);
    if (!tech || to.techs.includes(techId) || !prerequisitesMet(to, tech)) continue;
    const gain = tech.cost * intensity * effects.diffusionMultiplier;
    const progress = (to.techProgress[techId] ?? 0) + gain;
    to.techProgress[techId] = Math.round(progress * 1000) / 1000;
    if (progress >= tech.cost) grantTech(ctx, to, techId, "diffusion", from);
    return;
  }
}
