/**
 * Map renderer selection. `NEXT_PUBLIC_MAP_RENDERER=debug` makes the technical top-down map the
 * default (e.g. on devices where the isometric map misbehaves); users can switch at any time.
 */
export type MapMode = "isometric" | "debug";

export const DEFAULT_MAP_MODE: MapMode =
  process.env.NEXT_PUBLIC_MAP_RENDERER === "debug" ? "debug" : "isometric";

/** `NEXT_PUBLIC_MAP_DEBUG=1` opens the performance panel by default. */
export const MAP_DEBUG_PANEL_DEFAULT = process.env.NEXT_PUBLIC_MAP_DEBUG === "1";
