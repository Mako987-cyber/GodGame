"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import type { SimulateResponse, WorldDetail } from "@/lib/dto";
import { api, ApiError, queryKeys } from "@/lib/client/api";
import { useWorldUi } from "@/lib/client/store";
import { WorldControls } from "./world-controls";
import { WorldMap } from "./world-map";
import { WorldSidebar } from "./world-sidebar";
import { WorldStatistics } from "./world-statistics";
import { WorldSummary } from "./world-summary";
import { WorldTimeline } from "./world-timeline";

const AUTO_RUN_PAUSE_MS = 700;

export function WorldView({ initial }: { initial: WorldDetail }) {
  const worldId = initial.world.id;
  const queryClient = useQueryClient();
  const reset = useWorldUi((s) => s.reset);
  const batch = useWorldUi((s) => s.batch);
  const [lastRun, setLastRun] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lower, setLower] = useState<"timeline" | "stats">("timeline");

  useEffect(() => reset, [reset]);

  const world = useQuery({
    queryKey: queryKeys.world(worldId),
    queryFn: () => api.getWorld(worldId),
    initialData: initial,
  });
  const detail = world.data;
  const running = detail.world.status === "running";

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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = async () => {
      if (cancelled) return;
      try {
        await runBatch(batch);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "SIMULATION_IN_PROGRESS")) {
          changeStatus("paused");
          return;
        }
      }
      if (!cancelled) timer = setTimeout(step, AUTO_RUN_PAUSE_MS);
    };
    void step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, batch, runBatch, changeStatus]);

  return (
    <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-6">
      <WorldSummary detail={detail} />
      <WorldControls
        running={running}
        busy={simulate.isPending}
        onToggle={() => status.mutate(running ? "paused" : "running")}
        onAdvance={(ticks) => simulate.mutate(ticks)}
        lastRun={lastRun}
        error={error}
        tick={detail.world.currentTick}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
        <Panel className="p-4">
          <WorldMap detail={detail} />
        </Panel>
        <Panel title="Dettaglio" className="xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <WorldSidebar detail={detail} />
        </Panel>
      </div>
      <Panel
        title={lower === "timeline" ? "Cronaca" : "Statistiche"}
        actions={
          <Tabs
            label="Sezione"
            value={lower}
            onChange={setLower}
            items={[
              { value: "timeline", label: "Cronaca" },
              { value: "stats", label: "Statistiche" },
            ]}
          />
        }
      >
        {lower === "timeline" ? <WorldTimeline worldId={worldId} /> : <WorldStatistics worldId={worldId} />}
      </Panel>
    </main>
  );
}
