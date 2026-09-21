"use client";

import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/client/api";
import { KNOWLEDGE_SOURCE_LABELS, fmtInt, fmtPct, fmtYear } from "@/lib/client/format";
import type { TribeDTO, WorldDetail } from "@/lib/dto";
import { SubHeading } from "./stat-bits";

/**
 * What this people believes about the others — its estimates, not the truth. Fetched on demand:
 * knowledge grows with the square of the number of peoples and does not belong in the map
 * payload. Every figure shows how sure the people is and where the information came from, so a
 * confident mistake reads as what it is.
 */
export function KnowledgeSection({ tribe, detail }: { tribe: TribeDTO; detail: WorldDetail }) {
  const worldId = detail.world.id;
  const query = useQuery({
    queryKey: [...queryKeys.knowledge(worldId, tribe.id), detail.world.currentTick],
    queryFn: () => api.knowledge(worldId, tribe.id),
    enabled: tribe.status !== "extinct",
    staleTime: Infinity,
  });
  if (tribe.status === "extinct") return null;
  const items = (query.data?.items ?? [])
    .filter((i) => i.population || i.military || i.intent || i.technologies)
    .sort((a, b) => a.staleness - b.staleness)
    .slice(0, 8);

  return (
    <>
      <SubHeading>Cosa sa degli altri</SubHeading>
      {query.isPending ? (
        <p className="text-muted text-sm">Raccolta delle informazioni…</p>
      ) : query.isError ? (
        <p className="text-war text-sm">Impossibile caricare le informazioni.</p>
      ) : items.length === 0 ? (
        <p className="text-muted text-sm">Non ha ancora notizie certe di nessun altro popolo.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {items.map((item) => (
            <li key={item.targetId} className="grid gap-0.5">
              <div className="flex justify-between gap-2">
                <span className="truncate">{item.targetName}</span>
                <span className="text-muted shrink-0 text-xs">
                  {item.staleness === 0 ? "notizie di quest'anno" : `notizie di ${item.staleness} anni fa`}
                </span>
              </div>
              <p className="text-muted text-xs">
                {[
                  item.population &&
                    `circa ${fmtInt(item.population.value)} persone (${fmtPct(item.population.confidence)}, ${
                      KNOWLEDGE_SOURCE_LABELS[item.population.source] ?? item.population.source
                    })`,
                  item.military &&
                    `forza stimata ${fmtInt(item.military.value)} (${fmtPct(item.military.confidence)}, ${
                      KNOWLEDGE_SOURCE_LABELS[item.military.source] ?? item.military.source
                    })`,
                  item.intent &&
                    (item.intent.hostile ? "ritenuti ostili" : "ritenuti pacifici") +
                      ` (${fmtPct(item.intent.confidence)})`,
                  item.technologies && `${item.technologies.ids.length} tecniche viste in uso`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {item.spyAttempts > 0 && (
                <p className="text-muted text-xs">
                  {item.spyAttempts === 1 ? "Una missione di spie" : `${item.spyAttempts} missioni di spie`}
                  {item.spiesCaught > 0 && <span className="text-war">, {item.spiesCaught} scoperte</span>}
                  {item.lastSeen && <> · ultima posizione nota nel {fmtYear(item.lastSeen.year)}</>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
