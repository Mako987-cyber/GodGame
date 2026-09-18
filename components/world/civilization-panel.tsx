"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CivilizationDTO, TribeDTO, WorldDetail } from "@/lib/dto";
import { fmtInt, fmtPct, fmtYear, STATUS_LABELS } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EntityLink, Facts, Meter, StockList, SubHeading } from "./stat-bits";

export function TribePanel({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  const { select, focusOn } = useWorldUi();
  const civ = detail.civilizations.find((c) => c.id === tribe.civilizationId);
  const settlements = detail.settlements.filter((s) => s.tribeId === tribe.id && s.status === "active");
  const relations = detail.relationships
    .filter((r) => r.aId === tribe.id || r.bId === tribe.id)
    .map((r) => ({ ...r, other: detail.tribes.find((t) => t.id === (r.aId === tribe.id ? r.bId : r.aId)) }))
    .filter((r) => r.other && r.other.status !== "extinct")
    .sort((a, b) => a.distance - b.distance);
  const parent = detail.tribes.find((t) => t.id === tribe.parentTribeId);
  const inProgress = detail.technologies
    .filter((t) => !tribe.techs.includes(t.id) && (tribe.techProgress[t.id] ?? 0) > 0)
    .map((t) => ({ ...t, progress: (tribe.techProgress[t.id] ?? 0) / t.cost }));

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl">
            <span className="size-3.5 rounded-sm" style={{ background: tribe.color }} aria-hidden />
            {tribe.name}
          </h2>
          <p className="text-muted text-sm">
            Tribù{" "}
            {tribe.status === "extinct"
              ? `estinta nel ${fmtYear(tribe.extinctYear ?? 0)}`
              : `attiva dal ${fmtYear(tribe.foundedYear)}`}
            {parent && <>, nata dai {parent.name}</>}
          </p>
        </div>
        <Badge tone={tribe.status === "extinct" ? "war" : tribe.status === "settled" ? "growth" : "water"}>
          {STATUS_LABELS[tribe.status]}
        </Badge>
      </div>
      <Facts
        items={[
          ["Popolazione", `${fmtInt(tribe.population)} (${fmtInt(tribe.children)} minori)`],
          ["Guida", tribe.leader ? `${tribe.leader.name}, ${tribe.leader.age} anni` : "Nessuna"],
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
          ["Cibo prodotto (ultimo anno)", fmtInt(tribe.lastFoodProduced)],
        ]}
      />
      {tribe.status !== "extinct" && (
        <>
          <SubHeading>Condizioni</SubHeading>
          <div className="grid gap-1.5">
            <Meter
              label="Cibo"
              value={tribe.lastFoodRatio}
              tone={tribe.lastFoodRatio < 0.85 ? "war" : "growth"}
            />
            <Meter label="Morale" value={tribe.morale} />
          </div>
          {tribe.scarcityYears > 0 && (
            <p className="text-war mt-1 text-xs">{tribe.scarcityYears} anni di scarsità.</p>
          )}
          {tribe.status === "nomadic" && (
            <>
              <SubHeading>Scorte della banda</SubHeading>
              <StockList stock={tribe.stock} />
            </>
          )}
        </>
      )}
      <SubHeading>Tecnologie</SubHeading>
      {tribe.techs.length === 0 && inProgress.length === 0 ? (
        <p className="text-muted text-sm">Nessuna tecnica conosciuta.</p>
      ) : (
        <ul className="grid gap-1.5 text-sm">
          {tribe.techs.map((id) => {
            const def = detail.technologies.find((t) => t.id === id);
            return (
              <li key={id} className="flex justify-between gap-2">
                <span>{def?.name ?? id}</span>
                <span className="text-muted text-xs">{def?.effectSummary}</span>
              </li>
            );
          })}
          {inProgress.map((t) => (
            <li key={t.id}>
              <Meter label={t.name} value={t.progress} tone="water" />
            </li>
          ))}
        </ul>
      )}
      {settlements.length > 0 && (
        <>
          <SubHeading>Insediamenti</SubHeading>
          <ul className="grid gap-1 text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <EntityLink onClick={() => select({ kind: "settlement", id: s.id })}>{s.name}</EntityLink>
                <span className="text-muted">
                  livello {s.level}, {fmtInt(s.population)} ab.
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <SubHeading>Relazioni</SubHeading>
      {relations.length === 0 ? (
        <p className="text-muted text-sm">Nessun contatto con altri gruppi.</p>
      ) : (
        <ul className="grid gap-3">
          {relations.map((r) => (
            <li key={r.other!.id} className="grid gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <EntityLink color={r.other!.color} onClick={() => select({ kind: "tribe", id: r.other!.id })}>
                  {r.other!.name}
                </EntityLink>
                <span className="flex gap-1">
                  {r.atWar && <Badge tone="war">In guerra dal {fmtYear(r.warStartYear ?? 0)}</Badge>}
                  {r.allied && <Badge tone="growth">Alleati</Badge>}
                  {r.tradeVolume > 1 && <Badge tone="water">Commercio {fmtInt(r.tradeVolume)}</Badge>}
                  <Badge>{r.distance} celle</Badge>
                </span>
              </div>
              <Meter label="Fiducia" value={r.trust} tone="growth" />
              <Meter label="Ostilità" value={r.hostility} tone="war" />
              {r.conflictMemory > 0.05 && (
                <p className="text-muted text-xs">Memoria dei conflitti: {fmtPct(r.conflictMemory)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {tribe.status !== "extinct" && (
        <Button size="sm" variant="ghost" className="mt-4" onClick={() => focusOn(tribe.x, tribe.y)}>
          <MapPin /> Centra sulla mappa
        </Button>
      )}
    </div>
  );
}

export function CivilizationPanel({ civ, detail }: { civ: CivilizationDTO; detail: WorldDetail }) {
  const { select } = useWorldUi();
  const capital = detail.settlements.find((s) => s.id === civ.capitalSettlementId);
  const founder = detail.tribes.find((t) => t.id === civ.founderTribeId);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-serif text-2xl">{civ.name}</h2>
          <p className="text-muted text-sm">Civiltà fondata nel {fmtYear(civ.foundedYear)}</p>
        </div>
        <Badge tone={civ.status === "active" ? "growth" : "war"}>{STATUS_LABELS[civ.status]}</Badge>
      </div>
      <Facts
        items={[
          ["Popolazione", fmtInt(civ.population)],
          ["Insediamenti", fmtInt(civ.settlementIds.length)],
          [
            "Capitale",
            capital ? (
              <EntityLink onClick={() => select({ kind: "settlement", id: capital.id })}>
                {capital.name}
              </EntityLink>
            ) : (
              "Nessuna"
            ),
          ],
          [
            "Fondatori",
            founder ? (
              <EntityLink color={founder.color} onClick={() => select({ kind: "tribe", id: founder.id })}>
                {founder.name}
              </EntityLink>
            ) : (
              "—"
            ),
          ],
        ]}
      />
      <SubHeading>Insediamenti</SubHeading>
      <ul className="grid gap-1 text-sm">
        {civ.settlementIds.map((id) => {
          const s = detail.settlements.find((x) => x.id === id);
          return s ? (
            <li key={id} className="flex justify-between">
              <EntityLink onClick={() => select({ kind: "settlement", id })}>{s.name}</EntityLink>
              <span className="text-muted">{fmtInt(s.population)} ab.</span>
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}
