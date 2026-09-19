"use client";

import { MAP_MODE_LABELS, type MapMode } from "@/lib/client/map-config";
import { LAYER_LABELS } from "@/lib/map-renderer";
import type { MapLayerId, MapLayerVisibility } from "@/lib/map-renderer";

const GROUPS: { title: string; layers: MapLayerId[] }[] = [
  { title: "Territorio", layers: ["terrain", "elevation", "water", "rivers", "fertility", "climate"] },
  { title: "Società", layers: ["settlements", "buildings", "roads", "territories", "labels"] },
  { title: "Dinamiche", layers: ["resources", "tradeRoutes", "conflicts"] },
  { title: "Vista", layers: ["hexGrid", "debugGrid"] },
];

/** Layer switches, grouped; shown inside a floating panel (a drawer on phones). */
export function MapLayerControls({
  layers,
  onToggle,
  mode,
  onModeChange,
  debugStats,
  onToggleDebugStats,
}: {
  layers: MapLayerVisibility;
  onToggle: (id: MapLayerId) => void;
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  debugStats: boolean;
  onToggleDebugStats: () => void;
}) {
  return (
    <div>
      <div className="grid gap-3">
        <fieldset>
          <legend className="text-muted mb-1 text-xs tracking-wide uppercase">Rappresentazione</legend>
          <div className="grid gap-1">
            {(Object.keys(MAP_MODE_LABELS) as MapMode[]).map((m) => (
              <label key={m} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="map-mode"
                  className="size-4 accent-[var(--color-ochre)]"
                  checked={mode === m}
                  onChange={() => onModeChange(m)}
                />
                {MAP_MODE_LABELS[m]}
              </label>
            ))}
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-ochre)]"
                checked={debugStats}
                onChange={onToggleDebugStats}
              />
              Statistiche di rendering (FPS)
            </label>
          </div>
        </fieldset>
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="text-muted mb-1 text-xs tracking-wide uppercase">{g.title}</legend>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-1">
              {g.layers.map((id) => (
                <label key={id} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-ochre)]"
                    checked={layers[id]}
                    onChange={() => onToggle(id)}
                  />
                  {LAYER_LABELS[id]}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
