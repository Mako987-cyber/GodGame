"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HelpCircle, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorldDetail } from "@/lib/dto";
import { api, queryKeys } from "@/lib/client/api";
import { EVENT_LABELS, eventTone, fmtInt, fmtYear } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";
import { EventExplanation } from "./event-explanation";

const PAGE_SIZE = 20;

interface Filters {
  type: string;
  minImportance: number;
  search: string;
  fromYear: string;
  toYear: string;
  actorId: string;
}

const EMPTY: Filters = { type: "", minImportance: 2, search: "", fromYear: "", toYear: "", actorId: "" };

export function WorldTimeline({ detail, actorId }: { detail: WorldDetail; actorId?: string }) {
  const worldId = detail.world.id;
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY, actorId: actorId ?? "" }));
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const focusOn = useWorldUi((s) => s.focusOn);
  const explaining = useWorldUi((s) => s.explaining);
  const explain = useWorldUi((s) => s.explain);

  // The search box waits for the user to stop typing before hitting the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const params = {
    page,
    pageSize: PAGE_SIZE,
    type: filters.type || undefined,
    minImportance: filters.minImportance,
    search: debouncedSearch || undefined,
    fromYear: filters.fromYear ? Number(filters.fromYear) : undefined,
    toYear: filters.toYear ? Number(filters.toYear) : undefined,
    actorId: filters.actorId || undefined,
  };

  const query = useQuery({
    queryKey: [...queryKeys.events(worldId), params],
    queryFn: () => api.events(worldId, params),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const actors = [
    ...detail.tribes
      .filter((t) => t.status !== "extinct")
      .map((t) => ({ id: t.id, name: `Tribù ${t.name}` })),
    ...detail.civilizations.map((c) => ({ id: c.id, name: c.name })),
    ...detail.settlements
      .filter((s) => s.status === "active")
      .map((s) => ({ id: s.id, name: `Insediamento ${s.name}` })),
  ];
  const active =
    filters.type || filters.search || filters.fromYear || filters.toYear || filters.actorId
      ? true
      : filters.minImportance !== EMPTY.minImportance;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-muted flex items-center gap-2 text-sm">
          Tipo
          <Select
            className="h-9 w-auto"
            value={filters.type}
            onChange={(e) => update({ type: e.target.value })}
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
            value={filters.minImportance}
            onChange={(e) => update({ minImportance: Number(e.target.value) })}
          >
            <option value={1}>Tutti gli eventi</option>
            <option value={2}>Almeno locali</option>
            <option value={3}>Almeno importanti</option>
            <option value={4}>Almeno regionali</option>
            <option value={5}>Solo svolte storiche</option>
          </Select>
        </label>
        <label className="text-muted flex items-center gap-2 text-sm">
          Protagonista
          <Select
            className="h-9 w-auto max-w-48"
            value={filters.actorId}
            onChange={(e) => update({ actorId: e.target.value })}
          >
            <option value="">Tutti</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-muted flex items-center gap-2 text-sm">
          Dal
          <Input
            className="h-9 w-24"
            type="number"
            inputMode="numeric"
            value={filters.fromYear}
            onChange={(e) => update({ fromYear: e.target.value })}
            placeholder={String(detail.world.settings.startYear)}
            aria-label="Anno iniziale"
          />
        </label>
        <label className="text-muted flex items-center gap-2 text-sm">
          al
          <Input
            className="h-9 w-24"
            type="number"
            inputMode="numeric"
            value={filters.toYear}
            onChange={(e) => update({ toYear: e.target.value })}
            placeholder={String(detail.world.currentYear)}
            aria-label="Anno finale"
          />
        </label>
        <label className="text-muted flex items-center gap-2 text-sm">
          Cerca
          <Input
            className="h-9 w-44"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="parola nel testo"
            aria-label="Cerca nel testo degli eventi"
          />
        </label>
        {active && (
          <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY)}>
            <X /> Azzera filtri
          </Button>
        )}
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
          {query.data.total === 0 && !active
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
                <div className="flex flex-wrap items-center gap-1">
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-7"
                    aria-expanded={explaining === e.id}
                    onClick={() => explain(explaining === e.id ? null : e.id)}
                  >
                    <HelpCircle /> Perché è successo?
                  </Button>
                </div>
                {explaining === e.id && (
                  <EventExplanation event={e} detail={detail} onSelectCause={(id) => explain(id)} />
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
