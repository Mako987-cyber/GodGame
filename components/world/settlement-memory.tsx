"use client";

import { Badge } from "@/components/ui/badge";
import { FOUNDING_REASON_LABELS, SPECIALIZATION_LABELS, fmtInt, fmtYear } from "@/lib/client/format";
import type { SettlementDTO, WorldDetail } from "@/lib/dto";
import { Facts, SubHeading } from "./stat-bits";

/**
 * What a place remembers about itself: why it was put there, what it became known for, the
 * largest it ever was, how many times it was emptied and refilled, and when it ruled.
 *
 * Everything here is the settlement's own compact record. The full chronicle of a place is
 * paginated by `/api/worlds/:worldId/settlements/:settlementId/history`, not carried in the map
 * payload, so a thousand-year town never bloats the world response.
 */
export function SettlementMemorySection({
  settlement,
  detail,
}: {
  settlement: SettlementDTO;
  detail: WorldDetail;
}) {
  const history = settlement.history;
  if (!history) return null;
  const capital = history.capitalPeriods.at(-1);
  const stillCapital = capital?.toYear === null;
  const founder = history.founderName;

  return (
    <>
      <SubHeading>Memoria del luogo</SubHeading>
      <Facts
        items={[
          ["Fondato nel", fmtYear(settlement.foundedYear)],
          ["Perché qui", FOUNDING_REASON_LABELS[history.foundingReason] ?? history.foundingReason],
          ...(founder ? ([["Fondatore", founder]] as [string, string][]) : []),
          ["Massimo raggiunto", `${fmtInt(history.peakPopulation)} ab. nel ${fmtYear(history.peakYear)}`],
        ]}
      />
      {history.specializations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {history.specializations.map((key) => (
            <Badge key={key} tone="water">
              {SPECIALIZATION_LABELS[key] ?? key}
            </Badge>
          ))}
        </div>
      )}
      <ul className="text-muted mt-2 grid gap-0.5 text-xs">
        {history.destructions > 0 && (
          <li>
            Svuotato {history.destructions === 1 ? "una volta" : `${history.destructions} volte`}
            {history.reconstructions > 0 && (
              <>
                , tornato a vivere{" "}
                {history.reconstructions === 1 ? "una volta" : `${history.reconstructions} volte`}
              </>
            )}
            .
          </li>
        )}
        {history.occupiedYears > 0 && <li>{history.occupiedYears} anni sotto occupazione straniera.</li>}
        {history.capitalPeriods.length > 0 && (
          <li>
            {stillCapital ? (
              <>Capitale dal {fmtYear(capital!.fromYear)}.</>
            ) : (
              <>
                {history.capitalPeriods.length === 1 ? "È stata capitale" : "È stata capitale più volte"}:{" "}
                {history.capitalPeriods
                  .map((p) => `${fmtYear(p.fromYear)}–${p.toYear === null ? "oggi" : fmtYear(p.toYear)}`)
                  .join(", ")}
                .
              </>
            )}
          </li>
        )}
      </ul>
      <TechnologiesInUse settlement={settlement} detail={detail} />
    </>
  );
}

/** Technologies the people holding this place actually uses, not everything it has heard of. */
function TechnologiesInUse({ settlement, detail }: { settlement: SettlementDTO; detail: WorldDetail }) {
  const tribe = detail.tribes.find((t) => t.id === settlement.tribeId);
  if (!tribe) return null;
  const inUse = tribe.techs
    .map((id) => ({
      id,
      name: detail.technologies.find((t) => t.id === id)?.name ?? id,
      adoption: tribe.techAdoption[id] ?? 1,
    }))
    .filter((t) => t.adoption >= 0.5)
    .sort((a, b) => b.adoption - a.adoption)
    .slice(0, 6);
  if (inUse.length === 0) return null;
  return (
    <p className="text-muted mt-2 text-xs">
      In uso qui: {inUse.map((t) => t.name.toLowerCase()).join(", ")}.
    </p>
  );
}
