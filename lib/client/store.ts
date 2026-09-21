import { create } from "zustand";
import { DEFAULT_LAYERS } from "@/lib/map-renderer/visibility";
import type { MapLayerId, MapLayerVisibility } from "@/lib/map-renderer/types";
import { DEFAULT_MAP_MODE, type MapMode } from "./map-config";

export type Overlay =
  | "biome"
  | "fertility"
  | "water"
  | "resources"
  | "population"
  | "borders"
  | "infrastructure"
  | "trade"
  | "conflicts"
  | "culture";

export const OVERLAY_LABELS: Record<Overlay, string> = {
  biome: "Biomi",
  fertility: "Fertilità",
  water: "Acqua",
  resources: "Risorse",
  population: "Popolazione",
  borders: "Territorio",
  infrastructure: "Infrastrutture",
  trade: "Rotte commerciali",
  conflicts: "Conflitti",
  culture: "Influenza culturale",
};

export type Selection =
  | { kind: "cell"; x: number; y: number }
  | { kind: "tribe"; id: string }
  | { kind: "settlement"; id: string }
  | { kind: "civilization"; id: string }
  | { kind: "person"; id: string }
  | { kind: "war"; aId: string; bId: string };

/**
 * Auto-run speeds. The server only ever runs one bounded batch per request: a speed is a batch
 * size (allowed tick counts) plus the pause the browser waits between batches.
 */
export type Speed = 1 | 2 | 5;
export const SPEEDS: Record<Speed, { ticks: 1 | 10 | 50 | 100; pauseMs: number; label: string }> = {
  1: { ticks: 10, pauseMs: 1400, label: "10 anni per passo, passo lento" },
  2: { ticks: 10, pauseMs: 450, label: "10 anni per passo, passo rapido" },
  5: { ticks: 50, pauseMs: 450, label: "50 anni per passo" },
};

/** Floating panels of the world screen. */
export type PanelId = "overview" | "layers" | "legend" | "chronicle" | "stats" | "technologies";

/** UI-only state of the world page (never persisted, never the source of truth). */
interface WorldUiState {
  overlay: Overlay;
  selection: Selection | null;
  focus: { x: number; y: number; nonce: number } | null;
  speed: Speed;
  /** Event the "Perché è successo?" panel is explaining, if any. */
  explaining: string | null;
  /** Hex, isometric or the technical/debug top-down map. */
  mapMode: MapMode;
  mapLayers: MapLayerVisibility;
  /** Keep the camera on the selected settlement or tribe as the world advances. */
  follow: boolean;
  /** Side panel shown next to the map (only one at a time on small screens). */
  panel: PanelId | null;
  /** The selection panel can be collapsed without losing the selection. */
  detailsCollapsed: boolean;
  minimap: boolean;
  minimapLarge: boolean;
  debugStats: boolean;
  /** The event log is expanded (list of notifications) instead of a one-line ticker. */
  eventLogOpen: boolean;
  /** Last tick whose notifications the player has seen (for the unread badge). */
  seenTick: number;
  setMapMode: (mode: MapMode) => void;
  toggleMapLayer: (id: MapLayerId) => void;
  setMapLayers: (patch: Partial<MapLayerVisibility>) => void;
  setFollow: (follow: boolean) => void;
  setOverlay: (overlay: Overlay) => void;
  select: (selection: Selection | null) => void;
  /** Centres the map on a cell; selects it unless `keepSelection` is set. */
  focusOn: (x: number, y: number, keepSelection?: boolean) => void;
  setSpeed: (speed: Speed) => void;
  explain: (eventId: string | null) => void;
  togglePanel: (panel: PanelId) => void;
  closePanel: () => void;
  setDetailsCollapsed: (collapsed: boolean) => void;
  setMinimap: (on: boolean) => void;
  setMinimapLarge: (on: boolean) => void;
  setDebugStats: (on: boolean) => void;
  setEventLogOpen: (open: boolean) => void;
  markSeen: (tick: number) => void;
  reset: () => void;
}

export const useWorldUi = create<WorldUiState>((set) => ({
  overlay: "biome",
  selection: null,
  focus: null,
  speed: 1,
  explaining: null,
  mapMode: DEFAULT_MAP_MODE,
  mapLayers: DEFAULT_LAYERS,
  follow: false,
  panel: null,
  detailsCollapsed: false,
  minimap: true,
  minimapLarge: false,
  debugStats: false,
  eventLogOpen: false,
  seenTick: -1,
  setMapMode: (mapMode) => set({ mapMode }),
  toggleMapLayer: (id) => set((s) => ({ mapLayers: { ...s.mapLayers, [id]: !s.mapLayers[id] } })),
  setMapLayers: (patch) => set((s) => ({ mapLayers: { ...s.mapLayers, ...patch } })),
  setFollow: (follow) => set({ follow }),
  setOverlay: (overlay) => set({ overlay }),
  select: (selection) => set({ selection, detailsCollapsed: false }),
  focusOn: (x, y, keepSelection = false) =>
    set((s) => ({
      focus: { x, y, nonce: Date.now() },
      selection: keepSelection ? s.selection : { kind: "cell", x, y },
      detailsCollapsed: keepSelection ? s.detailsCollapsed : false,
    })),
  setSpeed: (speed) => set({ speed }),
  explain: (explaining) => set({ explaining }),
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
  closePanel: () => set({ panel: null }),
  setDetailsCollapsed: (detailsCollapsed) => set({ detailsCollapsed }),
  setMinimap: (minimap) => set({ minimap }),
  setMinimapLarge: (minimapLarge) => set({ minimapLarge }),
  setDebugStats: (debugStats) => set({ debugStats }),
  setEventLogOpen: (eventLogOpen) => set({ eventLogOpen }),
  markSeen: (tick) => set((s) => ({ seenTick: Math.max(s.seenTick, tick) })),
  reset: () =>
    set({
      selection: null,
      focus: null,
      overlay: "biome",
      explaining: null,
      follow: false,
      panel: null,
      detailsCollapsed: false,
      eventLogOpen: false,
      seenTick: -1,
    }),
}));
