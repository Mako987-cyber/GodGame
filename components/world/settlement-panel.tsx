"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SettlementDTO, WorldDetail } from "@/lib/dto";
import {
  BUILDING_LABELS,
  CRISIS_LABELS,
  RESOURCE_LABELS,
  TIER_LABELS,
  fmtDec,
  fmtInt,
  fmtPct,
  fmtYear,
  STATUS_LABELS,
} from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLink, Facts, Meter, StockList, SubHeading } from "./stat-bits";

const CONSTRUCTION_STATUS: Record<string, string> = {
  planned: "in preparazione",
  building: "in costruzione",
  paused: "in attesa di materiali",
  completed: "completato",
  abandoned: "abbandonato",
};

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
            {TIER_LABELS[s.tier] ?? `Livello ${s.level}`} (livello {s.level}), fondato nel{" "}
            {fmtYear(s.foundedYear)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={s.status === "active" ? "growth" : "war"}>{STATUS_LABELS[s.status]}</Badge>
          {s.epidemic && <Badge tone="war">{CRISIS_LABELS.epidemic}</Badge>}
        </div>
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
          ["Influenza", fmtDec(s.influence)],
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
          <SubHeading>Condizioni di vita</SubHeading>
          <div className="grid gap-1.5">
            <Meter label="Igiene" value={s.hygiene} tone={s.hygiene < 0.5 ? "war" : "water"} />
            <Meter label="Malcontento" value={s.unrest} tone="war" />
          </div>
          <SubHeading>Edifici</SubHeading>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(BUILDING_LABELS)
              .filter(([key]) => (s.buildings[key] ?? 0) > 0)
              .map(([key, label]) => (
                <li key={key} className="flex justify-between gap-2">
                  <span className="text-muted">{label}</span>
                  <span>{s.buildings[key] ?? 0}</span>
                </li>
              ))}
            {Object.values(s.buildings).every((n) => n === 0) && (
              <li className="text-muted col-span-2">Nessun edificio costruito.</li>
            )}
          </ul>
          <SubHeading>Cantiere</SubHeading>
          {s.construction ? (
            <div className="grid gap-1.5">
              <Meter
                label={BUILDING_LABELS[s.construction.type] ?? s.construction.type}
                value={s.construction.required > 0 ? s.construction.progress / s.construction.required : 0}
              />
              <p className="text-muted text-xs">
                Stato: {CONSTRUCTION_STATUS[s.construction.status] ?? s.construction.status} ·{" "}
                {fmtDec(s.construction.progress)} / {fmtDec(s.construction.required)} giornate di lavoro
              </p>
              {Object.keys(s.construction.missing).length > 0 && (
                <p className="text-war text-xs">
                  Materiali mancanti:{" "}
                  {Object.entries(s.construction.missing)
                    .map(([kind, amount]) => `${RESOURCE_LABELS[kind] ?? kind} ${fmtDec(amount)}`)
                    .join(", ")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted text-sm">Nessun lavoro in corso.</p>
          )}
          <SubHeading>Magazzino</SubHeading>
          <StockList stock={s.stock} />
          <SubHeading>Produzione dell&apos;ultimo anno</SubHeading>
          <StockList stock={s.lastProduction} />
          {s.founderId && (
            <p className="text-muted mt-3 text-xs">
              Fondato sotto la guida di{" "}
              <EntityLink onClick={() => select({ kind: "person", id: s.founderId as string })}>
                {detail.notablePeople.find((p) => p.id === s.founderId)?.name ?? "una figura dimenticata"}
              </EntityLink>
              .
            </p>
          )}
          {s.status === "active" && s.lastFoodRatio < 1 && (
            <p className="text-muted mt-2 text-xs">
              Copertura del fabbisogno: {fmtPct(s.lastFoodRatio)} — le scorte si stanno assottigliando.
            </p>
          )}
        </>
      )}
      <Button size="sm" variant="ghost" className="mt-4" onClick={() => focusOn(s.x, s.y)}>
        <MapPin /> Centra sulla mappa
      </Button>
    </div>
  );
}
