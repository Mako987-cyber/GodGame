import { create } from "zustand";

export type Overlay = "biome" | "fertility" | "resources" | "population" | "borders" | "infrastructure";

export type Selection =
  | { kind: "cell"; x: number; y: number }
  | { kind: "tribe"; id: string }
  | { kind: "settlement"; id: string }
  | { kind: "civilization"; id: string };

/** UI-only state of the world page (never persisted, never the source of truth). */
interface WorldUiState {
  overlay: Overlay;
  selection: Selection | null;
  focus: { x: number; y: number; nonce: number } | null;
  batch: 1 | 10 | 50 | 100;
  setOverlay: (overlay: Overlay) => void;
  select: (selection: Selection | null) => void;
  focusOn: (x: number, y: number) => void;
  setBatch: (batch: 1 | 10 | 50 | 100) => void;
  reset: () => void;
}

export const useWorldUi = create<WorldUiState>((set) => ({
  overlay: "biome",
  selection: null,
  focus: null,
  batch: 10,
  setOverlay: (overlay) => set({ overlay }),
  select: (selection) => set({ selection }),
  focusOn: (x, y) => set({ focus: { x, y, nonce: Date.now() }, selection: { kind: "cell", x, y } }),
  setBatch: (batch) => set({ batch }),
  reset: () => set({ selection: null, focus: null, overlay: "biome" }),
}));
