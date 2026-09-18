"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SettlementDTO, WorldDetail } from "@/lib/dto";
import { BUILDING_LABELS, fmtDec, fmtInt, fmtYear, STATUS_LABELS } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLink, Facts, Meter, StockList, SubHeading } from "./stat-bits";

export function SettlementPanel({
  settlement: s,
  detail,
}: {
  settlement: SettlementDTO;
  detail: WorldDetail;
}) {
  const { select, focusOn } = useWorldUi();
  const tribe = detail.tribes.find((t) => t.id === s.tribeId);
  const civ = detail.civilizations.find((c) => c.id === s.civilizationId);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">{s.name}</h2>
          <p className="text-muted text-sm">
            Insediamento di livello {s.level}, fondato nel {fmtYear(s.foundedYear)}
          </p>
        </div>
        <Badge tone={s.status === "active" ? "growth" : "war"}>{STATUS_LABELS[s.status]}</Badge>
      </div>
      <Facts
        items={[
          ["Popolazione", fmtInt(s.population)],
          ["Difesa", `×${fmtDec(s.defense)}`],
          [
            "Tribù",
            tribe ? (
              <EntityLink color={tribe.color} onClick={() => select({ kind: "tribe", id: tribe.id })}>
                {tribe.name}
              </EntityLink>
            ) : (
              "—"
            ),
          ],
          [
            "Civiltà",
            civ ? (
              <EntityLink color={civ.color} onClick={() => select({ kind: "civilization", id: civ.id })}>
                {civ.name}
              </EntityLink>
            ) : (
              "Nessuna"
            ),
          ],
          ["Territorio", `raggio ${s.territoryRadius} celle`],
          ["Posizione", `${s.x}, ${s.y}`],
        ]}
      />
      {s.status === "abandoned" && s.abandonedYear !== null && (
        <p className="text-war mt-3 text-sm">Abbandonato nel {fmtYear(s.abandonedYear)}.</p>
      )}
      {s.status === "active" && (
        <>
          <SubHeading>Alimentazione</SubHeading>
          <Meter
            label="Fabbisogno coperto"
            value={s.lastFoodRatio}
            tone={s.lastFoodRatio < 0.8 ? "war" : "growth"}
          />
          {s.famineYears > 0 && (
            <p className="text-war mt-1 text-xs">{s.famineYears} anni consecutivi di carestia.</p>
          )}
          <SubHeading>Edifici</SubHeading>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(BUILDING_LABELS).map(([key, label]) => (
              <li key={key} className="flex justify-between gap-2">
                <span className="text-muted">{label}</span>
                <span>{s.buildings[key] ?? 0}</span>
              </li>
            ))}
          </ul>
          {s.construction && (
            <div className="mt-3">
              <Meter
                label={`Cantiere: ${BUILDING_LABELS[s.construction.type]?.toLowerCase() ?? s.construction.type}`}
                value={s.construction.progress / s.construction.required}
              />
            </div>
          )}
          <SubHeading>Magazzino</SubHeading>
          <StockList stock={s.stock} />
          <SubHeading>Produzione dell&apos;ultimo anno</SubHeading>
          <StockList stock={s.lastProduction} />
        </>
      )}
      <Button size="sm" variant="ghost" className="mt-4" onClick={() => focusOn(s.x, s.y)}>
        <MapPin /> Centra sulla mappa
      </Button>
    </div>
  );
}
