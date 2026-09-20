"use client";

import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CivilizationDTO, TribeDTO, WorldDetail } from "@/lib/dto";
import {
  CULTURE_LABELS,
  DIPLOMATIC_LABELS,
  DISTRIBUTION_LABELS,
  GOVERNMENT_LABELS,
  PHASE_LABELS,
  STABILITY_LABELS,
  TIER_LABELS,
  fmtInt,
  fmtPct,
  fmtYear,
  STATUS_LABELS,
} from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { IdentityEmblem } from "./identity-emblem";
import { TribeIdentitySection } from "./identity-section";
import { TribePoliticsSection } from "./political-bonds";
import { EntityLink, Facts, Meter, StockList, SubHeading, TraitList } from "./stat-bits";

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
            {tribe.emblemKey ? (
              <IdentityEmblem emblemKey={tribe.emblemKey} color={tribe.color} size="sm" />
            ) : (
              <span className="size-3.5 rounded-sm" style={{ background: tribe.color }} aria-hidden />
            )}
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
      <TribeIdentitySection tribe={tribe} detail={detail} />
      <SubHeading>Situazione attuale</SubHeading>
      <Facts
        items={[
          ["Popolazione", `${fmtInt(tribe.population)} (${fmtInt(tribe.children)} minori)`],
          [
            "Guida",
            tribe.leader
              ? `${tribe.leader.name}, ${tribe.leader.title}, ${tribe.leader.age} anni`
              : "Nessuna",
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
          ["Cibo prodotto (ultimo anno)", fmtInt(tribe.lastFoodProduced)],
          ["Governo", GOVERNMENT_LABELS[tribe.government] ?? tribe.government],
          ["Distribuzione", DISTRIBUTION_LABELS[tribe.distribution] ?? tribe.distribution],
          [
            "Dinastia",
            tribe.dynasty ? `${tribe.dynasty.name} (${fmtInt(tribe.dynasty.rulers)} guide)` : "Nessuna",
          ],
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
          <SubHeading>Stabilità interna</SubHeading>
          <div className="grid gap-1.5">
            <Meter label={STABILITY_LABELS.happiness!} value={tribe.stability.happiness} tone="growth" />
            <Meter label={STABILITY_LABELS.cohesion!} value={tribe.stability.cohesion} tone="growth" />
            <Meter label={STABILITY_LABELS.legitimacy!} value={tribe.stability.legitimacy} tone="ochre" />
            <Meter label={STABILITY_LABELS.order!} value={tribe.stability.order} tone="ochre" />
            <Meter label={STABILITY_LABELS.tension!} value={tribe.stability.tension} tone="war" />
            <Meter label={STABILITY_LABELS.corruption!} value={tribe.stability.corruption} tone="war" />
            <Meter label={STABILITY_LABELS.revoltRisk!} value={tribe.stability.revoltRisk} tone="war" />
          </div>
          {tribe.stability.unrestYears > 0 && (
            <p className="text-war mt-1 text-xs">
              Malcontento da {tribe.stability.unrestYears} anni consecutivi.
            </p>
          )}
          <SubHeading>Cultura</SubHeading>
          <TraitList traits={tribe.culture} labels={CULTURE_LABELS} />
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
            const adoption = tribe.techAdoption[id] ?? 1;
            return (
              <li key={id} className="flex justify-between gap-2">
                <span title={def?.description}>{def?.name ?? id}</span>
                <span className="text-muted text-xs">
                  {adoption < 0.95 ? `adozione ${fmtPct(adoption)}` : def?.effectSummary}
                </span>
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
                  {TIER_LABELS[s.tier] ?? `livello ${s.level}`}, {fmtInt(s.population)} ab.
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <TribePoliticsSection tribe={tribe} detail={detail} />
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
                <span className="flex flex-wrap gap-1">
                  <Badge tone={r.atWar ? "war" : r.allied ? "growth" : "neutral"}>
                    {DIPLOMATIC_LABELS[r.status] ?? r.status}
                  </Badge>
                  {r.atWar && <Badge tone="war">Dal {fmtYear(r.warStartYear ?? 0)}</Badge>}
                  {!r.atWar && r.phase !== "peace" && (
                    <Badge tone="war">{PHASE_LABELS[r.phase] ?? r.phase}</Badge>
                  )}
                  {r.tradeVolume > 1 && <Badge tone="water">Commercio {fmtInt(r.tradeVolume)}</Badge>}
                  <Badge>{r.distance} celle</Badge>
                </span>
              </div>
              <Meter label="Fiducia" value={r.trust} tone="growth" />
              <Meter label="Ostilità" value={r.hostility} tone="war" />
              <div className="text-muted grid gap-0.5 text-xs">
                {r.conflictMemory > 0.05 && <p>Memoria dei conflitti: {fmtPct(r.conflictMemory)}</p>}
                {r.respect > 0.05 && <p>Rispetto reciproco: {fmtPct(r.respect)}</p>}
                {r.tradeDependency > 0.05 && <p>Dipendenza commerciale: {fmtPct(r.tradeDependency)}</p>}
                <p>Distanza culturale: {fmtPct(r.culturalDistance)}</p>
                {r.battles > 0 && (
                  <p>
                    {fmtInt(r.battles)} scontri
                    {r.lastConflictYear !== null ? `, ultimo nel ${fmtYear(r.lastConflictYear)}` : ""}
                  </p>
                )}
              </div>
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
  const memberTribes = detail.tribes.filter((t) => civ.tribeIds.includes(t.id));
  const memberIds = new Set(civ.tribeIds);
  const wars = detail.relationships
    .filter((r) => r.atWar && (memberIds.has(r.aId) || memberIds.has(r.bId)))
    .map((r) => {
      const otherId = memberIds.has(r.aId) ? r.bId : r.aId;
      return {
        id: r.aId + r.bId,
        against: detail.tribes.find((t) => t.id === otherId)?.name ?? otherId,
        since: r.warStartYear,
      };
    });
  const techs = new Set(memberTribes.flatMap((t) => t.techs));
  const identity = detail.identities.find((i) => i.key === civ.identityId);
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl">
            {identity && <IdentityEmblem emblemKey={identity.emblemKey} color={civ.color} size="sm" />}
            {civ.name}
          </h2>
          <p className="text-muted text-sm">
            Stato fondato nel {fmtYear(civ.foundedYear)}
            {identity ? ` · identità: ${identity.displayName}` : ""}
          </p>
          {civ.formerNames.length > 0 && (
            <p className="text-muted text-xs">Forme precedenti: {civ.formerNames.join(" → ")}</p>
          )}
        </div>
        <Badge tone={civ.status === "active" ? "growth" : "war"}>{STATUS_LABELS[civ.status]}</Badge>
      </div>
      <Facts
        items={[
          ["Popolazione", fmtInt(civ.population)],
          ["Insediamenti", fmtInt(civ.settlementIds.length)],
          ["Tecnologie", `${techs.size} / ${detail.technologies.length}`],
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
      <SubHeading>Governo e stabilità</SubHeading>
      {memberTribes.length === 0 ? (
        <p className="text-muted text-sm">Nessuna tribù attiva.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {memberTribes.map((t) => (
            <li key={t.id} className="grid gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EntityLink color={t.color} onClick={() => select({ kind: "tribe", id: t.id })}>
                  {t.name}
                </EntityLink>
                <span className="text-muted text-xs">
                  {GOVERNMENT_LABELS[t.government] ?? t.government}
                  {t.dynasty ? ` · ${t.dynasty.name}` : ""}
                </span>
              </div>
              <Meter label="Legittimità" value={t.stability.legitimacy} tone="ochre" />
              <Meter label="Coesione" value={t.stability.cohesion} tone="growth" />
            </li>
          ))}
        </ul>
      )}
      {wars.length > 0 && (
        <>
          <SubHeading>Guerre in corso</SubHeading>
          <ul className="grid gap-1 text-sm">
            {wars.map((w) => (
              <li key={w.id} className="flex justify-between gap-2">
                <span>{w.against}</span>
                <span className="text-muted text-xs">dal {fmtYear(w.since ?? 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
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
