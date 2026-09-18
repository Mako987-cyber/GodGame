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
};

export const BUILDING_LABELS: Record<string, string> = {
  camp: "Accampamento",
  hut: "Capanne",
  storehouse: "Magazzini",
  farm: "Campi",
  road: "Strade",
  palisade: "Palizzate",
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
};

export function eventTone(type: string): "war" | "growth" | "ochre" | "water" | "neutral" {
  if (
    [
      "conflict",
      "battle",
      "conquest",
      "famine",
      "settlement_collapse",
      "tribe_extinct",
      "notable_death",
    ].includes(type)
  )
    return "war";
  if (["settlement_founded", "population_growth", "civilization_founded", "birth"].includes(type))
    return "growth";
  if (["tech_discovered", "construction"].includes(type)) return "ochre";
  if (["trade", "peace", "alliance", "migration"].includes(type)) return "water";
  return "neutral";
}
