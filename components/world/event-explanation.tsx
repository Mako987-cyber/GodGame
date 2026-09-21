"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "@/lib/client/api";
import type { EventDTO, WorldDetail } from "@/lib/dto";
import {
  BUILDING_LABELS,
  CRISIS_LABELS,
  DISTRIBUTION_LABELS,
  EVENT_LABELS,
  GOVERNMENT_LABELS,
  IMPORTANCE_LABELS,
  fmtDec,
  fmtInt,
  fmtPct,
  fmtYear,
  metaNumber,
  metaText,
} from "@/lib/client/format";

const BELIEF_TYPES: Record<string, string> = {
  ancestor_veneration: "culto degli antenati",
  nature_spirituality: "spiritualità della natura",
  river_cult: "culto del fiume",
  solar_cult: "culto solare",
  mountain_cult: "culto della montagna",
  pantheon: "pantheon",
  imperial_cult: "culto dello stato",
  philosophical: "scuola filosofica",
  syncretic: "sincretismo",
};
const beliefLabel = (t: string) => BELIEF_TYPES[t] ?? t;

const OUTCOMES: Record<string, string> = {
  peaceful: "pacifica",
  regency: "con reggenza",
  disputed: "contesa",
  usurpation: "per usurpazione",
  interregnum: "con interregno",
};
const outcomeLabel = (o: string) => OUTCOMES[o] ?? o;

const DYNASTY_ENDS: Record<string, string> = {
  no_heir: "senza eredi",
  usurpation: "spodestata",
  extinct_people: "estinta con il suo popolo",
  merged: "confluita in un altro popolo",
  reform: "abolita da una riforma",
};
const dynastyEndLabel = (r: string) => DYNASTY_ENDS[r] ?? r;

const RESPONSES: Record<string, string> = {
  rationing: "razionamento",
  migration: "migrazione",
  trade: "ricorso al commercio",
  reform: "riforma",
  repression: "repressione",
  redistribution: "redistribuzione",
  colonisation: "colonizzazione",
  war: "guerra",
  appeal_for_help: "richiesta d'aiuto",
  abandon_settlement: "abbandono dell'insediamento",
};
const responseLabel = (r: string) => RESPONSES[r] ?? r;

/**
 * "Perché è successo?": builds an explanation from the structured metadata the engine
 * attaches to every event. No language model involved — only templates over numbers.
 */
function causeLines(event: EventDTO): string[] {
  const m = event.metadata;
  const lines: string[] = [];
  const add = (text: string | null) => {
    if (text) lines.push(text);
  };
  const num = (key: string) => metaNumber(m[key]);
  const text = (key: string) => metaText(m[key]);

  switch (event.type) {
    case "famine": {
      const response = text("response");
      if (response) {
        add(`Risposta scelta: ${responseLabel(response)} — ${metaText(m.responseReason) ?? ""}.`);
        const resilience = num("resilience");
        if (resilience !== null) add(`Resilienza del popolo in quel momento: ${fmtPct(resilience)}.`);
      }
      const ratio = num("foodRatio");
      if (ratio !== null) add(`Il gruppo copriva solo il ${fmtPct(ratio)} del proprio fabbisogno.`);
      const stored = num("stored");
      if (stored !== null) add(`In magazzino restavano ${fmtDec(stored)} unità di cibo.`);
      if (m.harshWinter === true) add("L'inverno è stato eccezionalmente rigido.");
      const hazards = text("hazards");
      if (hazards) add(`Calamità in corso nella zona: ${hazards.split(",").map(hazardLabel).join(", ")}.`);
      const climate = num("climateModifier");
      if (climate !== null)
        add(
          climate < 1
            ? `Annata climatica sfavorevole (indice ${fmtDec(climate)}, sotto la media).`
            : `Indice climatico dell'anno: ${fmtDec(climate)}.`,
        );
      break;
    }
    case "climate": {
      add(metaText(m.cause) ? `Causa: ${metaText(m.cause)}.` : null);
      const severity = num("severity");
      if (severity !== null) add(`Intensità stimata: ${fmtPct(severity)}.`);
      const radius = num("radius");
      if (radius !== null) add(`Area colpita: raggio di ${fmtInt(radius)} celle.`);
      const years = num("years");
      if (years !== null) add(`Durata prevista: ${fmtInt(years)} ${years === 1 ? "anno" : "anni"}.`);
      const settlements = num("settlements");
      if (settlements !== null && settlements > 0) add(`Insediamenti nell'area: ${fmtInt(settlements)}.`);
      break;
    }
    case "epidemic": {
      const density = num("density");
      if (density !== null) add(`Densità abitativa: ${fmtDec(density)} volte la soglia di rischio.`);
      const hygiene = num("hygiene");
      if (hygiene !== null) add(`Condizioni igieniche: ${fmtPct(hygiene)}.`);
      const hunger = num("hunger");
      if (hunger !== null && hunger > 0) add(`Popolazione denutrita: ${fmtPct(hunger)}.`);
      const contacts = num("contacts");
      if (contacts !== null && contacts > 0) add("Contatti commerciali frequenti con altri gruppi.");
      const deaths = num("deaths");
      if (deaths !== null) add(`Vittime: ${fmtInt(deaths)}.`);
      break;
    }
    case "conflict":
    case "battle": {
      const warScore = num("warScore");
      if (warScore !== null) add(`Spinta al conflitto: ${fmtDec(warScore)} (soglia 0,6).`);
      const advantage = num("advantage");
      if (advantage !== null) add(`Rapporto di forze stimato: ${fmtDec(advantage)}×.`);
      const scarcity = num("scarcity");
      if (scarcity !== null && scarcity > 0.2) add(`Scarsità di risorse: ${fmtPct(scarcity)}.`);
      const crowding = num("crowding");
      if (crowding !== null && crowding > 0.3) add(`Pressione sulle terre: ${fmtPct(crowding)}.`);
      const memory = num("conflictMemory");
      if (memory !== null && memory > 0.1) add(`Rancori accumulati: ${fmtPct(memory)}.`);
      const cultural = num("culturalDistance");
      if (cultural !== null && cultural > 0.3) add(`Distanza culturale: ${fmtPct(cultural)}.`);
      const attackers = num("attackerWarriors");
      const defenders = num("defenderWarriors");
      if (attackers !== null && defenders !== null)
        add(`Sul campo: ${fmtInt(attackers)} attaccanti contro ${fmtInt(defenders)} difensori.`);
      const walls = num("walls");
      if (walls !== null && walls > 0) add("Le mura hanno trasformato l'assalto in un assedio.");
      const logistics = num("logistics");
      if (logistics !== null && logistics < 1)
        add(`Logistica sfavorevole all'attaccante (${fmtDec(logistics)}×).`);
      break;
    }
    case "belief": {
      if (event.subtype === "founded") {
        add(metaText(m.type) ? `Forma assunta: ${beliefLabel(text("type") ?? "")}.` : null);
        const spirituality = num("spirituality");
        if (spirituality !== null)
          add(`Spiritualità del popolo: ${fmtInt(spirituality)}/100, abbastanza da cercare una forma.`);
        const population = num("population");
        if (population !== null)
          add(`Popolazione abbastanza numerosa da sostenerne i riti: ${fmtInt(population)}.`);
        add("La forma nasce dalla terra e dalla storia del popolo, non dal suo nome storico.");
      } else if (event.subtype === "syncretism") {
        add("Due popoli vicini e indisturbati per una generazione, entrambi tolleranti.");
        const tolerance = num("tolerance");
        if (tolerance !== null) add(`Tolleranza della nuova credenza: ${fmtPct(tolerance)}.`);
      } else if (event.subtype === "abandoned") {
        add("L'adesione si è esaurita: fame e guerra hanno incrinato la fede.");
      }
      break;
    }
    case "agreement": {
      if (event.subtype === "violated") {
        add(metaText(m.reason) ? `Motivo: ${metaText(m.reason)}.` : null);
        const years = num("years");
        if (years !== null) add(`Il patto reggeva da ${fmtInt(years)} anni.`);
        const respect = num("treatyRespect");
        if (respect !== null) add(`Rispetto dei patti di chi l'ha rotto, dopo: ${fmtPct(respect)}.`);
      } else {
        const trust = num("trustAtStart");
        if (trust !== null) add(`Fiducia fra le parti alla firma: ${fmtPct(trust)}.`);
        const expires = num("expiresAtYear");
        add(expires !== null ? `Scade nel ${fmtYear(expires)}.` : "Senza scadenza.");
      }
      break;
    }
    case "intelligence": {
      const chance = num("successChance");
      if (chance !== null) add(`Probabilità che la missione riuscisse: ${fmtPct(chance)}.`);
      const attempts = num("attempts");
      const caught = num("caught");
      if (attempts !== null && caught !== null)
        add(
          `Missioni tentate finora contro questo popolo: ${fmtInt(attempts)}, scoperte: ${fmtInt(caught)}.`,
        );
      add("Una spia scoperta alza l'ostilità e abbassa la fiducia fra i due popoli.");
      break;
    }
    case "tech_discovered": {
      if (event.subtype === "lost") {
        const strain = num("strain");
        if (strain !== null) add(`Pressione che ha impedito di tramandare la tecnica: ${fmtPct(strain)}.`);
        const population = num("population");
        if (population !== null) add(`Persone rimaste a praticarla: ${fmtInt(population)}.`);
        if (m.settled === false) add("Il popolo non aveva più insediamenti dove esercitarla.");
        add("La perdita è graduale: l'adozione è scesa anno dopo anno prima di sparire.");
        break;
      }
      if (event.subtype === "rediscovery") {
        const lost = num("lostYear");
        if (lost !== null) add(`La tecnica era stata perduta nel ${fmtYear(lost)}.`);
        add("Le tracce rimaste hanno reso il nuovo apprendimento più rapido del primo.");
      }
      const method = text("method");
      add(
        method === "invention"
          ? "Scoperta autonoma, resa possibile dal surplus alimentare e dalla curiosità del gruppo."
          : method === "diffusion"
            ? "Conoscenza appresa attraverso i contatti commerciali."
            : method === "conquest"
              ? "Sapere acquisito con la conquista."
              : method === "migration"
                ? "Portata da persone arrivate da un altro gruppo."
                : null,
      );
      const adoption = num("adoption");
      if (adoption !== null)
        add(`Adozione iniziale: ${fmtPct(adoption)} — servirà tempo perché entri nell'uso comune.`);
      add(metaText(m.tradeOff) ? `Contropartita: ${metaText(m.tradeOff)}.` : null);
      break;
    }
    case "settlement_founded": {
      const years = num("yearsAtLocation");
      if (years !== null) add(`Il gruppo era fermo nello stesso luogo da ${fmtInt(years)} anni.`);
      const hab = num("habitability");
      if (hab !== null) add(`Abitabilità del sito: ${fmtPct(hab)}.`);
      const population = num("population");
      if (population !== null) add(`Persone coinvolte: ${fmtInt(population)}.`);
      add(metaText(m.cause) ? `Motivo: ${metaText(m.cause)}.` : null);
      break;
    }
    case "settlement_growth": {
      const population = num("population");
      if (population !== null) add(`Abitanti al momento della crescita: ${fmtInt(population)}.`);
      const buildings = text("buildings");
      if (buildings)
        add(
          `Infrastrutture presenti: ${buildings
            .split(",")
            .map((b) => {
              const [type, count] = b.split(":");
              return `${BUILDING_LABELS[type ?? ""] ?? type} ×${count}`;
            })
            .join(", ")}.`,
        );
      break;
    }
    case "settlement_collapse": {
      const famine = num("famineYears");
      if (famine !== null && famine > 0) add(`Anni consecutivi di carestia: ${fmtInt(famine)}.`);
      if (m.epidemic === true) add("Un'epidemia aveva già ridotto la popolazione.");
      const survivors = num("survivors");
      if (survivors !== null) add(`Sopravvissuti: ${fmtInt(survivors)}.`);
      break;
    }
    case "unrest": {
      const legitimacy = num("legitimacy");
      if (legitimacy !== null) add(`Legittimità del potere: ${fmtPct(legitimacy)}.`);
      const happiness = num("happiness");
      if (happiness !== null) add(`Benessere percepito: ${fmtPct(happiness)}.`);
      const distribution = text("distribution");
      if (distribution)
        add(`Distribuzione delle risorse: ${DISTRIBUTION_LABELS[distribution] ?? distribution}.`);
      const government = text("government");
      if (government) add(`Forma di governo: ${GOVERNMENT_LABELS[government] ?? government}.`);
      break;
    }
    case "leadership": {
      if (event.subtype === "succession_crisis") {
        add(metaText(m.cause) ? `Causa: ${metaText(m.cause)}.` : null);
        const outcome = text("outcome");
        if (outcome) add(`Esito: ${outcomeLabel(outcome)}.`);
        const risk = num("risk");
        if (risk !== null) add(`Rischio calcolato al momento della successione: ${fmtPct(risk)}.`);
        const heirs = num("heirs");
        if (heirs !== null) add(`Eredi idonei: ${fmtInt(heirs)}.`);
        if (m.minorHeir === true) add("L'erede era ancora troppo giovane per regnare.");
        if (m.suddenDeath === true)
          add("Il sovrano è morto prima della vecchiaia: nulla era stato predisposto.");
        break;
      }
      if (event.subtype === "dynasty_ended") {
        const reason = text("reason");
        if (reason) add(`Fine della casa: ${dynastyEndLabel(reason)}.`);
        const rulers = num("rulers");
        if (rulers !== null) add(`Sovrani dati: ${fmtInt(rulers)}.`);
        const crises = num("crises");
        if (crises !== null && crises > 0) add(`Crisi di successione attraversate: ${fmtInt(crises)}.`);
        break;
      }
      if (event.subtype === "dynasty_restored") {
        const away = num("yearsAway");
        if (away !== null) add(`Anni lontana dal potere: ${fmtInt(away)}.`);
        add("Un discendente della casa ha ripreso il posto: la storia della casa continua.");
        break;
      }
      const outcome = text("outcome");
      if (outcome && outcome !== "peaceful") add(`Successione ${outcomeLabel(outcome)}.`);
      const succession = text("succession");
      if (succession) add(`Regola di successione in vigore: ${successionLabel(succession)}.`);
      const prestige = num("prestige");
      if (prestige !== null) add(`Prestigio personale: ${fmtPct(prestige)}.`);
      const years = num("yearsInPower");
      if (years !== null) add(`Anni al comando: ${fmtInt(years)}.`);
      add(metaText(m.cause) ? `Causa: ${metaText(m.cause)}.` : null);
      break;
    }
    case "culture": {
      const from = text("from");
      const to = text("to");
      if (from && to)
        add(`Passaggio da ${GOVERNMENT_LABELS[from] ?? from} a ${GOVERNMENT_LABELS[to] ?? to}.`);
      const population = num("population");
      if (population !== null) add(`Popolazione: ${fmtInt(population)}.`);
      break;
    }
    case "trade": {
      const volume = num("volume");
      if (volume !== null) add(`Volume scambiato: ${fmtDec(volume)}.`);
      const loss = num("transportLoss");
      if (loss !== null && loss > 0) add(`Costo del trasporto: ${fmtPct(loss)} del carico.`);
      const distance = num("distance");
      if (distance !== null) add(`Distanza fra i due gruppi: ${fmtInt(distance)} celle.`);
      if (m.road === true) add("Una strada collega i due insediamenti.");
      break;
    }
    case "migration": {
      const scarcity = num("scarcityYears");
      if (scarcity !== null && scarcity > 0) add(`Anni di scarsità alle spalle: ${fmtInt(scarcity)}.`);
      const distance = num("distance");
      if (distance !== null) add(`Distanza percorsa: ${fmtInt(distance)} celle.`);
      if (m.hostileNearby === true) add("Vicini ostili nelle immediate vicinanze.");
      const hazards = text("hazards");
      if (hazards) add(`Calamità nella zona di partenza: ${hazards.split(",").map(hazardLabel).join(", ")}.`);
      break;
    }
    default:
      break;
  }
  return lines;
}

function hazardLabel(kind: string): string {
  return CRISIS_LABELS[kind.trim()] ?? kind.trim();
}

function successionLabel(kind: string): string {
  const labels: Record<string, string> = {
    consensus: "consenso del gruppo",
    seniority: "anzianità",
    strength: "forza e prestigio",
    hereditary: "ereditaria",
    election: "elezione",
  };
  return labels[kind] ?? kind;
}

export function EventExplanation({
  event,
  detail,
}: {
  event: EventDTO;
  detail: WorldDetail;
  /** Kept for callers that still pass it; navigation now happens inside the panel. */
  onSelectCause?: (id: string) => void;
}) {
  // The panel follows the chain on its own: a cause from fifty years earlier is not on the
  // timeline page the player is looking at, so it cannot be "selected" there.
  const [focusId, setFocusId] = useState(event.id);
  const worldId = detail.world.id;
  const chain = useQuery({
    queryKey: queryKeys.causality(worldId, focusId),
    queryFn: () => api.causality(worldId, focusId),
    staleTime: Infinity,
  });
  const shown = chain.data?.event ?? event;
  const lines = causeLines(shown);
  const actors = shown.actors.filter(
    (a) => a.kind !== "person" || detail.notablePeople.some((p) => p.id === a.id),
  );
  return (
    <div className="border-line bg-raised/40 mt-2 grid gap-2 rounded-md border p-3 text-sm">
      {focusId !== event.id && (
        <button
          type="button"
          className="text-ochre justify-self-start text-xs underline-offset-4 hover:underline"
          onClick={() => setFocusId(event.id)}
        >
          ← torna a «{event.title}»
        </button>
      )}
      <p className="text-muted text-xs">
        {focusId !== event.id && (
          <>
            {fmtYear(shown.year)} — {shown.title} ·{" "}
          </>
        )}
        {EVENT_LABELS[shown.type] ?? shown.type}
        {shown.subtype ? ` · ${shown.subtype}` : ""} · {IMPORTANCE_LABELS[shown.importance]}
      </p>
      {lines.length > 0 ? (
        <ul className="grid list-disc gap-1 pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          Per questo evento il motore non ha registrato condizioni numeriche aggiuntive.
        </p>
      )}
      {actors.length > 0 && (
        <p className="text-muted text-xs">Protagonisti: {actors.map((a) => a.name).join(", ")}</p>
      )}
      {chain.isPending && <p className="text-muted text-xs">Ricostruzione della catena causale…</p>}
      {chain.data && chain.data.causes.length > 0 && (
        <div>
          <p className="text-muted text-xs">Eventi che hanno portato a questo:</p>
          <ul className="grid gap-1">
            {chain.data.causes.map(({ event: c, depth }) => (
              <li key={c.id} style={{ paddingLeft: `${(depth - 1) * 0.75}rem` }}>
                <button
                  type="button"
                  className="text-parchment hover:text-ochre text-left underline-offset-4 hover:underline"
                  onClick={() => setFocusId(c.id)}
                >
                  {depth > 1 && <span className="text-muted">↳ </span>}
                  {fmtYear(c.year)} — {c.title}
                </button>
              </li>
            ))}
          </ul>
          {chain.data.truncated && (
            <p className="text-muted mt-1 text-xs">La catena prosegue oltre: apri una causa per risalire.</p>
          )}
        </div>
      )}
      {chain.data && chain.data.consequences.length > 0 && (
        <div>
          <p className="text-muted text-xs">Che cosa ne è seguito:</p>
          <ul className="grid gap-1">
            {chain.data.consequences.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="text-parchment hover:text-ochre text-left underline-offset-4 hover:underline"
                  onClick={() => setFocusId(c.id)}
                >
                  {fmtYear(c.year)} — {c.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
