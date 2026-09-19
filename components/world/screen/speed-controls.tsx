"use client";

import { ChevronDown, FastForward, Loader2, Pause, Play, SkipForward } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { SPEEDS, type Speed } from "@/lib/client/store";
import { cn } from "@/lib/utils/cn";

const STEPS = [1, 10, 50, 100] as const;
export type Step = (typeof STEPS)[number];

/**
 * Time controls: play/pause, auto-run speed and manual steps. Auto-run is a browser loop of
 * bounded batch requests (no server loop); manual steps are disabled while a request runs or
 * while auto-run is on, so two batches never race.
 */
export function SpeedControls({
  running,
  busy,
  speed,
  onToggle,
  onSpeed,
  onAdvance,
  togglePending,
}: {
  running: boolean;
  busy: boolean;
  speed: Speed;
  onToggle: () => void;
  onSpeed: (speed: Speed) => void;
  onAdvance: (ticks: Step) => void;
  togglePending: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Controlli del tempo">
      <button
        type="button"
        onClick={onToggle}
        disabled={togglePending}
        aria-pressed={running}
        aria-label={running ? "Metti in pausa" : "Avvia la simulazione automatica"}
        title={running ? "Pausa" : "Avvia"}
        className={cn(
          "grid size-9 place-items-center rounded-lg transition-colors disabled:opacity-50 [&_svg]:size-4",
          running
            ? "bg-growth/20 text-growth hover:bg-growth/30"
            : "bg-ochre text-abyss hover:bg-ochre-strong",
        )}
      >
        {running ? <Pause /> : <Play />}
      </button>
      <div
        className="bg-raised/70 hidden items-center rounded-lg p-0.5 md:flex"
        role="radiogroup"
        aria-label="Velocità"
      >
        {(Object.keys(SPEEDS).map(Number) as Speed[]).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            title={`Velocità ${s}×: ${SPEEDS[s].label}`}
            onClick={() => onSpeed(s)}
            className={cn(
              "h-8 min-w-9 rounded-md px-1.5 text-xs font-medium transition-colors",
              speed === s ? "bg-abyss text-ochre" : "text-muted hover:text-parchment",
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <Menu
        label="Avanza di"
        items={STEPS.map((s) => ({
          id: String(s),
          label: `Avanza di ${s} ${s === 1 ? "anno" : "anni"}`,
          hint: `+${s}`,
          icon: s === 1 ? <SkipForward /> : <FastForward />,
          disabled: busy || running,
          onSelect: () => onAdvance(s),
        }))}
        trigger={(t) => (
          <button
            {...t}
            type="button"
            disabled={busy || running}
            title={running ? "Metti in pausa per avanzare manualmente" : "Avanza manualmente"}
            className="text-parchment hover:bg-raised flex h-9 items-center gap-1 rounded-lg px-2 text-sm disabled:opacity-45"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <SkipForward className="size-4" aria-hidden />
            )}
            <span className="hidden lg:inline">Avanza</span>
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        )}
      />
      <button
        type="button"
        disabled={busy || running}
        onClick={() => onAdvance(10)}
        className="text-parchment hover:bg-raised hidden h-9 rounded-lg px-2 text-sm font-medium disabled:opacity-45 xl:block"
        title="Avanza di 10 anni"
      >
        +10
      </button>
      <span className="sr-only" aria-live="polite">
        {busy ? "Simulazione in corso" : ""}
      </span>
    </div>
  );
}
