"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import type { SimulateResponse } from "@/lib/dto";
import { fmtInt, fmtYear } from "@/lib/client/format";
import { useWorldUi } from "@/lib/client/store";

const STEPS = [1, 10, 50, 100] as const;

export function WorldControls({
  running,
  busy,
  onToggle,
  onAdvance,
  lastRun,
  error,
  tick,
}: {
  tick: number;
  running: boolean;
  busy: boolean;
  onToggle: () => void;
  onAdvance: (ticks: (typeof STEPS)[number]) => void;
  lastRun: SimulateResponse | null;
  error: string | null;
}) {
  const { batch, setBatch } = useWorldUi();
  return (
    <div className="border-line bg-surface flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={running ? "secondary" : "primary"} onClick={onToggle} aria-pressed={running}>
          {running ? <Pause /> : <Play />}
          {running ? "Pausa" : "Riprendi"}
        </Button>
        <label className="text-muted flex items-center gap-2 text-sm">
          Velocità
          <Select
            className="h-9 w-auto"
            value={batch}
            onChange={(e) => setBatch(Number(e.target.value) as (typeof STEPS)[number])}
          >
            {STEPS.map((s) => (
              <option key={s} value={s}>
                {s === 1 ? "1 anno" : `${s} anni`} per passo
              </option>
            ))}
          </Select>
        </label>
        <span className="bg-line mx-1 hidden h-6 w-px sm:block" aria-hidden />
        {STEPS.map((s) => (
          <Button key={s} size="sm" disabled={busy || running} onClick={() => onAdvance(s)}>
            +{s} {s === 1 ? "anno" : "anni"}
          </Button>
        ))}
        <p className="text-muted ml-auto text-sm" aria-live="polite">
          {busy ? (
            "Simulazione in corso…"
          ) : lastRun ? (
            <LastRun run={lastRun} />
          ) : tick === 0 ? (
            "Il tempo è fermo. Avanza di qualche anno per iniziare."
          ) : (
            "Pronto a proseguire da dove era rimasto."
          )}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-war text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function LastRun({ run }: { run: SimulateResponse }) {
  const delta = run.metrics.populationDelta;
  return (
    <>
      {run.ticksRun} {run.ticksRun === 1 ? "anno simulato" : "anni simulati"} fino al {fmtYear(run.year)} in{" "}
      {fmtInt(run.durationMs)} ms: {fmtInt(run.metrics.births)} nascite, {fmtInt(run.metrics.deaths)} morti (
      {delta >= 0 ? "+" : ""}
      {fmtInt(delta)})
      {run.metrics.epidemicDeaths > 0 && `, ${fmtInt(run.metrics.epidemicDeaths)} per epidemia`}
      {run.metrics.migrations > 0 && `, ${fmtInt(run.metrics.migrations)} in migrazione`},{" "}
      {fmtInt(run.eventsTotal)} eventi
      {run.partial && (
        <span className="text-ochre">
          . Batch interrotto per limite di tempo: i tick completati sono salvati.
        </span>
      )}
    </>
  );
}
