import type { Community, SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { cellsInRadius, clamp, round } from "./grid";
import type { Cell, CultureTraits, Tribe } from "./types";

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
  /** Multipliers of the production flows introduced with the extended economy. */
  fishMultiplier: number;
  herdMultiplier: number;
  miningMultiplier: number;
  craftMultiplier: number;
  tradeMultiplier: number;
  /** Additive bonuses, 0 = no effect. */
  hygieneBonus: number;
  legitimacyBonus: number;
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
  /** Number of tribes this one trades with regularly. */
  tradePartners?: number;
  culture?: CultureTraits;
}

export type TechCategory = "survival" | "neolithic" | "metals" | "organization";

export const TECH_CATEGORY_LABELS: Record<TechCategory, string> = {
  survival: "Sopravvivenza",
  neolithic: "Neolitico",
  metals: "Metalli",
  organization: "Organizzazione",
};

export interface TechnologyDefinition {
  id: string;
  name: string;
  category: TechCategory;
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
  /** Downside or cost the technology brings with it, shown in the UI. */
  tradeOff: string | null;
}

const sum = (cells: Cell[], pick: (c: Cell) => number) => cells.reduce((acc, c) => acc + pick(c), 0);
const has = (cells: Cell[], pick: (c: Cell) => boolean) => cells.some(pick);

export const TECHNOLOGIES: readonly TechnologyDefinition[] = [
  // --- Survival -------------------------------------------------------------
  {
    id: "fire",
    name: "Controllo del fuoco",
    category: "survival",
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
    tradeOff: "Consuma più legna da ardere",
  },
  {
    id: "stone_tools",
    name: "Utensili di pietra",
    category: "survival",
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
    tradeOff: null,
  },
  {
    id: "clothing",
    name: "Abiti e pelli conciate",
    category: "survival",
    description: "Pellicce cucite che permettono di svernare e di spingersi a nord.",
    prerequisites: ["stone_tools"],
    cost: 90,
    minPopulation: 12,
    requiresSettlement: false,
    resourceRequirement: "Fauna abbondante (pelli)",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.fauna) >= 40,
    effects: { mortalityMultiplier: 0.9, gatherMultiplier: 1.05 },
    effectSummary: "-10% mortalità, inverni meno letali",
    tradeOff: null,
  },
  {
    id: "food_preservation",
    name: "Conservazione degli alimenti",
    category: "survival",
    description: "Essiccazione, affumicatura e salatura delle scorte.",
    prerequisites: ["fire"],
    cost: 120,
    minPopulation: 15,
    requiresSettlement: false,
    resourceRequirement: "Nessuna",
    geographyRequirement: null,
    condition: () => true,
    effects: { spoilageMultiplier: 0.7, storageMultiplier: 1.2 },
    effectSummary: "-30% deperimento del cibo",
    tradeOff: null,
  },
  {
    id: "fishing",
    name: "Pesca",
    category: "survival",
    description: "Reti, nasse e arpioni lungo fiumi e coste.",
    prerequisites: ["stone_tools"],
    cost: 110,
    minPopulation: 12,
    requiresSettlement: false,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Fiume o costa nel territorio",
    condition: (i) => has(i.area, (c) => c.river || c.coastal),
    effects: { fishMultiplier: 1.6, gatherMultiplier: 1.05 },
    effectSummary: "+60% pesca, sblocca i porti",
    tradeOff: null,
  },

  // --- Neolithic ------------------------------------------------------------
  {
    id: "agriculture",
    name: "Agricoltura",
    category: "neolithic",
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
    tradeOff: "Lega il gruppo alla terra e impoverisce i suoli",
  },
  {
    id: "pottery",
    name: "Ceramica",
    category: "neolithic",
    description: "Vasi di argilla per conservare cibo e acqua.",
    prerequisites: ["fire", "agriculture"],
    cost: 180,
    minPopulation: 25,
    requiresSettlement: true,
    resourceRequirement: "Argilla nel territorio",
    geographyRequirement: "Fiume o costa vicini",
    condition: (i) => i.area.some((c) => c.water >= 0.7 || c.clay > 0),
    effects: { storageMultiplier: 1.5, spoilageMultiplier: 0.5 },
    effectSummary: "+50% magazzino, -50% deperimento",
    tradeOff: null,
  },
  {
    id: "animal_husbandry",
    name: "Allevamento",
    category: "neolithic",
    description: "Addomesticamento di capre, pecore e bovini.",
    prerequisites: ["agriculture"],
    cost: 220,
    minPopulation: 30,
    requiresSettlement: true,
    resourceRequirement: "Fauna selvatica abbondante",
    geographyRequirement: "Pianure o colline",
    condition: (i) =>
      i.area.some((c) => c.biome === "plains" || c.biome === "hills") && sum(i.area, (c) => c.fauna) >= 60,
    effects: { herdMultiplier: 1.3, huntMultiplier: 1.1, mortalityMultiplier: 0.95 },
    effectSummary: "Sblocca i pascoli: cibo e pelli anche d'inverno",
    tradeOff: "Il bestiame avvicina nuove malattie",
  },
  {
    id: "weaving",
    name: "Tessitura",
    category: "neolithic",
    description: "Telai, lino e lana filata.",
    prerequisites: ["animal_husbandry", "clothing"],
    cost: 240,
    minPopulation: 35,
    requiresSettlement: true,
    resourceRequirement: "Pelli o lana disponibili",
    geographyRequirement: null,
    condition: () => true,
    effects: { craftMultiplier: 1.3, tradeMultiplier: 1.15, mortalityMultiplier: 0.95 },
    effectSummary: "+30% artigianato, beni pregiati per gli scambi",
    tradeOff: null,
  },
  {
    id: "irrigation",
    name: "Irrigazione",
    category: "neolithic",
    description: "Canali e pozzi che portano l'acqua ai campi.",
    prerequisites: ["agriculture", "pottery"],
    cost: 300,
    minPopulation: 45,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Fiume o falda accessibile",
    condition: (i) => has(i.area, (c) => c.river || c.water >= 0.6),
    effects: { farmMultiplier: 1.35, hygieneBonus: 0.1 },
    effectSummary: "+35% resa agricola, campi resistenti alla siccità",
    tradeOff: "Richiede manutenzione costante",
  },
  {
    id: "wheel",
    name: "Ruota",
    category: "neolithic",
    description: "Carri e tornio: trasporto e lavorazione cambiano scala.",
    prerequisites: ["animal_husbandry", "pottery"],
    cost: 340,
    minPopulation: 50,
    requiresSettlement: true,
    resourceRequirement: "Legname ≥ 60 nel territorio",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.wood) >= 60,
    effects: { tradeMultiplier: 1.3, buildMultiplier: 1.15, craftMultiplier: 1.15 },
    effectSummary: "+30% commercio, cantieri più rapidi",
    tradeOff: null,
  },
  {
    id: "advanced_construction",
    name: "Costruzione avanzata",
    category: "neolithic",
    description: "Fondazioni, mattoni crudi e murature portanti.",
    prerequisites: ["pottery", "wheel"],
    cost: 420,
    minPopulation: 70,
    requiresSettlement: true,
    resourceRequirement: "Pietra e argilla disponibili",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.stone) >= 80,
    effects: { buildMultiplier: 1.4, defenseMultiplier: 1.2, storageMultiplier: 1.2 },
    effectSummary: "Sblocca le mura, +40% velocità di costruzione",
    tradeOff: null,
  },

  // --- Metals ---------------------------------------------------------------
  {
    id: "copper_working",
    name: "Lavorazione del rame",
    category: "metals",
    description: "Martellatura e fusione del rame nativo.",
    prerequisites: ["fire", "stone_tools"],
    cost: 320,
    minPopulation: 40,
    requiresSettlement: true,
    resourceRequirement: "Giacimenti di rame nel territorio",
    geographyRequirement: "Colline o montagne",
    condition: (i) => has(i.area, (c) => c.copper > 0),
    effects: { militaryMultiplier: 1.25, buildMultiplier: 1.1, craftMultiplier: 1.2 },
    effectSummary: "+25% forza militare, strumenti migliori",
    tradeOff: null,
  },
  {
    id: "smelting",
    name: "Fonderia",
    category: "metals",
    description: "Forni a tiraggio forzato che raggiungono alte temperature.",
    prerequisites: ["copper_working", "pottery"],
    cost: 380,
    minPopulation: 55,
    requiresSettlement: true,
    resourceRequirement: "Combustibile (carbone o legna) disponibile",
    geographyRequirement: null,
    condition: (i) => sum(i.area, (c) => c.wood + c.coal) >= 50,
    effects: { craftMultiplier: 1.3, miningMultiplier: 1.2 },
    effectSummary: "Sblocca la fonderia, +30% artigianato",
    tradeOff: "Divora legna e carbone",
  },
  {
    id: "bronze_working",
    name: "Bronzo",
    category: "metals",
    description: "Lega di rame e stagno: armi e utensili duri.",
    prerequisites: ["smelting"],
    cost: 460,
    minPopulation: 70,
    requiresSettlement: true,
    resourceRequirement: "Rame e stagno (anche via commercio)",
    geographyRequirement: null,
    condition: (i) => has(i.area, (c) => c.tin > 0) || (i.tradePartners ?? 0) >= 1,
    effects: { militaryMultiplier: 1.35, craftMultiplier: 1.25, tradeMultiplier: 1.2 },
    effectSummary: "+35% forza militare, beni di pregio",
    tradeOff: "Dipende dallo stagno: spesso va importato",
  },
  {
    id: "iron_working",
    name: "Lavorazione del ferro",
    category: "metals",
    description: "Riduzione del minerale di ferro e forgiatura.",
    prerequisites: ["bronze_working"],
    cost: 620,
    minPopulation: 90,
    requiresSettlement: true,
    resourceRequirement: "Giacimenti di ferro nel territorio",
    geographyRequirement: "Montagne o colline",
    condition: (i) => has(i.area, (c) => c.iron > 0),
    effects: { militaryMultiplier: 1.45, buildMultiplier: 1.15, craftMultiplier: 1.3 },
    effectSummary: "+45% forza militare, attrezzi di ferro",
    tradeOff: null,
  },
  {
    id: "metal_tools",
    name: "Attrezzi metallici",
    category: "metals",
    description: "Aratri, falci e asce di metallo per il lavoro quotidiano.",
    prerequisites: ["bronze_working"],
    cost: 500,
    minPopulation: 80,
    requiresSettlement: true,
    resourceRequirement: "Una fonderia attiva",
    geographyRequirement: null,
    condition: (i) => i.settlements >= 1,
    effects: { farmMultiplier: 1.25, gatherMultiplier: 1.1, miningMultiplier: 1.35, buildMultiplier: 1.2 },
    effectSummary: "+25% agricoltura, +35% estrazione",
    tradeOff: null,
  },

  // --- Organization ---------------------------------------------------------
  {
    id: "writing",
    name: "Scrittura",
    category: "organization",
    description: "Segni incisi per contare, ricordare e comandare a distanza.",
    prerequisites: ["pottery"],
    cost: 520,
    minPopulation: 80,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Almeno 2 insediamenti e un villaggio di livello 3",
    condition: (i) => i.settlements >= 2 && i.maxSettlementLevel >= 3,
    effects: { innovationMultiplier: 1.4, diffusionMultiplier: 1.3, cohesion: 0.1, legitimacyBonus: 0.05 },
    effectSummary: "+40% ricerca, amministrazione a distanza",
    tradeOff: null,
  },
  {
    id: "taxation",
    name: "Tassazione e amministrazione",
    category: "organization",
    description: "Registri, magazzini pubblici e prelievo regolare.",
    prerequisites: ["writing"],
    cost: 560,
    minPopulation: 110,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Almeno 2 insediamenti",
    condition: (i) => i.settlements >= 2,
    effects: { storageMultiplier: 1.2, innovationMultiplier: 1.1, legitimacyBonus: 0.05 },
    effectSummary: "Risorse comuni, opere pubbliche più rapide",
    tradeOff: "Il prelievo alimenta il malcontento e la corruzione",
  },
  {
    id: "laws",
    name: "Leggi scritte",
    category: "organization",
    description: "Norme pubbliche, pene stabilite e giudici.",
    prerequisites: ["taxation"],
    cost: 640,
    minPopulation: 130,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: null,
    condition: (i) => i.settlements >= 2,
    effects: { cohesion: 0.15, legitimacyBonus: 0.12, tradeMultiplier: 1.1 },
    effectSummary: "+coesione e legittimità, meno rivolte",
    tradeOff: null,
  },
  {
    id: "military_org",
    name: "Organizzazione militare",
    category: "organization",
    description: "Guerrieri addestrati stabilmente e ranghi riconosciuti.",
    prerequisites: ["stone_tools"],
    cost: 300,
    minPopulation: 45,
    requiresSettlement: false,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Tensione con i vicini (ostilità ≥ 0,35 o memoria di conflitti)",
    condition: (i) => i.maxHostility >= 0.35 || i.conflictMemory > 0.2,
    effects: { militaryMultiplier: 1.3, defenseMultiplier: 1.2, cohesion: 0.05 },
    effectSummary: "+30% forza militare, +20% difesa",
    tradeOff: "Guerrieri sottratti alla produzione",
  },
  {
    id: "long_distance_trade",
    name: "Commercio a lunga distanza",
    category: "organization",
    description: "Carovane, pesi condivisi e rotte regolari.",
    prerequisites: ["wheel", "writing"],
    cost: 600,
    minPopulation: 100,
    requiresSettlement: true,
    resourceRequirement: "Nessuna",
    geographyRequirement: "Almeno un partner commerciale",
    condition: (i) => (i.tradePartners ?? 0) >= 1,
    effects: { tradeMultiplier: 1.6, diffusionMultiplier: 1.4, innovationMultiplier: 1.1 },
    effectSummary: "+60% commercio, sblocca il mercato",
    tradeOff: "Le rotte portano anche le epidemie",
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
  fishMultiplier: 1,
  herdMultiplier: 1,
  miningMultiplier: 1,
  craftMultiplier: 1,
  tradeMultiplier: 1,
  hygieneBonus: 0,
  legitimacyBonus: 0,
};

export function neutralEffects(): TechEffects {
  return { ...NEUTRAL };
}

const ADDITIVE = new Set<keyof TechEffects>(["cohesion", "hygieneBonus", "legitimacyBonus"]);

function applyEffects(result: TechEffects, effects: Partial<TechEffects>, weight: number) {
  for (const key of Object.keys(effects) as (keyof TechEffects)[]) {
    const value = effects[key] ?? 0;
    if (ADDITIVE.has(key)) {
      result[key] += value * weight;
    } else if (key === "farmMultiplier") {
      // farmMultiplier starts at 0 (farming impossible) and becomes a real multiplier once unlocked.
      const scaled = 1 + (value - 1) * weight;
      result.farmMultiplier = result.farmMultiplier === 0 ? value * weight : result.farmMultiplier * scaled;
    } else {
      result[key] *= 1 + (value - 1) * weight;
    }
  }
}

/** Full-strength effects of a set of technologies (adoption assumed complete). */
export function techEffects(techs: readonly string[]): TechEffects {
  const result = neutralEffects();
  for (const id of techs) {
    const effects = TECH_BY_ID.get(id)?.effects;
    if (effects) applyEffects(result, effects, 1);
  }
  return result;
}

/**
 * Effects actually felt by a tribe: a technology only delivers its full benefit once it is
 * adopted. Knowledge learned from neighbours starts at a low adoption level and grows.
 */
export function tribeEffects(tribe: Tribe): TechEffects {
  const result = neutralEffects();
  for (const id of tribe.techs) {
    const effects = TECH_BY_ID.get(id)?.effects;
    if (!effects) continue;
    const adoption = clamp(tribe.techAdoption?.[id] ?? 1, 0.1, 1);
    applyEffects(result, effects, adoption);
  }
  return result;
}

export type TechStatus =
  "unknown" | "observed" | "experimenting" | "developing" | "discovered" | "spreading" | "adopted";

/** Human-readable progression state of one technology inside one tribe. */
export function techStatus(tribe: Tribe, techId: string): TechStatus {
  if (tribe.techs.includes(techId)) {
    const adoption = tribe.techAdoption?.[techId] ?? 1;
    if (adoption >= 0.95) return "adopted";
    if (adoption >= 0.5) return "spreading";
    return "discovered";
  }
  const tech = TECH_BY_ID.get(techId);
  if (!tech) return "unknown";
  const progress = tribe.techProgress[techId] ?? 0;
  if (progress <= 0) return prerequisitesMet(tribe, tech) ? "observed" : "unknown";
  if (progress < tech.cost * 0.35) return "experimenting";
  return "developing";
}

export const TECH_STATUS_LABELS: Record<TechStatus, string> = {
  unknown: "sconosciuta",
  observed: "in osservazione",
  experimenting: "in sperimentazione",
  developing: "in sviluppo",
  discovered: "scoperta",
  spreading: "in diffusione",
  adopted: "adottata",
};

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

/** Initial adoption level by how the technology arrived. */
const INITIAL_ADOPTION: Record<DiscoveryMethod, number> = {
  invention: 0.55,
  diffusion: 0.2,
  conquest: 0.12,
  migration: 0.15,
};

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
  tribe.techAdoption[techId] = INITIAL_ADOPTION[method];
  for (const p of ctx.state.people) {
    if (p.alive && p.tribeId === tribe.id && !p.knowledge.includes(techId)) p.knowledge.push(techId);
  }
  // The most curious adult of the group is remembered as the inventor.
  let inventor = null;
  if (method === "invention") {
    const adults = ctx.state.people.filter((p) => p.alive && p.tribeId === tribe.id && p.age >= 18);
    inventor = adults.reduce<(typeof adults)[number] | null>(
      (best, p) =>
        !best || p.personality.curiosity + p.education > best.personality.curiosity + best.education
          ? p
          : best,
      null,
    );
    if (inventor) {
      inventor.notable = true;
      inventor.prestige = clamp(inventor.prestige + 0.12);
      inventor.education = clamp(inventor.education + 0.08);
      if (!inventor.title) {
        inventor.title = "inventor";
        inventor.titleSinceYear = ctx.state.year;
      }
    }
  }
  const major = tech.category === "organization" || tech.category === "metals" || techId === "agriculture";
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
    subtype: method,
    importance: major ? 4 : 3,
    actors: [
      actor.tribe(tribe),
      ...(sourceTribe ? [actor.tribe(sourceTribe)] : []),
      ...(inventor ? [actor.person(inventor)] : []),
    ],
    x: tribe.x,
    y: tribe.y,
    title: `${tribe.name}: ${tech.name}`,
    description: `La tribù ${tribe.name} ${how} la tecnica: ${tech.name.toLowerCase()}. ${tech.effectSummary}.${
      inventor ? ` L'intuizione si deve a ${inventor.name}.` : ""
    }`,
    metadata: {
      techId,
      method,
      category: tech.category,
      sourceTribeId: sourceTribe?.id ?? null,
      inventorId: inventor?.id ?? null,
      adoption: INITIAL_ADOPTION[method],
      tradeOff: tech.tradeOff,
    },
  });
  return true;
}

/** Research step for one tribe: progress depends on curious adults, food surplus and existing knowledge. */
export function advanceResearch(
  ctx: SimContext,
  tribe: Tribe,
  communities: Community[],
  input: Omit<TechConditionInput, "area" | "culture">,
) {
  const members = communities.flatMap((c) => c.members);
  const area = communities.flatMap((c) => cellsInRadius(ctx.state, c.x, c.y, c.radius));
  const conditionInput: TechConditionInput = { ...input, area, culture: tribe.culture };
  const adults = members.filter((p) => p.age >= 16);
  const curiosity = adults
    .slice(0, 60)
    .reduce((acc, p) => acc + p.personality.curiosity + p.education * 0.5, 0);
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
  const effects = tribeEffects(tribe);
  const leader = tribe.leaderId ? ctx.people.get(tribe.leaderId) : undefined;
  const leaderBonus = leader?.alive ? 1 + leader.personality.curiosity * 0.2 + leader.education * 0.2 : 1;
  // Culture and internal stability decide how much of the surplus becomes research.
  const cultural = 0.7 + (tribe.culture.innovation / 100) * 0.6;
  const stability = 0.6 + tribe.stability.order * 0.3 + tribe.stability.cohesion * 0.2;
  const effort =
    (0.15 + curiosity * 0.025) * surplus * effects.innovationMultiplier * leaderBonus * cultural * stability;

  for (const tech of TECHNOLOGIES) {
    if (!canResearch(tech, conditionInput)) continue;
    const progress = (tribe.techProgress[tech.id] ?? 0) + effort * ctx.rng.range(0.6, 1.4);
    tribe.techProgress[tech.id] = round(progress);
    if (progress >= tech.cost) grantTech(ctx, tribe, tech.id, "invention");
  }
  advanceAdoption(ctx, tribe, members.length);
}

/**
 * Known technologies spread inside the tribe: adoption grows with population, stability and
 * settlements, faster for the tribes that value innovation.
 */
export function advanceAdoption(ctx: SimContext, tribe: Tribe, population: number) {
  const speed =
    0.06 +
    Math.min(0.12, population / 1200) +
    (tribe.culture.innovation / 100) * 0.08 +
    tribe.stability.order * 0.05 -
    (tribe.culture.traditionalism / 100) * 0.04;
  for (const id of tribe.techs) {
    const current = tribe.techAdoption[id] ?? 1;
    if (current >= 1) continue;
    const next = clamp(current + Math.max(0.01, speed), 0, 1);
    tribe.techAdoption[id] = round(next);
    if (current < 0.95 && next >= 0.95) {
      const tech = TECH_BY_ID.get(id);
      if (!tech) continue;
      emitEvent(ctx, {
        type: "tech_discovered",
        subtype: "adopted",
        importance: tech.category === "metals" || tech.category === "organization" ? 3 : 2,
        actors: [actor.tribe(tribe)],
        x: tribe.x,
        y: tribe.y,
        title: `${tribe.name}: ${tech.name} entra nell'uso comune`,
        description: `Quello che era il sapere di pochi è ora pratica quotidiana tra i ${tribe.name}: ${tech.name.toLowerCase()} (${tech.effectSummary}).`,
        metadata: { techId: id, adoption: 1, category: tech.category },
      });
    }
  }
}

/** Knowledge sharing between groups: speeds up research instead of instantly copying technology. */
export function shareKnowledge(ctx: SimContext, from: Tribe, to: Tribe, intensity: number) {
  const effects = tribeEffects(to);
  const openness = 0.6 + (to.culture.tradeOpenness / 100) * 0.8;
  for (const techId of from.techs) {
    const tech = TECH_BY_ID.get(techId);
    if (!tech || to.techs.includes(techId) || !prerequisitesMet(to, tech)) continue;
    // Only knowledge the source actually uses can be transmitted.
    const sourceAdoption = clamp(from.techAdoption?.[techId] ?? 1, 0, 1);
    if (sourceAdoption < 0.3) continue;
    const gain = tech.cost * intensity * effects.diffusionMultiplier * openness * sourceAdoption;
    const progress = (to.techProgress[techId] ?? 0) + gain;
    to.techProgress[techId] = round(progress);
    if (progress >= tech.cost) grantTech(ctx, to, techId, "diffusion", from);
    return;
  }
}
