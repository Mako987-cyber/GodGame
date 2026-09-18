"use client";

import { Bug, Crosshair, Globe2, Info, Layers, LocateFixed, Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface MapToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onCenterWorld: () => void;
  onCenterSelection: (() => void) | null;
  follow: boolean;
  onToggleFollow: (() => void) | null;
  layersOpen: boolean;
  onToggleLayers: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  debugOpen: boolean;
  onToggleDebug: () => void;
}

/** Floating map controls: large touch targets, every button labelled for assistive technology. */
export function MapToolbar(p: MapToolbarProps) {
  const btn = "bg-abyss/85 size-10 border border-line backdrop-blur hover:bg-raised sm:size-9";
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex justify-between gap-2">
      <div className="pointer-events-auto flex flex-col gap-1" role="toolbar" aria-label="Zoom e vista">
        <Button
          size="icon"
          variant="ghost"
          className={btn}
          aria-label="Aumenta zoom"
          title="Aumenta zoom (+)"
          onClick={p.onZoomIn}
        >
          <Plus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={btn}
          aria-label="Riduci zoom"
          title="Riduci zoom (−)"
          onClick={p.onZoomOut}
        >
          <Minus />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={btn}
          aria-label="Reimposta la vista"
          title="Vista iniziale (0)"
          onClick={p.onReset}
        >
          <Scan />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={btn}
          aria-label="Centra il mondo"
          title="Centra il mondo"
          onClick={p.onCenterWorld}
        >
          <Globe2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={btn}
          aria-label="Centra la selezione"
          title="Centra la selezione"
          disabled={!p.onCenterSelection}
          onClick={() => p.onCenterSelection?.()}
        >
          <Crosshair />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn(btn, p.follow && "text-ochre border-ochre/60")}
          aria-label={p.follow ? "Smetti di seguire la selezione" : "Segui la selezione nel tempo"}
          aria-pressed={p.follow}
          title="Segui la selezione"
          disabled={!p.onToggleFollow}
          onClick={() => p.onToggleFollow?.()}
        >
          <LocateFixed />
        </Button>
      </div>
      <div className="pointer-events-auto flex gap-1" role="toolbar" aria-label="Pannelli della mappa">
        <Button
          size="icon"
          variant="ghost"
          className={cn(btn, p.layersOpen && "text-ochre border-ochre/60")}
          aria-label="Livelli della mappa"
          aria-expanded={p.layersOpen}
          title="Livelli"
          onClick={p.onToggleLayers}
        >
          <Layers />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn(btn, p.legendOpen && "text-ochre border-ochre/60")}
          aria-label="Legenda"
          aria-expanded={p.legendOpen}
          title="Legenda"
          onClick={p.onToggleLegend}
        >
          <Info />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn(btn, p.debugOpen && "text-ochre border-ochre/60")}
          aria-label="Pannello prestazioni"
          aria-expanded={p.debugOpen}
          title="Prestazioni"
          onClick={p.onToggleDebug}
        >
          <Bug />
        </Button>
      </div>
    </div>
  );
}
