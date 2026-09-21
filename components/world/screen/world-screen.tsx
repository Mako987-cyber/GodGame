"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { SimulateResponse, WorldDetail } from "@/lib/dto";
import { api, ApiError, queryKeys } from "@/lib/client/api";
import { fmtInt, fmtYear } from "@/lib/client/format";
import { unreadCount } from "@/lib/client/notifications";
import { SPEEDS, useWorldUi } from "@/lib/client/store";
import { DeleteWorldDialog } from "../delete-world-dialog";
import { MINIMAP_SIZES } from "../map/minimap";
import { WorldMapContainer } from "../map/world-map-container";
import { WorldStatistics } from "../world-statistics";
import { WorldTimeline } from "../world-timeline";
import { EventLog, useNotifications } from "./event-log";
import { OverviewPanel } from "./overview-panel";
import { TechnologyAtlas } from "../technology-atlas";
import { placeOfSelection, SelectionPanel } from "./selection-panel";
import { SpeedControls, type Step } from "./speed-controls";
import { TopHud } from "./top-hud";
import { WorldInfoDialog } from "./world-info-dialog";
import { WorldMenu } from "./world-menu";

/**
 * The world screen: a full-viewport map with the HUD, toolbar, panels, minimap and event log
 * floating over it. Nothing here shrinks the map; every panel can be closed.
 */
export function WorldScreen({ initial }: { initial: WorldDetail }) {
  const worldId = initial.world.id;
  const queryClient = useQueryClient();
  const ui = useWorldUi();
  const { reset, speed, setSpeed, markSeen } = ui;
  const [lastRun, setLastRun] = useState<SimulateResponse | null>(null);
  const [showRun, setShowRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"delete" | "info" | "snapshot" | null>(null);

  useEffect(() => reset, [reset]);

  const world = useQuery({
    queryKey: queryKeys.world(worldId),
    queryFn: () => api.getWorld(worldId),
    initialData: initial,
    // A world deleted elsewhere must not be retried forever.
    retry: (count, e) => !(e instanceof ApiError && e.code === "NOT_FOUND") && count < 2,
  });
  const detail = world.data;
  const running = detail.world.status === "running";
  const tick = detail.world.currentTick;

  // Notifications that existed before opening the world are not "new".
  useEffect(() => markSeen(initial.world.currentTick), [initial.world.currentTick, markSeen]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events(worldId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats(worldId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.worlds }),
    ]);
  }, [queryClient, worldId]);

  const simulate = useMutation({
    mutationFn: (ticks: number) => api.simulate(worldId, ticks),
    onSuccess: async (run) => {
      setLastRun(run);
      setShowRun(true);
      setError(null);
      await refreshAll();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === "SIMULATION_IN_PROGRESS"
          ? "Un'altra simulazione è in corso su questo mondo: attendi qualche secondo."
          : e.message,
      ),
  });

  const status = useMutation({
    mutationFn: (next: "running" | "paused") => api.setStatus(worldId, next),
    onSuccess: (updated) => {
      queryClient.setQueryData<WorldDetail>(queryKeys.world(worldId), (old) =>
        old ? { ...old, world: { ...old.world, status: updated.status } } : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
    },
    onError: (e) => setError(e.message),
  });

  // Auto-run lives in the browser: the server only ever executes one bounded batch per request.
  const runBatch = simulate.mutateAsync;
  const changeStatus = status.mutate;
  useEffect(() => {
    if (!running) return;
    const { ticks, pauseMs } = SPEEDS[speed];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = async () => {
      if (cancelled) return;
      try {
        await runBatch(ticks);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "SIMULATION_IN_PROGRESS")) {
          changeStatus("paused");
          return;
        }
      }
      if (!cancelled) timer = setTimeout(step, pauseMs);
    };
    void step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, speed, runBatch, changeStatus]);

  // The result line of the last batch fades back to the event ticker after a few seconds.
  useEffect(() => {
    if (!showRun || running) return;
    const t = setTimeout(() => setShowRun(false), 7000);
    return () => clearTimeout(t);
  }, [showRun, running, lastRun]);

  const recent = useMemo(() => lastRun?.events ?? [], [lastRun]);
  const notifications = useNotifications(worldId, recent);
  const unread = unreadCount(notifications.items, ui.seenTick);
  useEffect(() => {
    if (ui.eventLogOpen) markSeen(tick);
  }, [ui.eventLogOpen, tick, markSeen]);

  // A click on a place in the chronicle moves the map: the modal steps aside.
  const focusNonce = ui.focus?.nonce;
  const { panel, closePanel } = ui;
  useEffect(() => {
    if (focusNonce && (panel === "chronicle" || panel === "stats" || panel === "technologies")) closePanel();
    // Only a new focus request closes the panel, not opening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const place = placeOfSelection(detail, ui.selection);

  // Esc on the map: close the open side panel first, then clear the selection. Dialogs and menus
  // handle their own Esc (they stop it before it gets here).
  const { select } = ui;
  const selected = Boolean(ui.selection);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, dialog, [role=menu]")) return;
      if (panel === "overview" || panel === "layers" || panel === "legend") closePanel();
      else if (selected) select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel, selected, select]);

  const statusLine = simulate.isPending ? (
    "Simulazione in corso…"
  ) : error ? (
    <span role="alert" className="text-war">
      {error}
    </span>
  ) : showRun && lastRun ? (
    <>
      {lastRun.ticksRun} {lastRun.ticksRun === 1 ? "anno simulato" : "anni simulati"} fino al{" "}
      {fmtYear(lastRun.year)}: {fmtInt(lastRun.metrics.births)} nascite, {fmtInt(lastRun.metrics.deaths)}{" "}
      morti, {fmtInt(lastRun.eventsTotal)} eventi
      {lastRun.partial && <span className="text-ochre"> (batch interrotto per limite di tempo)</span>}
    </>
  ) : null;

  const hex = ui.mapMode === "hex";
  const selectionOpen = Boolean(ui.selection) && !ui.detailsCollapsed;
  const insets = {
    "--log-left":
      hex && ui.minimap
        ? `${(ui.minimapLarge ? MINIMAP_SIZES.large : MINIMAP_SIZES.small) + 24}px`
        : "0.75rem",
    "--log-right": selectionOpen ? "calc(min(24rem, 100vw - 6rem) + 1.5rem)" : "0.75rem",
  } as CSSProperties;

  const openDelete = () => {
    // Stop auto-run first so no batch starts while the dialog is open.
    if (running) status.mutate("paused");
    setDialog("delete");
  };

  return (
    <main
      className="bg-abyss relative h-dvh w-full overflow-hidden"
      style={insets}
      data-testid="world-screen"
    >
      <WorldMapContainer detail={detail} />

      <TopHud
        detail={detail}
        unread={unread}
        notificationsOpen={ui.eventLogOpen}
        onToggleNotifications={() => ui.setEventLogOpen(!ui.eventLogOpen)}
        overviewOpen={ui.panel === "overview"}
        onToggleOverview={() => ui.togglePanel("overview")}
        controls={
          <SpeedControls
            running={running}
            busy={simulate.isPending}
            speed={speed}
            onSpeed={setSpeed}
            togglePending={status.isPending}
            onToggle={() => status.mutate(running ? "paused" : "running")}
            onAdvance={(ticks: Step) => simulate.mutate(ticks)}
          />
        }
        menu={
          <WorldMenu
            onMapSettings={() => ui.togglePanel("layers")}
            debugActive={ui.mapMode === "debug"}
            onDebug={() => ui.setMapMode(ui.mapMode === "debug" ? "hex" : "debug")}
            onInfo={() => setDialog("info")}
            onSnapshot={() => setDialog("snapshot")}
            onChronicle={() => ui.togglePanel("chronicle")}
            onStats={() => ui.togglePanel("stats")}
            onTechnologies={() => ui.togglePanel("technologies")}
            onDelete={openDelete}
          />
        }
      />

      {ui.panel === "overview" && <OverviewPanel detail={detail} />}
      <SelectionPanel detail={detail} place={place} />

      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 sm:right-[var(--log-right)] sm:bottom-3 sm:left-[var(--log-left)]">
        <EventLog
          detail={detail}
          notifications={notifications.items}
          isLoading={notifications.isLoading}
          isError={notifications.isError}
          onRetry={() => void notifications.refetch()}
          status={statusLine}
        />
      </div>

      <Dialog
        open={ui.panel === "chronicle"}
        onClose={ui.closePanel}
        title="Cronaca"
        description="Tutti gli eventi della storia di questo mondo, filtrabili."
        className="w-[min(1100px,calc(100vw-2rem))]"
      >
        {ui.panel === "chronicle" && <WorldTimeline detail={detail} />}
      </Dialog>
      <Dialog
        open={ui.panel === "stats"}
        onClose={ui.closePanel}
        title="Statistiche"
        className="w-[min(1100px,calc(100vw-2rem))]"
      >
        {ui.panel === "stats" && (
          <WorldStatistics
            worldId={worldId}
            civilizations={detail.civilizations.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
          />
        )}
      </Dialog>
      <Dialog
        open={ui.panel === "technologies"}
        onClose={ui.closePanel}
        title="Tecnologie del mondo"
        description="Chi ha scoperto cosa, chi l'ha presa, chi l'ha persa."
        className="w-[min(1100px,calc(100vw-2rem))]"
      >
        {ui.panel === "technologies" && <TechnologyAtlas detail={detail} />}
      </Dialog>
      <WorldInfoDialog
        detail={detail}
        open={dialog === "info" || dialog === "snapshot"}
        focus={dialog === "snapshot" ? "snapshot" : undefined}
        onClose={() => setDialog(null)}
      />
      <DeleteWorldDialog
        world={{ id: worldId, name: detail.world.name, seed: detail.world.seed, status: detail.world.status }}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
      />
    </main>
  );
}
