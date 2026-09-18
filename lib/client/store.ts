import { create } from "zustand";

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
  | { kind: "person"; id: string };

/** UI-only state of the world page (never persisted, never the source of truth). */
interface WorldUiState {
  overlay: Overlay;
  selection: Selection | null;
  focus: { x: number; y: number; nonce: number } | null;
  batch: 1 | 10 | 50 | 100;
  /** Event the "Perché è successo?" panel is explaining, if any. */
  explaining: string | null;
  setOverlay: (overlay: Overlay) => void;
  select: (selection: Selection | null) => void;
  focusOn: (x: number, y: number) => void;
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
  setOverlay: (overlay) => set({ overlay }),
  select: (selection) => set({ selection }),
  focusOn: (x, y) => set({ focus: { x, y, nonce: Date.now() }, selection: { kind: "cell", x, y } }),
  setBatch: (batch) => set({ batch }),
  explain: (explaining) => set({ explaining }),
  reset: () => set({ selection: null, focus: null, overlay: "biome", explaining: null }),
}));
