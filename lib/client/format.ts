const intFmt = new Intl.NumberFormat("it-IT");
const decFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

export const fmtInt = (n: number) => intFmt.format(Math.round(n));
export const fmtDec = (n: number) => decFmt.format(n);
export const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

/** Negative years are shown with a true minus sign, as on a chronology. */
export function fmtYear(year: number): string {
  const abs = intFmt.format(Math.abs(year));
  return year < 0 ? `−${abs}` : abs;
}

export const BIOME_LABELS = [
  "Oceano",
  "Costa",
  "Pianura",
  "Foresta",
  "Collina",
  "Montagna",
  "Deserto",
  "Tundra",
] as const;

export const EVENT_LABELS: Record<string, string> = {
  birth: "Nascita",
  notable_death: "Morte illustre",
  famine: "Carestia",
  migration: "Migrazione",
  settlement_founded: "Fondazione",
  construction: "Costruzione",
  tech_discovered: "Scoperta",
  trade: "Commercio",
  conflict: "Conflitto",
  battle: "Battaglia",
  peace: "Pace",
  settlement_collapse: "Collasso",
  population_growth: "Crescita",
  civilization_founded: "Nuova civiltà",
  alliance: "Alleanza",
  tribe_extinct: "Estinzione",
  conquest: "Conquista",
  climate: "Clima",
  epidemic: "Epidemia",
  leadership: "Guida",
  unrest: "Tensioni interne",
  culture: "Cultura",
  settlement_growth: "Crescita urbana",
  civilization_transformed: "Trasformazione politica",
  vassalage: "Vassallaggio",
  occupation: "Occupazione",
  fusion: "Fusione di popoli",
};

export const IMPORTANCE_LABELS: Record<number, string> = {
  1: "micro-evento",
  2: "evento locale",
  3: "evento importante",
  4: "evento regionale",
  5: "svolta storica",
};

export const SEASON_LABELS: Record<string, string> = {
  spring: "Primavera",
  summer: "Estate",
  autumn: "Autunno",
  winter: "Inverno",
};

export const GOVERNMENT_LABELS: Record<string, string> = {
  clan: "Clan",
  elder_council: "Consiglio degli anziani",
  chiefdom: "Chiefdom",
  tribal_monarchy: "Monarchia tribale",
  city_state: "Città-stato",
  merchant_republic: "Repubblica mercantile",
};

export const TIER_LABELS: Record<string, string> = {
  camp: "Accampamento",
  village: "Villaggio",
  town: "Città",
  city_state: "Città-stato",
  capital: "Capitale",
};

export const DISTRIBUTION_LABELS: Record<string, string> = {
  egalitarian: "Egualitaria",
  workers: "Ai lavoratori",
  warriors: "Ai guerrieri",
  elite: "Alle élite",
};

export const CULTURE_LABELS: Record<string, string> = {
  cooperation: "Cooperazione",
  militarism: "Militarismo",
  tradeOpenness: "Apertura al commercio",
  traditionalism: "Tradizionalismo",
  centralization: "Centralizzazione",
  hierarchy: "Gerarchia sociale",
  spirituality: "Spiritualità",
  innovation: "Innovazione",
  expansionism: "Espansionismo",
  tolerance: "Tolleranza",
  exploration: "Esplorazione",
  administrativeCapacity: "Capacità amministrativa",
  culturalCohesion: "Coesione culturale",
};

export const STABILITY_LABELS: Record<string, string> = {
  happiness: "Benessere",
  cohesion: "Coesione",
  legitimacy: "Legittimità",
  tension: "Tensione sociale",
  order: "Ordine pubblico",
  corruption: "Corruzione",
  revoltRisk: "Rischio rivolta",
};

export const DIPLOMATIC_LABELS: Record<string, string> = {
  unknown: "Sconosciuti",
  contact: "In contatto",
  neutral: "Neutrali",
  trade_partner: "Partner commerciali",
  allied: "Alleati",
  rival: "Rivali",
  war: "In guerra",
  truce: "Tregua",
  vassalage: "Vassallaggio",
  occupation: "Occupazione",
};

export const TRIBUTE_LABELS: Record<string, string> = {
  light: "tributo leggero",
  standard: "tributo ordinario",
  heavy: "tributo pesante",
};

export const VASSAL_STATUS_LABELS: Record<string, string> = {
  active: "Vassallo",
  rebellion: "In rivolta",
  ended: "Concluso",
};

export const VASSAL_END_LABELS: Record<string, string> = {
  independence: "indipendenza",
  rebellion_won: "ribellione vittoriosa",
  extinct: "estinzione",
  merged: "fusione",
};

export const OCCUPATION_POLICY_LABELS: Record<string, string> = {
  military: "militare",
  administrative: "amministrativa",
  extractive: "estrattiva",
  integrative: "integrativa",
};

export const OCCUPATION_STATUS_LABELS: Record<string, string> = {
  active: "In corso",
  annexed: "Annessa",
  liberated: "Liberata",
  autonomous: "Autonoma",
  returned: "Restituita",
  abandoned: "Abbandonata",
};

export const PHASE_LABELS: Record<string, string> = {
  peace: "Pace",
  tension: "Tensione",
  demand: "Richieste",
  threat: "Minaccia",
  raid: "Incursioni",
  war: "Guerra",
  truce: "Tregua",
};

export const TITLE_LABELS: Record<string, string> = {
  chief: "Capo",
  elder: "Anziano",
  commander: "Comandante",
  founder: "Fondatore",
  ruler: "Sovrano",
  inventor: "Inventore",
};

export const ROLE_LABELS: Record<string, string> = {
  child: "Bambino",
  gatherer: "Raccoglitore",
  hunter: "Cacciatore",
  builder: "Costruttore",
  elder: "Anziano",
  leader: "Guida",
  farmer: "Agricoltore",
  warrior: "Guerriero",
  herder: "Allevatore",
  fisher: "Pescatore",
  miner: "Minatore",
  crafter: "Artigiano",
};

export const RESOURCE_LABELS: Record<string, string> = {
  food: "Cibo",
  water: "Acqua",
  wood: "Legname",
  stone: "Pietra",
  clay: "Argilla",
  hides: "Pelli e tessuti",
  copper: "Rame",
  tin: "Stagno",
  iron: "Ferro",
  fuel: "Combustibile",
  tools: "Strumenti",
  wealth: "Ricchezza",
};

export const CRISIS_LABELS: Record<string, string> = {
  epidemic: "Epidemia",
  famine: "Carestia",
  drought: "Siccità",
  flood: "Alluvione",
  wildfire: "Incendio",
  harsh_winter: "Inverno rigido",
  revolt: "Rivolta",
  succession: "Crisi di successione",
};

export const BUILDING_LABELS: Record<string, string> = {
  camp: "Accampamento",
  hut: "Capanne",
  storehouse: "Magazzini",
  farm: "Campi",
  road: "Strade",
  palisade: "Palizzate",
  pasture: "Pascoli",
  well: "Pozzi",
  quarry: "Cave",
  mine: "Miniere",
  kiln: "Fornaci",
  foundry: "Fonderie",
  market: "Mercati",
  temple: "Templi",
  barracks: "Caserme",
  walls: "Mura",
  port: "Porti",
};

export const STATUS_LABELS: Record<string, string> = {
  nomadic: "Nomade",
  settled: "Stanziale",
  extinct: "Estinta",
  active: "Attivo",
  abandoned: "Abbandonato",
  collapsed: "Crollata",
  running: "In corso",
  paused: "In pausa",
  deleting: "In eliminazione",
};

export function eventTone(type: string): "war" | "growth" | "ochre" | "water" | "neutral" {
  if (
    [
      "conflict",
      "battle",
      "conquest",
      "occupation",
      "famine",
      "settlement_collapse",
      "tribe_extinct",
      "notable_death",
      "epidemic",
      "unrest",
    ].includes(type)
  )
    return "war";
  if (
    [
      "settlement_founded",
      "population_growth",
      "civilization_founded",
      "birth",
      "settlement_growth",
    ].includes(type)
  )
    return "growth";
  if (
    [
      "tech_discovered",
      "construction",
      "leadership",
      "culture",
      "civilization_transformed",
      "vassalage",
      "fusion",
    ].includes(type)
  )
    return "ochre";
  if (["trade", "peace", "alliance", "migration", "climate"].includes(type)) return "water";
  return "neutral";
}

/** Reads a numeric metadata value without trusting the shape of the stored JSON. */
export function metaNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function metaText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const SUCCESSION_LAW_LABELS: Record<string, string> = {
  hereditary: "ereditaria",
  elective: "elettiva",
  council: "per consiglio",
  military: "militare",
  religious: "religiosa",
  meritocratic: "per merito",
};

export const DYNASTY_STATUS_LABELS: Record<string, string> = {
  active: "al potere",
  overthrown: "spodestata",
  extinct: "estinta",
  merged: "confluita",
};

export const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  active: "in vigore",
  violated: "rotto",
  expired: "scaduto",
  cancelled: "decaduto",
};

export const REPUTATION_LABELS = {
  reliability: "Affidabilità",
  aggression: "Aggressività",
  tradeReliability: "Lealtà commerciale",
  treatyRespect: "Rispetto dei patti",
  threatLevel: "Pericolosità percepita",
} as const;

export const RESILIENCE_LABELS = {
  foodResilience: "Scorte di cibo",
  economicDiversity: "Diversità economica",
  administrativeCapacity: "Amministrazione",
  socialCohesion: "Coesione sociale",
  reserveCapacity: "Riserve",
  migrationCapacity: "Capacità di spostarsi",
  infrastructureQuality: "Infrastrutture",
  recoverySpeed: "Velocità di ripresa",
  healthCapacity: "Capacità sanitaria",
} as const;

export const FOUNDING_REASON_LABELS: Record<string, string> = {
  migration: "approdo di una migrazione",
  agriculture: "terra da coltivare",
  trade: "posizione di scambio",
  military: "punto da presidiare",
  religious: "luogo di culto",
  resource: "giacimento da sfruttare",
  administrative: "sede di governo",
  refuge: "rifugio",
};

export const SPECIALIZATION_LABELS: Record<string, string> = {
  agricultural: "agricola",
  mining: "mineraria",
  military: "militare",
  commercial: "commerciale",
  harbour: "portuale",
  religious: "religiosa",
  administrative: "amministrativa",
  craft: "artigiana",
};
