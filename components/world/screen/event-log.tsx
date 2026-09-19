"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Biohazard,
  ChevronDown,
  ChevronUp,
  Crown,
  Handshake,
  Lightbulb,
  Skull,
  Swords,
  Tent,
  Wheat,
  ScrollText,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { EventDTO, WorldDetail } from "@/lib/dto";
import { api, queryKeys } from "@/lib/client/api";
import { fmtYear } from "@/lib/client/format";
import {
  buildNotifications,
  filterNotifications,
  NOTIFICATION_LABELS,
  type GameNotification,
  type NotificationCategory,
} from "@/lib/client/notifications";
import { useWorldUi } from "@/lib/client/store";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<NotificationCategory, ReactNode> = {
  founding: <Tent />,
  discovery: <Lightbulb />,
  famine: <Wheat />,
  war: <Swords />,
  peace: <Handshake />,
  leader: <Crown />,
  unrest: <AlertTriangle />,
  epidemic: <Biohazard />,
  collapse: <Skull />,
};

const TONE: Record<NotificationCategory, string> = {
  founding: "text-growth",
  discovery: "text-ochre",
  famine: "text-war",
  war: "text-war",
  peace: "text-water",
  leader: "text-ochre",
  unrest: "text-war",
  epidemic: "text-war",
  collapse: "text-war",
};

const TYPES =
  "settlement_founded,civilization_founded,civilization_transformed,tech_discovered,famine,conflict,battle,conquest,peace,alliance,notable_death,leadership,unrest,epidemic,settlement_collapse,tribe_extinct";

/** Notifications of the world: server events plus the ones returned by the last advance. */
export function useNotifications(worldId: string, recent: EventDTO[]) {
  const query = useQuery({
    queryKey: [...queryKeys.events(worldId), "notifications"],
    queryFn: () => api.events(worldId, { page: 1, pageSize: 60, type: TYPES, minImportance: 2 }),
    staleTime: 10_000,
  });
  const items = useMemo(
    () => buildNotifications([...recent, ...(query.data?.items ?? [])]),
    [recent, query.data],
  );
  return { items, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

function Row({ n, onOpen }: { n: GameNotification; onOpen: (n: GameNotification) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="hover:bg-raised flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm"
        title={n.description}
      >
        <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", TONE[n.category])} aria-hidden>
          {ICONS[n.category]}
        </span>
        <span className="min-w-0 grow">
          <span className="text-parchment block truncate">
            {n.title}
            {n.count > 1 && <span className="text-muted"> ×{n.count}</span>}
          </span>
          <span className="text-muted block truncate text-xs">{n.description}</span>
        </span>
        <span className="text-muted shrink-0 text-xs tabular-nums">{fmtYear(n.year)}</span>
      </button>
    </li>
  );
}

/**
 * Bottom bar: the latest notable event as a ticker; expanded, the filterable list of
 * notifications. Clicking one selects its entity and centres the map on it.
 */
export function EventLog({
  detail,
  notifications,
  isLoading,
  isError,
  onRetry,
  status,
}: {
  detail: WorldDetail;
  notifications: GameNotification[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Progress / result / error message of the last simulation request. */
  status: ReactNode;
}) {
  const { eventLogOpen: open, setEventLogOpen, select, focusOn, togglePanel } = useWorldUi();
  const [hidden, setHidden] = useState<Set<NotificationCategory>>(new Set());
  const visible = filterNotifications(notifications, hidden);
  const latest = visible[0];
  const categories = [...new Set(notifications.map((n) => n.category))];

  const openNotification = (n: GameNotification) => {
    if (n.target) select(n.target);
    const cell =
      n.cell ??
      (n.target?.kind === "settlement"
        ? (() => {
            const s = detail.settlements.find((x) => x.id === (n.target as { id: string }).id);
            return s ? { x: s.x, y: s.y } : null;
          })()
        : null);
    if (cell) focusOn(cell.x, cell.y, Boolean(n.target));
  };

  return (
    <section
      aria-label="Eventi e notifiche"
      className="hud-glass pointer-events-auto flex max-h-[45dvh] flex-col overflow-hidden rounded-xl"
    >
      {open && (
        <div className="border-line/70 flex min-h-0 flex-col border-b">
          <div className="flex flex-wrap gap-1 px-2 pt-2" role="group" aria-label="Filtra per categoria">
            {categories.map((c) => {
              const on = !hidden.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (on) next.add(c);
                      else next.delete(c);
                      return next;
                    })
                  }
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full border px-2 text-xs [&_svg]:size-3.5",
                    on
                      ? "border-line bg-raised text-parchment"
                      : "text-muted border-transparent line-through",
                  )}
                >
                  <span className={TONE[c]} aria-hidden>
                    {ICONS[c]}
                  </span>
                  {NOTIFICATION_LABELS[c]}
                </button>
              );
            })}
          </div>
          <ul className="min-h-0 overflow-y-auto p-1.5" aria-live="polite">
            {isError ? (
              <li className="text-war px-2 py-2 text-sm" role="alert">
                Notifiche non disponibili.{" "}
                <button type="button" className="underline" onClick={onRetry}>
                  Riprova
                </button>
              </li>
            ) : isLoading ? (
              <li className="text-muted px-2 py-2 text-sm">Caricamento…</li>
            ) : visible.length === 0 ? (
              <li className="text-muted px-2 py-2 text-sm">
                Nessun evento importante {hidden.size ? "con questi filtri" : "per ora"}.
              </li>
            ) : (
              visible.map((n) => <Row key={n.id} n={n} onOpen={openNotification} />)
            )}
          </ul>
        </div>
      )}
      <div className="flex min-h-11 items-center gap-2 px-2">
        <button
          type="button"
          onClick={() => setEventLogOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Comprimi le notifiche" : "Espandi le notifiche"}
          className="text-muted hover:text-parchment hover:bg-raised grid size-8 shrink-0 place-items-center rounded-md"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
        <div className="min-w-0 grow text-sm">
          {status ? (
            <div className="text-muted truncate" aria-live="polite">
              {status}
            </div>
          ) : latest ? (
            <button
              type="button"
              onClick={() => openNotification(latest)}
              className="flex w-full min-w-0 items-center gap-2 text-left"
            >
              <span className={cn("shrink-0 [&_svg]:size-4", TONE[latest.category])} aria-hidden>
                {ICONS[latest.category]}
              </span>
              <span className="text-parchment truncate">{latest.title}</span>
              <span className="text-muted shrink-0 text-xs tabular-nums">{fmtYear(latest.year)}</span>
            </button>
          ) : (
            <span className="text-muted">
              Nessun evento importante: avanza il tempo per far iniziare la storia.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => togglePanel("chronicle")}
          className="text-muted hover:text-parchment hover:bg-raised flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs"
          aria-label="Apri la cronaca completa"
        >
          <ScrollText className="size-4" aria-hidden />
          <span className="hidden md:inline">Cronaca</span>
        </button>
        <button
          type="button"
          onClick={() => togglePanel("stats")}
          className="text-muted hover:text-parchment hover:bg-raised flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs"
          aria-label="Apri le statistiche"
        >
          <BarChart3 className="size-4" aria-hidden />
          <span className="hidden md:inline">Statistiche</span>
        </button>
      </div>
    </section>
  );
}
