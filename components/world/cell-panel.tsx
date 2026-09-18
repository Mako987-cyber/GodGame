"use client";

import type { WorldDetail } from "@/lib/dto";
import { BIOME_LABELS, CRISIS_LABELS, fmtDec, fmtInt, fmtPct } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLink, Facts, Meter, SubHeading } from "./stat-bits";

export function CellPanel({ x, y, detail }: { x: number; y: number; detail: WorldDetail }) {
  const { select } = useWorldUi();
  const m = detail.map;
  const i = y * detail.world.width + x;
  const owner = detail.tribes[m.owner[i] ?? -1];
  const settlement = detail.settlements[m.settlement[i] ?? -1];
  const at = (arr: number[]) => arr[i] ?? 0;
  // Hazards are world-level: a cell shows the ones whose radius covers it.
  const hazards = detail.world.climate.hazards.filter(
    (h) => Math.max(Math.abs(h.x - x), Math.abs(h.y - y)) <= h.radius,
  );
  return (
    <div>
      <h2 className="font-serif text-2xl">{BIOME_LABELS[at(m.biome)]}</h2>
      <p className="text-muted mb-3 text-sm">
        Cella {x}, {y}
        {m.riverNames[i] && <>, sul fiume {m.riverNames[i]}</>}
        {at(m.coastal) === 1 && ", affacciata sul mare"}
      </p>
      <div className="grid gap-1.5">
        <Meter label="Abitabilità" value={at(m.habitability)} tone="growth" />
        <Meter label="Fertilità" value={at(m.fertility)} tone="growth" />
        <Meter label="Acqua" value={at(m.water)} tone="water" />
        <Meter label="Fauna" value={at(m.maxFauna) ? at(m.fauna) / at(m.maxFauna) : 0} />
      </div>
      <SubHeading>Risorse</SubHeading>
      <Facts
        items={[
          ["Cibo naturale", `${fmtDec(at(m.fauna))} / ${fmtInt(at(m.maxFauna))}`],
          ["Legname", fmtDec(at(m.wood))],
          ["Pietra", fmtInt(at(m.stone))],
          ["Rame", at(m.copper) > 0 ? fmtInt(at(m.copper)) : "Assente"],
          ["Stagno", at(m.tin) > 0 ? fmtInt(at(m.tin)) : "Assente"],
          ["Ferro", at(m.iron) > 0 ? fmtInt(at(m.iron)) : "Assente"],
          ["Carbone", at(m.coal) > 0 ? fmtInt(at(m.coal)) : "Assente"],
          ["Argilla", at(m.clay) > 0 ? fmtInt(at(m.clay)) : "Assente"],
          ["Campi coltivati", fmtInt(at(m.fields))],
          ["Pascoli", fmtInt(at(m.pastures))],
        ]}
      />
      <SubHeading>Clima e rilievo</SubHeading>
      <Facts
        items={[
          ["Altitudine", fmtPct(at(m.altitude))],
          ["Temperatura", fmtPct(at(m.temperature))],
          ["Umidità", fmtPct(at(m.moisture))],
          ["Strada", at(m.road) ? "Sì" : "No"],
        ]}
      />
      {hazards.length > 0 && (
        <p className="text-war mt-2 text-sm">
          Calamità in corso: {hazards.map((h) => CRISIS_LABELS[h.kind] ?? h.kind).join(", ")}.
        </p>
      )}
      <SubHeading>Controllo</SubHeading>
      <Facts
        items={[
          [
            "Territorio di",
            owner ? (
              <EntityLink color={owner.color} onClick={() => select({ kind: "tribe", id: owner.id })}>
                {owner.name}
              </EntityLink>
            ) : (
              "Nessuno"
            ),
          ],
          [
            "Insediamento",
            settlement ? (
              <EntityLink onClick={() => select({ kind: "settlement", id: settlement.id })}>
                {settlement.name}
              </EntityLink>
            ) : (
              "Nessuno"
            ),
          ],
          ["Abitanti qui", fmtInt(at(m.population))],
        ]}
      />
    </div>
  );
}
