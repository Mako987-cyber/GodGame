"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, queryKeys } from "@/lib/client/api";
import { TECH_CATEGORY_TITLES, TECH_METHOD_SHORT_LABELS, fmtInt, fmtYear } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import type { WorldDetail } from "@/lib/dto";
import { EntityLink, SubHeading } from "./stat-bits";

/**
 * The world's technologies, and how each one actually travelled.
 *
 * A technology in the catalogue is never shown as something "everybody has": every row says how
 * many of the living peoples hold it, who found it first and who lost it. Opening one shows its
 * whole journey — the pioneer, who took it and how, the local forms it took, the peoples that
 * forgot it — read from the database, not from the map payload.
 */
export function TechnologyAtlas({ detail }: { detail: WorldDetail }) {
  const worldId = detail.world.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const catalogue = useQuery({
    queryKey: [...queryKeys.worldTechnologies(worldId), detail.world.currentTick],
    queryFn: () => api.worldTechnologies(worldId),
    staleTime: Infinity,
  });
  const nameOf = new Map(detail.tribes.map((t) => [t.id, t.name]));

  if (catalogue.isPending) return <p className="text-muted text-sm">Caricamento del catalogo…</p>;
  if (catalogue.isError || !catalogue.data)
    return <p className="text-war text-sm">Impossibile caricare le tecnologie di questo mondo.</p>;

  const categories = [...new Set(catalogue.data.items.map((i) => i.category))];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-3">
        <p className="text-muted text-xs">
          Anno {fmtYear(catalogue.data.year)}. Una tecnica scoperta da un popolo resta sua finché non si
          diffonde: qui si vede quanti l&apos;hanno davvero.
        </p>
        {categories.map((category) => (
          <section key={category}>
            <SubHeading>{TECH_CATEGORY_TITLES[category] ?? category}</SubHeading>
            <ul className="grid gap-1">
              {catalogue.data.items
                .filter((i) => i.category === category)
                .map((item) => {
                  const share = item.civilizations === 0 ? 0 : item.holders / item.civilizations;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(openId === item.id ? null : item.id)}
                        aria-expanded={openId === item.id}
                        className={`hover:bg-raised grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded px-2 py-1 text-left text-sm ${
                          openId === item.id ? "bg-raised" : ""
                        }`}
                      >
                        <span className="truncate">{item.name}</span>
                        <span className="text-muted text-xs">
                          {item.holders === 0 ? "nessuno" : `${item.holders} di ${item.civilizations} popoli`}
                        </span>
                        <span className="bg-line col-span-2 h-1 overflow-hidden rounded-full" aria-hidden>
                          <span className="bg-ochre block h-full" style={{ width: `${share * 100}%` }} />
                        </span>
                        {(item.firstDiscoveredYear !== null || item.lostBy > 0) && (
                          <span className="text-muted col-span-2 text-xs">
                            {item.firstDiscoveredYear !== null && (
                              <>
                                prima volta nel {fmtYear(item.firstDiscoveredYear)}
                                {item.pioneerCivilizationId && (
                                  <>
                                    {" "}
                                    da {nameOf.get(item.pioneerCivilizationId) ?? item.pioneerCivilizationId}
                                  </>
                                )}
                              </>
                            )}
                            {item.lostBy > 0 && (
                              <span className="text-war">
                                {item.firstDiscoveredYear !== null ? " · " : ""}perduta da {item.lostBy}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
      <div className="content-start">
        {openId ? (
          <TechnologyJourney worldId={worldId} technologyId={openId} tick={detail.world.currentTick} />
        ) : (
          <p className="text-muted text-sm">
            Scegli una tecnologia per vedere come ha viaggiato in questo mondo.
          </p>
        )}
      </div>
    </div>
  );
}

function TechnologyJourney({
  worldId,
  technologyId,
  tick,
}: {
  worldId: string;
  technologyId: string;
  tick: number;
}) {
  const { select } = useWorldUi();
  const history = useQuery({
    queryKey: [...queryKeys.technologyHistory(worldId, technologyId), tick],
    queryFn: () => api.technologyHistory(worldId, technologyId),
    staleTime: Infinity,
  });
  if (history.isPending) return <p className="text-muted text-sm">Ricostruzione del percorso…</p>;
  if (history.isError || !history.data) return <p className="text-war text-sm">Percorso non disponibile.</p>;
  const h = history.data;
  const holders = [...h.holders].sort((a, b) => a.year - b.year);
  const localForms = [...new Set(holders.map((x) => x.localName).filter((x): x is string => Boolean(x)))];

  return (
    <div className="grid gap-3 text-sm">
      <div>
        <h3 className="font-serif text-xl">{h.definition.name}</h3>
        <p className="text-muted">{h.definition.description}</p>
        <p className="text-muted mt-1 text-xs">
          {h.definition.effectSummary}
          {h.definition.tradeOff && <> · contropartita: {h.definition.tradeOff}</>}
        </p>
      </div>
      {h.pioneer ? (
        <p>
          Scoperta per la prima volta nel {fmtYear(h.pioneer.year)} da{" "}
          <EntityLink onClick={() => select({ kind: "tribe", id: h.pioneer!.civilizationId })}>
            {h.pioneer.name}
          </EntityLink>
          {h.spreadYears !== null && h.holders.length > 1 && (
            <>; arrivata al suo ultimo popolo {fmtInt(h.spreadYears)} anni dopo</>
          )}
          .
        </p>
      ) : (
        <p className="text-muted">Nessun popolo di questo mondo l&apos;ha ancora sviluppata.</p>
      )}
      {localForms.length > 0 && <p className="text-muted text-xs">Forme locali: {localForms.join(", ")}.</p>}
      {holders.length > 0 && (
        <section>
          <SubHeading>Chi l&apos;ha avuta, e come</SubHeading>
          <ul className="grid gap-1">
            {holders.map((holder) => (
              <li key={`${holder.civilizationId}-${holder.year}`} className="flex justify-between gap-2">
                <EntityLink onClick={() => select({ kind: "tribe", id: holder.civilizationId })}>
                  {holder.name}
                </EntityLink>
                <span className="text-muted shrink-0 text-xs">
                  {fmtYear(holder.year)} · {TECH_METHOD_SHORT_LABELS[holder.method] ?? holder.method}
                  {holder.adoptionPercentage > 0
                    ? ` · in uso al ${holder.adoptionPercentage}%`
                    : " · non più in uso"}
                  {holder.localName && ` · ${holder.localName}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {h.lostBy.length > 0 && (
        <section>
          <SubHeading>Chi l&apos;ha perduta</SubHeading>
          <ul className="grid gap-1">
            {h.lostBy.map((lost) => (
              <li key={lost.civilizationId} className="flex justify-between gap-2">
                <span>{lost.name}</span>
                <span className="text-war shrink-0 text-xs">nel {fmtYear(lost.year)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {h.events.length > 0 && (
        <section>
          <SubHeading>Momenti della sua storia</SubHeading>
          <ul className="grid gap-1.5">
            {h.events.slice(0, 8).map((event) => (
              <li key={event.id} className="text-muted text-xs">
                {event.description}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => history.refetch()}>
        Aggiorna
      </Button>
    </div>
  );
}
