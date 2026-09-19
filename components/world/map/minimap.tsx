"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { HexGrid, type IsometricMapViewModel } from "@/lib/map-renderer";
import {
  drawMinimapBase,
  drawMinimapOverlay,
  minimapToWorld,
  minimapTransform,
} from "@/lib/map-renderer/minimap";
import type { Rect } from "@/lib/map-renderer/projection";
import type { MapViewState } from "./map-canvas";

export interface MinimapHandle {
  /** Called by the map after the camera moved; redraws only the overlay. */
  update: (view: MapViewState) => void;
}

export const MINIMAP_SIZES = { small: 176, large: 288 } as const;
const SIZES = MINIMAP_SIZES;

/**
 * Overview of the whole hex map. Click or drag to move the camera. It reuses the map's view model
 * (no extra queries) and redraws the terrain bitmap only when the data changes.
 */
export const Minimap = forwardRef<
  MinimapHandle,
  {
    viewModel: IsometricMapViewModel;
    selection: { x: number; y: number } | null;
    onNavigate: (worldX: number, worldY: number, immediate: boolean) => void;
    onClose: () => void;
    large: boolean;
    onToggleSize: () => void;
  }
>(function Minimap({ viewModel, selection, onNavigate, onClose, large, onToggleSize }, ref) {
  const size: keyof typeof SIZES = large ? "large" : "small";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<Rect | null>(null);
  const dragging = useRef(false);
  const grid = useMemo(
    () => new HexGrid(viewModel.width, viewModel.height),
    [viewModel.width, viewModel.height],
  );
  const transform = useMemo(() => minimapTransform(grid.bounds(), SIZES[size]), [grid, size]);
  const selectionPoint = useMemo(
    () =>
      selection && grid.inBounds(selection.x, selection.y) ? grid.center(selection.x, selection.y) : null,
    [grid, selection],
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !base) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMinimapOverlay(ctx, transform, viewRef.current, selectionPoint);
  }, [transform, selectionPoint]);

  // Terrain bitmap: rebuilt when the data or the size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(transform.width * dpr);
    canvas.height = Math.round(transform.height * dpr);
    const base = baseRef.current ?? document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;
    const bctx = base.getContext("2d");
    if (!bctx) return;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMinimapBase(bctx, viewModel, grid, transform);
    baseRef.current = base;
    paint();
  }, [viewModel, grid, transform, paint]);

  useImperativeHandle(
    ref,
    () => ({
      update: ({ view }) => {
        viewRef.current = view;
        paint();
      },
    }),
    [paint],
  );

  const navigate = (e: React.PointerEvent<HTMLCanvasElement>, immediate: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = minimapToWorld(transform, { x: e.clientX - r.left, y: e.clientY - r.top });
    onNavigate(w.x, w.y, immediate);
  };

  return (
    <div
      className="hud-glass pointer-events-auto overflow-hidden rounded-xl"
      role="region"
      aria-label="Minimappa"
    >
      <div className="text-muted flex items-center justify-between gap-2 px-2 py-1 text-[11px] tracking-wide uppercase">
        <span>Minimappa</span>
        <span className="flex gap-0.5">
          <button
            type="button"
            className="hover:text-parchment grid size-6 place-items-center rounded"
            aria-label={size === "small" ? "Ingrandisci la minimappa" : "Riduci la minimappa"}
            onClick={onToggleSize}
          >
            {size === "small" ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            className="hover:text-parchment grid size-6 place-items-center rounded"
            aria-label="Nascondi la minimappa"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: transform.width, height: transform.height }}
        className="block cursor-pointer touch-none"
        aria-label="Minimappa: clic o trascina per spostare la vista. Quadrati dorati: capitali; punti: insediamenti; croci rosse: guerre."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          navigate(e, false);
        }}
        onPointerMove={(e) => dragging.current && navigate(e, true)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      />
    </div>
  );
});
