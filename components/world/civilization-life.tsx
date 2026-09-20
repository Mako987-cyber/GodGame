"use client";

import { Badge } from "@/components/ui/badge";
import {
  AGREEMENT_STATUS_LABELS,
  CULTURE_LABELS,
  DYNASTY_STATUS_LABELS,
  REPUTATION_LABELS,
  RESILIENCE_LABELS,
  SUCCESSION_LAW_LABELS,
  fmtYear,
} from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import type { TribeDTO, WorldDetail } from "@/lib/dto";
import { EntityLink, Facts, Meter, SubHeading } from "./stat-bits";

/**
 * What makes one people recognisable from another: the house that rules it, what it believes,
 * how well it would take a blow, what it is known for, and how its character has shifted.
 *
 * Everything shown here is read from data the engine produced. Nothing is invented for display,
 * and anything a people does not have is simply not shown.
 */

/** The ruling house, with the law it follows and the record it has built. */
export function DynastySection({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  // Houses that ruled this people, current one first, then the ones that ended, newest first.
  const houses = detail.dynasties
    .filter((d) => d.tribeId === tribe.id)
    .sort((a, b) => {
      if (a.endedYear === null && b.endedYear !== null) return -1;
      if (b.endedYear === null && a.endedYear !== null) return 1;
      return (b.endedYear ?? 0) - (a.endedYear ?? 0);
    });
  if (houses.length === 0) return null;
  const current = houses.find((d) => d.endedYear === null);
  const past = houses.filter((d) => d !== current);

  return (
    <>
      <SubHeading>Dinastia</SubHeading>
      {current ? (
        <div className="grid gap-2">
          <Facts
            items={[
              ["Casa regnante", current.name],
              ["Successione", SUCCESSION_LAW_LABELS[current.successionLaw] ?? current.successionLaw],
              ["Dal", fmtYear(current.foundedYear)],
              ["Sovrani", `${current.rulers}`],
            ]}
          />
          <Meter label="Legittimità" value={current.legitimacy} tone="ochre" />
          <Meter label="Prestigio" value={current.prestige} tone="growth" />
          {current.crises > 0 && (
            <p className="text-war text-xs">
              {current.crises === 1
                ? "Una crisi di successione superata."
                : `${current.crises} crisi di successione superate.`}
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted text-sm">Nessuna casa regnante al momento.</p>
      )}
      {past.length > 0 && (
        <ul className="mt-2 grid gap-1 text-sm">
          {past.map((house) => (
            <li key={house.id} className="flex justify-between gap-2">
              <span className="truncate">{house.name}</span>
              <span className="text-muted shrink-0 text-xs">
                {fmtYear(house.foundedYear)}–{fmtYear(house.endedYear ?? 0)},{" "}
                {DYNASTY_STATUS_LABELS[house.status] ?? house.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What the people believes, how firmly, and where that belief came from. */
export function BeliefSection({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  const belief = detail.beliefs.find((b) => b.followerTribeIds.includes(tribe.id));
  if (!belief) return null;
  const parents = belief.parentBeliefIds
    .map((id) => detail.beliefs.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  const others = belief.followerTribeIds
    .filter((id) => id !== tribe.id)
    .map((id) => detail.tribes.find((t) => t.id === id))
    .filter((t): t is TribeDTO => Boolean(t));

  return (
    <>
      <SubHeading>Credenze</SubHeading>
      <div className="grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{belief.name}</p>
            <p className="text-muted text-xs">
              {belief.typeLabel}, dal {fmtYear(belief.createdYear)}
            </p>
          </div>
          {parents.length > 0 && <Badge tone="water">sincretica</Badge>}
        </div>
        <Meter label="Adesione" value={tribe.beliefAdherence} tone="growth" />
        <Meter label="Autorità" value={belief.authority} tone="ochre" />
        <Meter label="Tolleranza" value={belief.tolerance} tone="water" />
        {belief.principles.length > 0 && (
          <ul className="text-muted grid gap-0.5 text-xs italic">
            {belief.principles.slice(0, 3).map((principle) => (
              <li key={principle}>«{principle}»</li>
            ))}
          </ul>
        )}
        {parents.length > 0 && (
          <p className="text-muted text-xs">
            Nata dall&apos;incontro di {parents.map((p) => p.name).join(" e ")}.
          </p>
        )}
        {others.length > 0 && (
          <p className="text-muted text-xs">Condivisa con {others.map((t) => t.name).join(", ")}.</p>
        )}
      </div>
    </>
  );
}

/** How well this people would take a blow, and what it is made of. */
export function ResilienceSection({ tribe }: { tribe: TribeDTO }) {
  const profile = tribe.resilience;
  if (!profile) return null;
  const rows: [keyof typeof RESILIENCE_LABELS, "ochre" | "growth" | "water"][] = [
    ["foodResilience", "growth"],
    ["economicDiversity", "ochre"],
    ["administrativeCapacity", "ochre"],
    ["socialCohesion", "growth"],
    ["infrastructureQuality", "water"],
    ["migrationCapacity", "water"],
    ["healthCapacity", "growth"],
    ["recoverySpeed", "ochre"],
  ];
  return (
    <>
      <SubHeading>Resilienza</SubHeading>
      <div className="grid gap-1.5">
        {rows.map(([key, tone]) => (
          <Meter key={key} label={RESILIENCE_LABELS[key]} value={profile[key]} tone={tone} />
        ))}
      </div>
    </>
  );
}

/** What this people is known for, and the pacts it currently holds. */
export function DiplomacySection({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  const { select } = useWorldUi();
  const reputation = detail.reputations.find((r) => r.civilizationId === tribe.id);
  const pacts = detail.agreements
    .filter((a) => a.firstCivilizationId === tribe.id || a.secondCivilizationId === tribe.id)
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return b.startedYear - a.startedYear;
    });
  if (!reputation && pacts.length === 0) return null;
  const active = pacts.filter((a) => a.status === "active");
  const ended = pacts.filter((a) => a.status !== "active").slice(0, 5);

  return (
    <>
      <SubHeading>Reputazione e accordi</SubHeading>
      {reputation && (
        <div className="grid gap-1.5">
          <Meter label={REPUTATION_LABELS.treatyRespect} value={reputation.treatyRespect} tone="growth" />
          <Meter label={REPUTATION_LABELS.reliability} value={reputation.reliability} tone="growth" />
          <Meter
            label={REPUTATION_LABELS.tradeReliability}
            value={reputation.tradeReliability}
            tone="water"
          />
          <Meter label={REPUTATION_LABELS.aggression} value={reputation.aggression} tone="war" />
          <Meter label={REPUTATION_LABELS.threatLevel} value={reputation.threatLevel} tone="war" />
          {reputation.agreementsBroken > 0 && (
            <p className="text-war text-xs">
              {reputation.agreementsBroken} patti rotti su {reputation.agreementsSigned} firmati.
            </p>
          )}
        </div>
      )}
      {active.length > 0 && (
        <ul className="mt-2 grid gap-1 text-sm">
          {active.map((pact) => {
            const otherId =
              pact.firstCivilizationId === tribe.id ? pact.secondCivilizationId : pact.firstCivilizationId;
            const other = detail.tribes.find((t) => t.id === otherId);
            return (
              <li key={pact.id} className="flex justify-between gap-2">
                <span className="truncate">{pact.typeLabel}</span>
                <span className="text-muted shrink-0 text-xs">
                  {other ? (
                    <EntityLink onClick={() => select({ kind: "tribe", id: other.id })}>
                      {other.name}
                    </EntityLink>
                  ) : (
                    otherId
                  )}
                  {pact.expiresAtYear !== null && <> · fino al {fmtYear(pact.expiresAtYear)}</>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {ended.length > 0 && (
        <ul className="text-muted mt-1 grid gap-0.5 text-xs">
          {ended.map((pact) => (
            <li key={pact.id}>
              {pact.typeLabel}: {AGREEMENT_STATUS_LABELS[pact.status] ?? pact.status}
              {pact.endedYear !== null && <> nel {fmtYear(pact.endedYear)}</>}
              {pact.lastViolatorId === tribe.id && <span className="text-war"> (per mano loro)</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** How the people's character has actually shifted, and what moved it. */
export function CultureHistorySection({ tribe }: { tribe: TribeDTO }) {
  const shifts = [...tribe.cultureHistory].reverse().slice(0, 8);
  if (shifts.length === 0) return null;
  return (
    <>
      <SubHeading>Come è cambiata</SubHeading>
      <ul className="grid gap-1 text-sm">
        {shifts.map((shift, i) => {
          const rising = shift.newValue > shift.previousValue;
          return (
            <li key={`${shift.tick}-${shift.trait}-${i}`} className="flex justify-between gap-2">
              <span className="truncate" title={shift.reason}>
                {CULTURE_LABELS[shift.trait] ?? shift.trait}{" "}
                <span className={rising ? "text-growth" : "text-war"}>
                  {rising ? "↑" : "↓"} {Math.round(Math.abs(shift.newValue - shift.previousValue))}
                </span>
              </span>
              <span className="text-muted shrink-0 text-xs">{fmtYear(shift.year)}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
