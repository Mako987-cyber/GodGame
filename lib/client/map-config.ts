/**
 * Map renderer selection:
 * - `hex`: hexagonal strategy map (default);
 * - `isometric`: the previous 2:1 isometric map, kept as an alternative;
 * - `debug`: the technical top-down map (fallback on devices where canvas rendering misbehaves).
 * `NEXT_PUBLIC_MAP_RENDERER` picks the default; users can switch at any time from the map toolbar.
 */
export type MapMode = "hex" | "isometric" | "debug";

function defaultMode(value: string | undefined): MapMode {
  return value === "debug" || value === "isometric" ? value : "hex";
}

export const DEFAULT_MAP_MODE: MapMode = defaultMode(process.env.NEXT_PUBLIC_MAP_RENDERER);

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  hex: "Esagonale",
  isometric: "Isometrica (classica)",
  debug: "Tecnica (debug)",
};

/** `NEXT_PUBLIC_MAP_DEBUG=1` opens the performance panel by default. */
export const MAP_DEBUG_PANEL_DEFAULT = process.env.NEXT_PUBLIC_MAP_DEBUG === "1";
