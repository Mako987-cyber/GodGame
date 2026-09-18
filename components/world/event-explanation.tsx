"use client";

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
    case "tech_discovered": {
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
  causes,
  onSelectCause,
}: {
  event: EventDTO;
  detail: WorldDetail;
  causes: EventDTO[];
  onSelectCause: (id: string) => void;
}) {
  const lines = causeLines(event);
  const actors = event.actors.filter(
    (a) => a.kind !== "person" || detail.notablePeople.some((p) => p.id === a.id),
  );
  return (
    <div className="border-line bg-raised/40 mt-2 grid gap-2 rounded-md border p-3 text-sm">
      <p className="text-muted text-xs">
        {EVENT_LABELS[event.type] ?? event.type}
        {event.subtype ? ` · ${event.subtype}` : ""} · {IMPORTANCE_LABELS[event.importance]}
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
      {causes.length > 0 && (
        <div>
          <p className="text-muted text-xs">Eventi che hanno portato a questo:</p>
          <ul className="grid gap-1">
            {causes.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="text-parchment hover:text-ochre text-left underline-offset-4 hover:underline"
                  onClick={() => onSelectCause(c.id)}
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
