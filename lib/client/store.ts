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

/** UI-only state of the world page (never persisted, never the source of truth). */
interface WorldUiState {
  overlay: Overlay;
  selection: Selection | null;
  focus: { x: number; y: number; nonce: number } | null;
  batch: 1 | 10 | 50 | 100;
  /** Event the "Perché è successo?" panel is explaining, if any. */
  explaining: string | null;
  /** Isometric map or the technical/debug top-down map. */
  mapMode: MapMode;
  mapLayers: MapLayerVisibility;
  /** Keep the camera on the selected settlement or tribe as the world advances. */
  follow: boolean;
  setMapMode: (mode: MapMode) => void;
  toggleMapLayer: (id: MapLayerId) => void;
  setFollow: (follow: boolean) => void;
  setOverlay: (overlay: Overlay) => void;
  select: (selection: Selection | null) => void;
  /** Centres the map on a cell; selects it unless `keepSelection` is set. */
  focusOn: (x: number, y: number, keepSelection?: boolean) => void;
  setBatch: (batch: 1 | 10 | 50 | 100) => void;
  explain: (eventId: string | null) => void;
  reset: () => void;
}

export const useWorldUi = create<WorldUiState>((set) => ({
  overlay: "biome",
  selection: null,
  focus: null,
  batch: 10,
  explaining: null,
  mapMode: DEFAULT_MAP_MODE,
  mapLayers: DEFAULT_LAYERS,
  follow: false,
  setMapMode: (mapMode) => set({ mapMode }),
  toggleMapLayer: (id) => set((s) => ({ mapLayers: { ...s.mapLayers, [id]: !s.mapLayers[id] } })),
  setFollow: (follow) => set({ follow }),
  setOverlay: (overlay) => set({ overlay }),
  select: (selection) => set({ selection }),
  focusOn: (x, y, keepSelection = false) =>
    set((s) => ({
      focus: { x, y, nonce: Date.now() },
      selection: keepSelection ? s.selection : { kind: "cell", x, y },
    })),
  setBatch: (batch) => set({ batch }),
  explain: (explaining) => set({ explaining }),
  reset: () => set({ selection: null, focus: null, overlay: "biome", explaining: null, follow: false }),
}));
