"use client";

import { Badge } from "@/components/ui/badge";
import {
  fmtInt,
  fmtYear,
  OCCUPATION_POLICY_LABELS,
  OCCUPATION_STATUS_LABELS,
  TRIBUTE_LABELS,
  VASSAL_END_LABELS,
  VASSAL_STATUS_LABELS,
} from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import type { OccupationDTO, SettlementDTO, TribeDTO, VassalageDTO, WorldDetail } from "@/lib/dto";
import { EntityLink, Meter, SubHeading } from "./stat-bits";

/**
 * Explicit political bonds of a people: its overlord, its vassals, the settlements it occupies
 * and its own settlements under occupation. Ended bonds stay listed as history.
 */
export function TribePoliticsSection({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  const { select } = useWorldUi();
  const tribeById = new Map(detail.tribes.map((t) => [t.id, t]));
  const settlementById = new Map(detail.settlements.map((s) => [s.id, s]));
  const asVassal = detail.vassalages.filter((v) => v.vassalCivilizationId === tribe.id);
  const asOverlord = detail.vassalages.filter((v) => v.overlordCivilizationId === tribe.id);
  const occupying = detail.occupations.filter((o) => o.occupyingCivilizationId === tribe.id);
  const occupied = detail.occupations.filter((o) => o.occupiedCivilizationId === tribe.id);
  if (!asVassal.length && !asOverlord.length && !occupying.length && !occupied.length) return null;

  const link = (id: string) => {
    const other = tribeById.get(id);
    return other ? (
      <EntityLink color={other.color} onClick={() => select({ kind: "tribe", id })}>
        {other.name}
      </EntityLink>
    ) : (
      id
    );
  };
  const place = (id: string | null) => {
    const s = id ? settlementById.get(id) : undefined;
    return s ? (
      <EntityLink onClick={() => select({ kind: "settlement", id: s.id })}>{s.name}</EntityLink>
    ) : (
      "—"
    );
  };

  return (
    <section aria-label="Vassallaggi e occupazioni">
      <SubHeading>Vassallaggi e occupazioni</SubHeading>
      <ul className="grid gap-3 text-sm">
        {asVassal.map((v) => (
          <VassalItem key={v.id} v={v} role="vassal">
            Vassallo di {link(v.overlordCivilizationId)}
          </VassalItem>
        ))}
        {asOverlord.map((v) => (
          <VassalItem key={v.id} v={v} role="overlord">
            Signore di {link(v.vassalCivilizationId)}
          </VassalItem>
        ))}
        {occupying.map((o) => (
          <OccupationItem key={o.id} o={o}>
            Occupa {place(o.occupiedSettlementId)} (
            {o.occupiedCivilizationId ? link(o.occupiedCivilizationId) : "—"})
          </OccupationItem>
        ))}
        {occupied.map((o) => (
          <OccupationItem key={o.id} o={o}>
            {place(o.occupiedSettlementId)} occupata da {link(o.occupyingCivilizationId)}
          </OccupationItem>
        ))}
      </ul>
    </section>
  );
}

function VassalItem({
  v,
  role,
  children,
}: {
  v: VassalageDTO;
  role: "vassal" | "overlord";
  children: React.ReactNode;
}) {
  const ended = v.diplomaticStatus === "ended";
  return (
    <li className={ended ? "text-muted grid gap-1" : "grid gap-1"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{children}</span>
        <Badge tone={v.diplomaticStatus === "rebellion" ? "war" : ended ? "neutral" : "ochre"}>
          {ended
            ? `Concluso nel ${fmtYear(v.endedYear ?? 0)} (${VASSAL_END_LABELS[v.endReason ?? ""] ?? v.endReason})`
            : `${VASSAL_STATUS_LABELS[v.diplomaticStatus]} dal ${fmtYear(v.startedYear)}`}
        </Badge>
      </div>
      {!ended && (
        <>
          <Meter label="Autonomia" value={v.autonomy} tone="water" />
          <p className="text-muted text-xs">
            {TRIBUTE_LABELS[v.tributePolicy]}: {fmtInt(v.lastTribute)} cibo l&apos;ultimo anno (
            {fmtInt(v.totalTribute)} in tutto) · obbligo militare {Math.round(v.militaryObligation * 100)}%
            {role === "overlord" ? " delle loro forze" : " delle proprie forze"}
          </p>
        </>
      )}
    </li>
  );
}

function OccupationItem({ o, children }: { o: OccupationDTO; children: React.ReactNode }) {
  const active = o.status === "active";
  return (
    <li className={active ? "grid gap-1" : "text-muted grid gap-1"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{children}</span>
        <Badge tone={active ? "war" : "neutral"}>
          {active
            ? `Dal ${fmtYear(o.startedYear)} · ${OCCUPATION_POLICY_LABELS[o.occupationPolicy]}`
            : `${OCCUPATION_STATUS_LABELS[o.status] ?? o.status} nel ${fmtYear(o.endedYear ?? 0)}`}
        </Badge>
      </div>
      {active && (
        <>
          <Meter label="Controllo" value={o.control} tone="ochre" />
          <Meter label="Resistenza" value={o.resistance} tone="war" />
          <p className="text-muted text-xs">
            Guarnigione: {fmtInt(o.upkeepPaid)} cibo pagato · prelievi {fmtInt(o.extracted)}. Occupazione, non
            annessione: gli abitanti conservano la loro identità.
          </p>
        </>
      )}
    </li>
  );
}

/** One line for the settlement panel: who occupies it, how firmly. */
export function SettlementOccupationNote({
  settlement,
  detail,
}: {
  settlement: SettlementDTO;
  detail: WorldDetail;
}) {
  const { select } = useWorldUi();
  const occ = detail.occupations.find(
    (o) => o.status === "active" && o.occupiedSettlementId === settlement.id,
  );
  if (!occ) return null;
  const occupier = detail.tribes.find((t) => t.id === occ.occupyingCivilizationId);
  return (
    <p role="note" className="border-war/40 bg-war/10 mb-3 rounded-md border px-2 py-1.5 text-xs">
      Sotto occupazione{" "}
      {occupier ? (
        <EntityLink color={occupier.color} onClick={() => select({ kind: "tribe", id: occupier.id })}>
          {occupier.name}
        </EntityLink>
      ) : (
        occ.occupyingCivilizationId
      )}{" "}
      dal {fmtYear(occ.startedYear)} · amministrazione {OCCUPATION_POLICY_LABELS[occ.occupationPolicy]} ·
      controllo {Math.round(occ.control * 100)}% · resistenza {Math.round(occ.resistance * 100)}%.
    </p>
  );
}
