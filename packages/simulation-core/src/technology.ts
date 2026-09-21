import { anchor, causesFrom, releaseAnchor } from "./causality";
import type { Community, SimContext } from "./context";
import { actor, emitEvent } from "./events";
import { cellsInRadius, clamp, round } from "./grid";
import { formatEventDescription as t, peoplePhrase } from "./language/format";
import { hashFloat } from "./prng";
import { variantByKey, variantFor, variantPhrase } from "./tech-variants";
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
  /** Food eaten / food needed last year; drives how urgent food techniques feel. */
  foodRatio?: number;
  /** Internal order, 0..1: a group in chaos neither researches nor keeps what it knows. */
  order?: number;
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
  /** Can be learned from another people. Default: true. */
  canDiffuse?: boolean;
  /** Can be forgotten when the group can no longer sustain it. Default: see `canBeLost`. */
  canBeLost?: boolean;
  /** Traces left behind make it cheaper to relearn. Default: true. */
  canBeRediscovered?: boolean;
}

/**
 * Techniques with no prerequisite at all are the ones every generation rediscovers by living:
 * a band can lose its potters, not the use of fire. Everything else can be forgotten.
 */
export function canBeLost(tech: TechnologyDefinition): boolean {
  return tech.canBeLost ?? tech.prerequisites.length > 0;
}

export function canDiffuse(tech: TechnologyDefinition): boolean {
  return tech.canDiffuse ?? true;
}

export function canBeRediscovered(tech: TechnologyDefinition): boolean {
  return tech.canBeRediscovered ?? true;
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

// --- Research drive: why a people works on one technology rather than another ----------------
//
// The catalog above says WHETHER a technology can be researched. What follows says HOW FAST,
// and it is the reason two peoples that start identical end up on different paths:
//
//   affinity   what the land around them offers (clay, copper, a river, fertile soil);
//   drivers    the pressures that make the technique urgent (hunger, war, trade);
//   aptitude   a stable inclination of the people, derived from the world seed.
//
// None of the three depends on the historical identity: an Egyptian and a Celtic band on the
// same river have the same affinity for irrigation.

/** Pressures that can make a technique urgent for a group. */
export type TechDriver = "food" | "war" | "trade" | "materials" | "knowledge" | "shelter";

export interface TechProfile {
  drivers: readonly TechDriver[];
  /** How favourable the group's land is for this technique, 0 (hostile) .. 1 (ideal). */
  affinity: (input: TechConditionInput) => number;
}

/** Share of the worked area matching a predicate, 0..1. */
const share = (cells: Cell[], pick: (c: Cell) => boolean) =>
  cells.length === 0 ? 0 : cells.filter(pick).length / cells.length;

/** Mean of a per-cell value over the worked area. */
const mean = (cells: Cell[], pick: (c: Cell) => number) =>
  cells.length === 0 ? 0 : sum(cells, pick) / cells.length;

/** Abundance of a deposit relative to the amount that makes the technique comfortable. */
const abundance = (cells: Cell[], pick: (c: Cell) => number, comfortable: number) =>
  clamp(sum(cells, pick) / comfortable, 0, 1);

const TECH_PROFILES: Record<string, TechProfile> = {
  fire: { drivers: ["food", "shelter"], affinity: (i) => abundance(i.area, (c) => c.wood, 180) },
  stone_tools: { drivers: ["food", "materials"], affinity: (i) => abundance(i.area, (c) => c.stone, 260) },
  clothing: {
    drivers: ["shelter"],
    // Cold lands and abundant game: pelts are both needed and available.
    affinity: (i) =>
      clamp(abundance(i.area, (c) => c.fauna, 220) * 0.6 + (1 - mean(i.area, (c) => c.temperature)) * 0.8),
  },
  food_preservation: {
    drivers: ["food"],
    // Hard winters and seasonal gluts are what make preserving worth the effort.
    affinity: (i) => clamp(0.3 + (1 - mean(i.area, (c) => c.temperature)) * 0.6),
  },
  fishing: {
    drivers: ["food"],
    affinity: (i) => clamp(share(i.area, (c) => c.coastal) * 1.4 + share(i.area, (c) => c.river) * 1.1),
  },

  agriculture: {
    drivers: ["food"],
    affinity: (i) => clamp(mean(i.area, (c) => c.baseFertility) * 1.5),
  },
  pottery: {
    drivers: ["food", "materials"],
    affinity: (i) =>
      clamp(abundance(i.area, (c) => c.clay, 40) * 0.9 + share(i.area, (c) => c.water >= 0.7) * 0.5),
  },
  animal_husbandry: {
    drivers: ["food"],
    affinity: (i) =>
      clamp(
        abundance(i.area, (c) => c.fauna, 200) * 0.7 +
          share(i.area, (c) => c.biome === "plains" || c.biome === "hills") * 0.7,
      ),
  },
  weaving: {
    drivers: ["trade", "materials"],
    affinity: (i) => clamp(0.25 + abundance(i.area, (c) => c.fauna, 260) * 0.8),
  },
  irrigation: {
    drivers: ["food"],
    affinity: (i) =>
      clamp(
        (share(i.area, (c) => c.river) * 1.2 + mean(i.area, (c) => c.water) * 0.8) *
          (0.4 + mean(i.area, (c) => c.baseFertility)),
      ),
  },
  wheel: {
    drivers: ["trade", "materials"],
    affinity: (i) =>
      clamp(abundance(i.area, (c) => c.wood, 220) * 0.7 + share(i.area, (c) => c.biome === "plains") * 0.6),
  },
  advanced_construction: {
    drivers: ["shelter", "materials"],
    affinity: (i) =>
      clamp(abundance(i.area, (c) => c.stone, 300) * 0.8 + abundance(i.area, (c) => c.clay, 60) * 0.4),
  },

  copper_working: {
    drivers: ["materials", "war"],
    affinity: (i) => clamp(abundance(i.area, (c) => c.copper, 25) * 1.2),
  },
  smelting: {
    drivers: ["materials"],
    affinity: (i) => clamp(abundance(i.area, (c) => c.wood + c.coal * 2, 200) * 1.1),
  },
  bronze_working: {
    drivers: ["war", "trade"],
    // Tin is rare: most peoples reach bronze through their trade partners, not their own hills.
    affinity: (i) =>
      clamp(abundance(i.area, (c) => c.tin, 12) * 0.9 + Math.min(0.6, (i.tradePartners ?? 0) * 0.25)),
  },
  iron_working: {
    drivers: ["war", "materials"],
    affinity: (i) => clamp(abundance(i.area, (c) => c.iron, 25) * 1.2),
  },
  metal_tools: {
    drivers: ["food", "materials"],
    affinity: (i) =>
      clamp(
        0.3 + abundance(i.area, (c) => c.copper + c.iron, 40) * 0.6 + Math.min(0.3, i.settlements * 0.12),
      ),
  },

  writing: {
    drivers: ["knowledge", "trade"],
    affinity: (i) => clamp(Math.min(0.6, i.settlements * 0.2) + Math.min(0.5, i.maxSettlementLevel * 0.12)),
  },
  taxation: {
    drivers: ["knowledge"],
    affinity: (i) => clamp(0.2 + Math.min(0.8, i.settlements * 0.22)),
  },
  laws: {
    drivers: ["knowledge"],
    affinity: (i) => clamp(0.2 + Math.min(0.5, i.settlements * 0.16) + Math.min(0.4, i.population / 600)),
  },
  military_org: {
    drivers: ["war"],
    affinity: (i) => clamp(0.15 + i.maxHostility * 0.9 + i.conflictMemory * 0.6),
  },
  long_distance_trade: {
    drivers: ["trade"],
    affinity: (i) =>
      clamp(Math.min(0.7, (i.tradePartners ?? 0) * 0.3) + share(i.area, (c) => c.coastal || c.river) * 0.5),
  },
};

const NEUTRAL_PROFILE: TechProfile = { drivers: [], affinity: () => 0.5 };

export function techProfile(techId: string): TechProfile {
  return TECH_PROFILES[techId] ?? NEUTRAL_PROFILE;
}

/** How favourable the group's land is for a technique, 0..1. Pure, no randomness. */
export function techAffinity(tech: TechnologyDefinition, input: TechConditionInput): number {
  return round(clamp(techProfile(tech.id).affinity(input)), 3);
}

/** The pressures the group is under right now, each 0..1. */
export interface TechNeeds {
  food: number;
  war: number;
  trade: number;
  materials: number;
  knowledge: number;
  shelter: number;
}

export function techNeeds(input: TechConditionInput): TechNeeds {
  const foodRatio = input.foodRatio ?? 1;
  return {
    food: round(clamp(1 - foodRatio + Math.min(0.3, (input.tribe.scarcityYears ?? 0) * 0.1)), 3),
    war: round(clamp(Math.max(input.maxHostility, input.conflictMemory)), 3),
    trade: round(clamp((input.tradePartners ?? 0) / 3), 3),
    materials: round(clamp(0.25 + (input.settled ? 0.35 : 0) + Math.min(0.3, input.settlements * 0.12)), 3),
    knowledge: round(
      clamp(Math.min(0.7, input.settlements * 0.2) + Math.min(0.4, input.population / 500)),
      3,
    ),
    shelter: round(clamp(0.2 + (1 - mean(input.area, (c) => c.temperature)) * 0.7), 3),
  };
}

/**
 * Stable inclination of a people toward a family of techniques, 0.55 .. 1.65.
 *
 * Derived by hashing the world seed with the tribe id, so it is identical on every reload and
 * costs nothing in state: two peoples of the same world simply care about different things.
 * It is NOT read from the historical identity.
 */
export function researchAptitude(seed: string, tribeId: string, category: TechCategory): number {
  return round(0.55 + hashFloat(`${seed}|tech-aptitude|${tribeId}|${category}`) * 1.1, 3);
}

/** How much of the research budget a candidate technology attracts, before normalization. */
export function researchWeight(
  tech: TechnologyDefinition,
  input: TechConditionInput,
  aptitude: number,
): number {
  const profile = techProfile(tech.id);
  const needs = techNeeds(input);
  const urgency = profile.drivers.length
    ? profile.drivers.reduce((acc, d) => Math.max(acc, needs[d]), 0)
    : 0.35;
  const affinity = techAffinity(tech, input);
  // A technique nobody needs and the land does not favour still gets a trickle of attention:
  // curiosity alone occasionally produces something.
  return round(clamp(0.15 + affinity * 0.85, 0.15, 1) * (0.45 + urgency * 0.9) * aptitude, 4);
}

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
    const variant = variantByKey(tribe.techVariants?.[id]);
    if (variant) applyEffects(result, variant.effects, adoption);
  }
  return result;
}

export type TechStatus =
  "unknown" | "observed" | "experimenting" | "developing" | "discovered" | "spreading" | "adopted" | "lost";

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
  // A technique this people once practised is not "unknown": it is remembered as lost, until
  // work to relearn it actually starts.
  if (tribe.techLost?.[techId] !== undefined && progress <= 0) return "lost";
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
  lost: "perduta",
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
  // A technique this people once had and lost comes back with the memory of how it was used.
  const lostYear = tribe.techLost?.[techId];
  const rediscovery = lostYear !== undefined;
  tribe.techs.push(techId);
  delete tribe.techProgress[techId];
  if (tribe.techLost) delete tribe.techLost[techId];
  tribe.techAdoption[techId] = rediscovery
    ? clamp(INITIAL_ADOPTION[method] + 0.15, 0, 1)
    : INITIAL_ADOPTION[method];
  // How this people will practise it depends on its own land, whoever it learned it from.
  const variant = variantFor(techId, cellsInRadius(ctx.state, tribe.x, tribe.y, 3), tribe);
  tribe.techVariants ??= {};
  if (variant) tribe.techVariants[techId] = variant.key;
  else delete tribe.techVariants[techId];
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
  const people = peoplePhrase(tribe);
  const how = rediscovery
    ? t("{v:people:ha|hanno} ritrovato", { people })
    : method === "invention"
      ? t("{v:people:ha|hanno} scoperto", { people })
      : method === "diffusion"
        ? sourceTribe
          ? t("{v:people:ha|hanno} appreso {da:source}", { people, source: peoplePhrase(sourceTribe) })
          : t("{v:people:ha|hanno} appreso dai vicini", { people })
        : method === "conquest"
          ? t("{v:people:ha|hanno} acquisito con la conquista", { people })
          : t("{v:people:ha|hanno} appreso dai nuovi arrivati", { people });
  emitEvent(ctx, {
    ...(rediscovery
      ? { causeEventIds: causesFrom(ctx.state.year, [[tribe, `lost:${techId}`, Number.MAX_SAFE_INTEGER]]) }
      : {}),
    type: "tech_discovered",
    subtype: rediscovery ? "rediscovery" : method,
    importance: major || rediscovery ? 4 : 3,
    actors: [
      actor.tribe(tribe),
      ...(sourceTribe ? [actor.tribe(sourceTribe)] : []),
      ...(inventor ? [actor.person(inventor)] : []),
    ],
    x: tribe.x,
    y: tribe.y,
    title: `${tribe.name}: ${tech.name}`,
    description: t("{Art:people} {how} la tecnica: {tech}. {effect}.{local}{inventor}", {
      people,
      how,
      tech: tech.name.toLowerCase(),
      effect: tech.effectSummary,
      local: variant
        ? t(" Qui prende la forma {di:variant}, per via di {cause}.", {
            variant: variantPhrase(variant),
            cause: variant.cause,
          })
        : "",
      inventor: inventor ? ` L'intuizione si deve a ${inventor.name}.` : "",
    }),
    metadata: {
      techId,
      method,
      category: tech.category,
      sourceTribeId: sourceTribe?.id ?? null,
      inventorId: inventor?.id ?? null,
      adoption: tribe.techAdoption[techId] ?? INITIAL_ADOPTION[method],
      tradeOff: tech.tradeOff,
      rediscovery,
      lostYear: lostYear ?? null,
      variant: variant?.key ?? null,
    },
  });
  // The loss has been answered: it is no longer an open cause.
  if (rediscovery) releaseAnchor(tribe, `lost:${techId}`);
  return true;
}

// --- Research budget -------------------------------------------------------------------------

/** Named contributions to the yearly research effort of one people. Every term is testable. */
export interface ResearchBudgetInput {
  /** Sum of `curiosity + education / 2` over the adults actually sampled. */
  knowledge: number;
  /** Food situation, 0 (starving) .. ~1.5 (large stored surplus). */
  surplus: number;
  /** `TechEffects.innovationMultiplier` of the technologies already in use. */
  innovationMultiplier: number;
  /** Curiosity and schooling of the leader, 0.8 .. 1.4. */
  leaderSupport: number;
  /** How much the culture values novelty, 0.7 .. 1.3. */
  culturalDrive: number;
  /** Internal order and cohesion, 0.5 .. 1.1. */
  stability: number;
  /** Towns, workshops and schools concentrate knowledge. */
  urbanKnowledge: number;
  /** Regular contact with other peoples brings problems and solutions from outside. */
  externalContact: number;
}

/** Effort a group can put into research in one year, before it is split between techniques. */
export const RESEARCH_BASE = 0.35;
export const RESEARCH_KNOWLEDGE_WEIGHT = 0.1;
/**
 * How sharply the budget concentrates on the most attractive candidate. 1 would spread it
 * evenly (every people would then follow the cheapest path, i.e. the same one).
 */
export const RESEARCH_FOCUS = 2.2;

export function researchBudget(input: ResearchBudgetInput): number {
  return round(
    (RESEARCH_BASE + input.knowledge * RESEARCH_KNOWLEDGE_WEIGHT) *
      input.surplus *
      input.innovationMultiplier *
      input.leaderSupport *
      input.culturalDrive *
      input.stability *
      input.urbanKnowledge *
      input.externalContact,
    4,
  );
}

export interface TechnologyProgressResult {
  techId: string;
  weight: number;
  /** Share of the yearly budget this technique attracts, 0..1. */
  share: number;
  /** Research points added this year. */
  gain: number;
  progress: number;
  cost: number;
  discovered: boolean;
  /** True when the group had already known and lost this technique. */
  rediscovery: boolean;
}

/** Traces of a lost technique (ruins, tools, elders' tales) make relearning it faster. */
export const REDISCOVERY_SPEED = 1.9;

/**
 * Splits a yearly budget between the techniques a people can currently work on.
 *
 * Pure function: same inputs, same allocation. This is where two peoples with the same
 * starting technologies stop following the same path — the shares depend on their land,
 * their needs and their own inclination, not on the cost of the technique alone.
 */
export function allocateResearch(
  candidates: readonly TechnologyDefinition[],
  input: TechConditionInput,
  budget: number,
  aptitudeOf: (tech: TechnologyDefinition) => number,
  progressOf: (techId: string) => number,
  lost: (techId: string) => boolean,
): TechnologyProgressResult[] {
  if (candidates.length === 0 || budget <= 0) return [];
  const weights = candidates.map((tech) => researchWeight(tech, input, aptitudeOf(tech)));
  const focused = weights.map((w) => Math.pow(Math.max(w, 0.0001), RESEARCH_FOCUS));
  const total = focused.reduce((acc, w) => acc + w, 0);
  return candidates.map((tech, i) => {
    const s = total > 0 ? (focused[i] ?? 0) / total : 1 / candidates.length;
    const rediscovery = lost(tech.id);
    const gain = budget * s * (rediscovery ? REDISCOVERY_SPEED : 1);
    const progress = progressOf(tech.id) + gain;
    return {
      techId: tech.id,
      weight: weights[i] ?? 0,
      share: round(s, 4),
      gain: round(gain, 4),
      progress: round(progress, 3),
      cost: tech.cost,
      discovered: progress >= tech.cost,
      rediscovery,
    };
  });
}

// --- Loss and rediscovery --------------------------------------------------------------------

/** Below this adoption level nobody practises the technique any more and it is forgotten. */
export const LOSS_THRESHOLD = 0.06;
/** How fast strain eats into adoption each year. */
export const LOSS_RATE = 0.06;
/**
 * Knowledge is held by people, and people do not forget a craft because the band shrank by
 * three. Only a fall well below the population the technique needs starts eroding it, which
 * keeps normal demographic swings from making a people lose and relearn the same technique
 * every other generation.
 */
export const LOSS_POPULATION_MARGIN = 0.6;

/**
 * Pressure that makes a people unable to keep practising a technique: too few hands for the
 * specialists it needs, the settlements that hosted its workshops gone, order collapsed,
 * years of hunger. Zero for a healthy group, so nothing is ever lost "by accident".
 */
export function knowledgeStrain(tech: TechnologyDefinition, input: TechConditionInput): number {
  let strain = 0;
  const sustainable = tech.minPopulation * LOSS_POPULATION_MARGIN;
  if (sustainable > 0 && input.population < sustainable) {
    strain += clamp(1 - input.population / sustainable) * 0.9;
  }
  if (tech.requiresSettlement && !input.settled) strain += 0.45;
  const order = input.order ?? 1;
  if (order < 0.45) strain += (0.45 - order) * 1.3;
  strain += Math.min(0.35, (input.tribe.scarcityYears ?? 0) * 0.07);
  return round(clamp(strain), 3);
}

/**
 * Step 11b: techniques a people can no longer sustain fade out of use and are finally lost.
 * Adoption walks back down the same ladder it climbed (adopted -> spreading -> discovered ->
 * lost), so a technology is never dropped from one year to the next.
 */
export function decayTechnologies(ctx: SimContext, tribe: Tribe, input: TechConditionInput): Set<string> {
  const strained = new Set<string>();
  for (const techId of [...tribe.techs]) {
    const tech = TECH_BY_ID.get(techId);
    if (!tech || !canBeLost(tech)) continue;
    const strain = knowledgeStrain(tech, input);
    if (strain <= 0) continue;
    strained.add(techId);
    const current = clamp(tribe.techAdoption[techId] ?? 1, 0, 1);
    const next = clamp(current - strain * LOSS_RATE, 0, 1);
    tribe.techAdoption[techId] = round(next);
    if (next > LOSS_THRESHOLD) continue;
    loseTech(ctx, tribe, tech, strain, input);
    strained.delete(techId);
  }
  return strained;
}

function lossReason(tech: TechnologyDefinition, input: TechConditionInput): string {
  if (tech.requiresSettlement && !input.settled) return "senza più villaggi dove praticarla";
  if (input.population < tech.minPopulation) return "con troppe poche braccia per tramandarla";
  if ((input.order ?? 1) < 0.45) return "nel disordine che ha disperso chi la conosceva";
  return "dopo anni di carestia che hanno spezzato la trasmissione del mestiere";
}

export function loseTech(
  ctx: SimContext,
  tribe: Tribe,
  tech: TechnologyDefinition,
  strain: number,
  input: TechConditionInput,
) {
  const index = tribe.techs.indexOf(tech.id);
  if (index < 0) return false;
  tribe.techs.splice(index, 1);
  delete tribe.techAdoption[tech.id];
  delete tribe.techProgress[tech.id];
  if (tribe.techVariants) delete tribe.techVariants[tech.id];
  tribe.techLost ??= {};
  tribe.techLost[tech.id] = ctx.state.year;
  // Techniques that depended on this one cannot survive it either: they decay next year.
  const lost = emitEvent(ctx, {
    type: "tech_discovered",
    subtype: "lost",
    importance: tech.category === "survival" ? 3 : 4,
    actors: [actor.tribe(tribe)],
    x: tribe.x,
    y: tribe.y,
    title: `${tribe.name}: ${tech.name} va perduta`,
    description: t("{Art:people} non {v:people:sa|sanno} più {tech}, {reason}.", {
      people: peoplePhrase(tribe),
      tech: tech.name.toLowerCase(),
      reason: lossReason(tech, input),
    }),
    metadata: {
      techId: tech.id,
      category: tech.category,
      strain: round(strain, 3),
      population: input.population,
      settled: input.settled,
      lostYear: ctx.state.year,
    },
    causeEventIds: causesFrom(ctx.state.year, [
      [tribe, "collapse", 40],
      [tribe, "famine", 20],
    ]),
  });
  // A later rediscovery names this loss as its cause.
  anchor(tribe, `lost:${tech.id}`, lost);
  return true;
}

/**
 * Step 11: one year of research for one people.
 *
 * The budget (how much effort the group can spend) and its allocation (on what) are computed
 * separately, so both are testable in isolation: `researchBudget` and `allocateResearch`.
 */
export function advanceResearch(
  ctx: SimContext,
  tribe: Tribe,
  communities: Community[],
  input: Omit<TechConditionInput, "area" | "culture">,
) {
  const members = communities.flatMap((c) => c.members);
  const area = communities.flatMap((c) => cellsInRadius(ctx.state, c.x, c.y, c.radius));
  const adults = members.filter((p) => p.age >= 16);
  const foodRatio = communities.length
    ? communities.reduce((acc, c) => acc + c.foodRatio * c.members.length, 0) / Math.max(1, members.length)
    : 0;
  const conditionInput: TechConditionInput = {
    ...input,
    area,
    culture: tribe.culture,
    foodRatio: round(foodRatio, 3),
    order: tribe.stability.order,
  };

  // Techniques the group can no longer sustain fade before new ones are considered.
  const strained = decayTechnologies(ctx, tribe, conditionInput);

  const knowledge = adults
    .slice(0, 60)
    .reduce((acc, p) => acc + p.personality.curiosity + p.education * 0.5, 0);
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
  const budget = researchBudget({
    knowledge,
    surplus,
    innovationMultiplier: effects.innovationMultiplier,
    leaderSupport: leader?.alive ? 1 + leader.personality.curiosity * 0.2 + leader.education * 0.2 : 1,
    culturalDrive: 0.7 + (tribe.culture.innovation / 100) * 0.6,
    stability: 0.6 + tribe.stability.order * 0.3 + tribe.stability.cohesion * 0.2,
    urbanKnowledge:
      1 + Math.min(0.6, input.settlements * 0.14) + Math.min(0.4, input.maxSettlementLevel * 0.07),
    externalContact: 1 + Math.min(0.35, (input.tradePartners ?? 0) * 0.09),
  });

  const candidates = TECHNOLOGIES.filter((tech) => canResearch(tech, conditionInput));
  const allocation = allocateResearch(
    candidates,
    conditionInput,
    // A little year-to-year noise, so a people is not a machine that always spends the same.
    budget * ctx.rng.range(0.75, 1.25),
    (tech) => researchAptitude(ctx.state.seed, tribe.id, tech.category),
    (techId) => tribe.techProgress[techId] ?? 0,
    (techId) => tribe.techLost?.[techId] !== undefined,
  );
  for (const step of allocation) {
    tribe.techProgress[step.techId] = step.progress;
    if (step.discovered) grantTech(ctx, tribe, step.techId, "invention");
  }
  advanceAdoption(ctx, tribe, members.length, strained);
}

/**
 * Known technologies spread inside the tribe: adoption grows with population, stability and
 * settlements, faster for the tribes that value innovation.
 */
export function advanceAdoption(
  ctx: SimContext,
  tribe: Tribe,
  population: number,
  /** Techniques currently under strain do not spread: they are being forgotten, not adopted. */
  strained: ReadonlySet<string> = new Set(),
) {
  const speed =
    0.06 +
    Math.min(0.12, population / 1200) +
    (tribe.culture.innovation / 100) * 0.08 +
    tribe.stability.order * 0.05 -
    (tribe.culture.traditionalism / 100) * 0.04;
  for (const id of tribe.techs) {
    const current = tribe.techAdoption[id] ?? 1;
    if (current >= 1 || strained.has(id)) continue;
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
        description: t(
          "Quello che era il sapere di pochi è ora pratica quotidiana presso {art:people}: {tech} ({effect}).",
          {
            people: peoplePhrase(tribe),
            tech: tech.name.toLowerCase(),
            effect: tech.effectSummary,
          },
        ),
        metadata: { techId: id, adoption: 1, category: tech.category },
      });
    }
  }
}

/**
 * Knowledge passing from one people to another: contact never copies a technology, it only
 * makes the receiver's own work on it faster. The receiver still has to meet the material
 * requirements (deposits, population, settlements) on its own — an inland people does not get
 * fishing from a coastal neighbour just by trading with it.
 *
 * `intensity` is how thick the contact is (trade routes, roads, shared borders).
 */
export function shareKnowledge(ctx: SimContext, from: Tribe, to: Tribe, intensity: number) {
  const effects = tribeEffects(to);
  // An open, tolerant people takes up what it sees; a very traditional one resists it.
  const openness = 0.5 + (to.culture.tradeOpenness / 100) * 0.8 - (to.culture.traditionalism / 100) * 0.25;
  const transferable = from.techs.filter((techId) => {
    const tech = TECH_BY_ID.get(techId);
    if (!tech || !canDiffuse(tech) || to.techs.includes(techId)) return false;
    if (!prerequisitesMet(to, tech)) return false;
    // Only knowledge the source actually uses can be shown and imitated.
    return clamp(from.techAdoption?.[techId] ?? 1, 0, 1) >= 0.3;
  });
  if (transferable.length === 0) return;
  // Attention is limited: what the receiver already half-understands travels first, and at
  // equal footing the simplest technique — the one that can be copied by watching.
  const readiness = (techId: string) => {
    const cost = Math.max(1, TECH_BY_ID.get(techId)?.cost ?? 1);
    return { share: (to.techProgress[techId] ?? 0) / cost, cost };
  };
  const focus = transferable.reduce((best, techId) => {
    const a = readiness(techId);
    const b = readiness(best);
    if (a.share !== b.share) return a.share > b.share ? techId : best;
    return a.cost < b.cost ? techId : best;
  }, transferable[0] as string);
  const tech = TECH_BY_ID.get(focus);
  if (!tech) return;
  const sourceAdoption = clamp(from.techAdoption?.[focus] ?? 1, 0, 1);
  const known = to.techLost?.[focus] !== undefined ? REDISCOVERY_SPEED : 1;
  const gain =
    tech.cost * intensity * effects.diffusionMultiplier * clamp(openness, 0.1, 1.6) * sourceAdoption * known;
  const progress = (to.techProgress[focus] ?? 0) + gain;
  to.techProgress[focus] = round(progress);
  if (progress >= tech.cost) grantTech(ctx, to, focus, "diffusion", from);
}
