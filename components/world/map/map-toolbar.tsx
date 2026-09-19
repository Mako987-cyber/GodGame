"use client";

import {
  Coins,
  Crosshair,
  Flag,
  Gauge,
  Gem,
  Globe2,
  Hexagon,
  Info,
  Layers,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Route,
  Swords,
  Tag,
  Thermometer,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MapMode } from "@/lib/client/map-config";
import type { MapLayerId, MapLayerVisibility } from "@/lib/map-renderer";
import { cn } from "@/lib/utils/cn";

/** Map lenses: each one is a layer the player switches often, one click away. */
export const LENSES: { id: MapLayerId; label: string; icon: ReactNode }[] = [
  { id: "territories", label: "Territori", icon: <Flag /> },
  { id: "resources", label: "Risorse", icon: <Gem /> },
  { id: "roads", label: "Infrastrutture", icon: <Route /> },
  { id: "conflicts", label: "Conflitti", icon: <Swords /> },
  { id: "tradeRoutes", label: "Commercio", icon: <Coins /> },
  { id: "climate", label: "Clima e temperatura", icon: <Thermometer /> },
];

export interface MapToolbarProps {
  mode: MapMode;
  layers: MapLayerVisibility;
  onToggleLayer: (id: MapLayerId) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterWorld: () => void;
  onCenterSelection: (() => void) | null;
  follow: boolean;
  onToggleFollow: (() => void) | null;
  minimap: boolean;
  onToggleMinimap: () => void;
  layersOpen: boolean;
  onToggleLayers: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  statsOpen: boolean;
  onToggleStats: () => void;
}

function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-10 place-items-center rounded-lg transition-colors disabled:opacity-35 sm:size-9 [&_svg]:size-[18px]",
        pressed
          ? "bg-ochre/20 text-ochre shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ochre)_55%,transparent)]"
          : "text-parchment/85 hover:bg-raised hover:text-parchment",
        className,
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden className="bg-line mx-1.5 my-1 h-px" />;

/**
 * Vertical map toolbar: camera, lenses and view options. On phones only the camera group and a
 * "layers" button stay visible; the lenses live in the layers drawer.
 */
export function MapToolbar(p: MapToolbarProps) {
  const hex = p.mode === "hex";
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Strumenti della mappa"
      className="hud-glass pointer-events-auto flex max-h-[calc(100dvh-9rem)] flex-col overflow-y-auto rounded-xl p-1"
    >
      <ToolButton label="Aumenta zoom (+)" onClick={p.onZoomIn}>
        <Plus />
      </ToolButton>
      <ToolButton label="Riduci zoom (−)" onClick={p.onZoomOut}>
        <Minus />
      </ToolButton>
      <ToolButton label="Centra il mondo (0)" onClick={p.onCenterWorld}>
        <Globe2 />
      </ToolButton>
      <ToolButton
        label="Centra la selezione"
        onClick={p.onCenterSelection ?? undefined}
        disabled={!p.onCenterSelection}
      >
        <LocateFixed />
      </ToolButton>
      <ToolButton
        label={p.follow ? "Smetti di seguire" : "Segui la selezione dopo ogni avanzamento"}
        pressed={p.follow}
        onClick={p.onToggleFollow ?? undefined}
        disabled={!p.onToggleFollow}
      >
        <Crosshair />
      </ToolButton>
      <Sep />
      <div className="hidden flex-col sm:flex" role="group" aria-label="Lenti della mappa">
        {LENSES.map((l) => (
          <ToolButton
            key={l.id}
            label={`Lente: ${l.label}`}
            pressed={p.layers[l.id]}
            onClick={() => p.onToggleLayer(l.id)}
          >
            {l.icon}
          </ToolButton>
        ))}
        <Sep />
        <ToolButton label="Etichette" pressed={p.layers.labels} onClick={() => p.onToggleLayer("labels")}>
          <Tag />
        </ToolButton>
        <ToolButton
          label="Griglia esagonale"
          pressed={p.layers.hexGrid}
          disabled={!hex}
          onClick={() => p.onToggleLayer("hexGrid")}
        >
          <Hexagon />
        </ToolButton>
        <ToolButton label="Minimappa" pressed={p.minimap} disabled={!hex} onClick={p.onToggleMinimap}>
          <MapIcon />
        </ToolButton>
        <Sep />
      </div>
      <ToolButton label="Tutti i livelli" pressed={p.layersOpen} onClick={p.onToggleLayers}>
        <Layers />
      </ToolButton>
      <ToolButton label="Legenda" pressed={p.legendOpen} onClick={p.onToggleLegend}>
        <Info />
      </ToolButton>
      <ToolButton
        label="Prestazioni di rendering"
        pressed={p.statsOpen}
        onClick={p.onToggleStats}
        className="hidden sm:grid"
      >
        <Gauge />
      </ToolButton>
    </div>
  );
}
