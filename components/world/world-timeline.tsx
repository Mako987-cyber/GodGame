"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, queryKeys } from "@/lib/client/api";
import { EVENT_LABELS, eventTone, fmtInt, fmtYear } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";

const PAGE_SIZE = 20;

export function WorldTimeline({ worldId }: { worldId: string }) {
  const [type, setType] = useState("");
  const [minImportance, setMinImportance] = useState(2);
  const [page, setPage] = useState(1);
  const focusOn = useWorldUi((s) => s.focusOn);

  const query = useQuery({
    queryKey: [...queryKeys.events(worldId), { type, minImportance, page }],
    queryFn: () => api.events(worldId, { page, pageSize: PAGE_SIZE, type: type || undefined, minImportance }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <label className="text-muted flex items-center gap-2 text-sm">
          Tipo
          <Select
            className="h-9 w-auto"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tutti</option>
            {Object.entries(EVENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-muted flex items-center gap-2 text-sm">
          Importanza
          <Select
            className="h-9 w-auto"
            value={minImportance}
            onChange={(e) => {
              setMinImportance(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={1}>Tutti gli eventi</option>
            <option value={2}>Almeno 2</option>
            <option value={3}>Almeno 3</option>
            <option value={4}>Almeno 4</option>
            <option value={5}>Solo epocali</option>
          </Select>
        </label>
      </div>

      {query.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="text-war text-sm">
          Timeline non disponibile: {query.error.message}{" "}
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            Riprova
          </Button>
        </div>
      ) : query.data.items.length === 0 ? (
        <p className="text-muted text-sm">
          {query.data.total === 0 && !type
            ? "La storia è ancora da scrivere: avanza il tempo per generare eventi."
            : "Nessun evento corrisponde ai filtri scelti."}
        </p>
      ) : (
        <ol className={`grid gap-0 transition-opacity ${query.isPlaceholderData ? "opacity-60" : ""}`}>
          {query.data.items.map((e) => (
            <li
              key={e.id}
              className="border-line/60 grid grid-cols-[4.5rem_1fr] gap-3 border-b py-3 last:border-b-0"
            >
              <span className="pt-0.5 text-right font-serif text-lg leading-tight">{fmtYear(e.year)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={eventTone(e.type)}>{EVENT_LABELS[e.type] ?? e.type}</Badge>
                  <h3 className="text-parchment font-serif text-base">{e.title}</h3>
                  <span className="sr-only">importanza {e.importance} su 5</span>
                  <span aria-hidden className="text-ochre text-xs tracking-widest">
                    {"•".repeat(e.importance)}
                  </span>
                </div>
                <p className="text-muted mt-1 max-w-[72ch] font-serif text-[0.95rem] leading-relaxed">
                  {e.description.replace(/^Anno [^—]+— /, "")}
                </p>
                {e.x !== null && e.y !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 -ml-3 h-7"
                    onClick={() => focusOn(e.x as number, e.y as number)}
                  >
                    <MapPin /> Mostra sulla mappa
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {query.data && query.data.totalPages > 1 && (
        <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Pagine della timeline">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Più recenti
          </Button>
          <span className="text-muted">
            Pagina {page} di {fmtInt(query.data.totalPages)} ({fmtInt(query.data.total)} eventi)
          </span>
          <Button size="sm" disabled={page >= query.data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Più antichi
          </Button>
        </nav>
      )}
    </div>
  );
}
