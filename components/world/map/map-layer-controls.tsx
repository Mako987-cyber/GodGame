"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LAYER_LABELS } from "@/lib/map-renderer";
import type { MapLayerId, MapLayerVisibility } from "@/lib/map-renderer";

const GROUPS: { title: string; layers: MapLayerId[] }[] = [
  { title: "Territorio", layers: ["terrain", "elevation", "water", "rivers", "fertility"] },
  { title: "Società", layers: ["settlements", "buildings", "roads", "territories", "labels"] },
  { title: "Dinamiche", layers: ["resources", "tradeRoutes", "conflicts"] },
  { title: "Sviluppo", layers: ["debugGrid"] },
];

/** Layer switches. A drawer on phones, a floating panel on larger screens. */
export function MapLayerControls({
  layers,
  onToggle,
  onClose,
}: {
  layers: MapLayerVisibility;
  onToggle: (id: MapLayerId) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Livelli della mappa"
      className="border-line bg-abyss/95 absolute inset-x-2 bottom-2 z-30 max-h-[70%] overflow-y-auto rounded-lg border p-3 shadow-xl backdrop-blur sm:inset-x-auto sm:top-14 sm:right-2 sm:bottom-auto sm:w-64"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-serif text-lg">Livelli</h3>
        <Button size="icon" variant="ghost" aria-label="Chiudi i livelli" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="grid gap-3">
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
