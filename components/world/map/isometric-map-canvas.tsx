"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  IsometricRenderer,
  centerOn,
  clampCameraToGrid,
  createFittedCamera,
  describeTarget,
  lerpCamera,
  pan,
  targetKey,
  zoomAt,
  ZOOM,
  type CameraState,
  type FrameStats,
  type HitTarget,
  type IsometricMapViewModel,
  type TargetDescription,
  type Viewport,
} from "@/lib/map-renderer";

export interface MapController {
  zoomBy: (factor: number) => void;
  resetView: () => void;
  centerWorld: () => void;
  /** Flies to a cell; `minZoom` raises the zoom if the camera is further out. */
  flyToCell: (x: number, y: number, minZoom?: number) => void;
}

interface Props {
  viewModel: IsometricMapViewModel;
  hoverTarget: HitTarget | null;
  focus: { x: number; y: number; nonce: number } | null;
  onHover: (target: HitTarget | null) => void;
  onSelect: (target: HitTarget) => void;
  onStats?: (stats: FrameStats) => void;
  onError: (error: Error) => void;
}

const ANIMATION_MS = 380;
const KEY_PAN = 60;

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * The isometric canvas. Camera, hover and animation live in refs: panning and zooming never
 * re-render React, the renderer draws only when something changed.
 */
export const IsometricMapCanvas = forwardRef<MapController, Props>(function IsometricMapCanvas(
  { viewModel, hoverTarget, focus, onHover, onSelect, onStats, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IsometricRenderer | null>(null);
  const cameraRef = useRef<CameraState | null>(null);
  const viewportRef = useRef<Viewport>({ width: 0, height: 0 });
  const animRef = useRef<{ from: CameraState; to: CameraState; start: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const hoverKey = useRef("");
  const hoverRef = useRef<HitTarget | null>(hoverTarget);
  const focusRef = useRef(focus);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; pinch: number | null } | null>(
    null,
  );
  const lastStatsAt = useRef(0);
  const callbacks = useRef({ onHover, onSelect, onStats, onError });
  const viewModelRef = useRef(viewModel);
  const [tooltip, setTooltip] = useState<TargetDescription | null>(null);

  useEffect(() => {
    callbacks.current = { onHover, onSelect, onStats, onError };
  });

  const requestRender = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(function frame(time) {
      frameRef.current = null;
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      const camera0 = cameraRef.current;
      const viewport = viewportRef.current;
      if (!renderer || !canvas || !camera0 || viewport.width === 0) return;
      let camera = camera0;
      const anim = animRef.current;
      if (anim) {
        const t = Math.min(1, (time - anim.start) / ANIMATION_MS);
        camera = lerpCamera(anim.from, anim.to, ease(t), viewport);
        if (t >= 1) animRef.current = null;
      }
      camera = clampCameraToGrid(
        camera,
        viewport,
        renderer.config,
        viewModelRef.current.width,
        viewModelRef.current.height,
      );
      cameraRef.current = camera;
      try {
        const dpr = window.devicePixelRatio || 1;
        const result = renderer.render({
          camera,
          viewport,
          dpr,
          hover: hoverRef.current,
          focus: focusRef.current,
        });
        if (callbacks.current.onStats && time - lastStatsAt.current > 250) {
          lastStatsAt.current = time;
          callbacks.current.onStats(result.stats);
        }
        if (result.needsAnotherFrame || animRef.current) requestRender();
      } catch (e) {
        callbacks.current.onError(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }, []);

  const setCamera = useCallback(
    (next: CameraState, animate = false) => {
      const current = cameraRef.current;
      if (animate && current) animRef.current = { from: current, to: next, start: performance.now() };
      else {
        animRef.current = null;
        cameraRef.current = next;
      }
      requestRender();
    },
    [requestRender],
  );

  // Renderer lifecycle: one renderer per map size (i.e. per world); data updates are incremental.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = rendererRef.current;
    try {
      if (!canvas.getContext("2d")) throw new Error("Il browser non supporta Canvas 2D.");
      if (renderer?.accepts(viewModel)) renderer.setViewModel(viewModel);
      else {
        renderer?.dispose();
        rendererRef.current = new IsometricRenderer(canvas, viewModel);
        cameraRef.current = null;
      }
    } catch (e) {
      callbacks.current.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!cameraRef.current && viewportRef.current.width > 0 && rendererRef.current) {
      cameraRef.current = createFittedCamera(rendererRef.current.bounds, viewportRef.current);
    }
    requestRender();
  }, [viewModel, requestRender]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
      // Reset the handles: StrictMode remounts reuse these refs, and a stale id would block rendering.
      frameRef.current = null;
      hoverFrame.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    },
    [],
  );

  // Hover and focus come from React state but only affect the next frame.
  useEffect(() => {
    hoverRef.current = hoverTarget;
    requestRender();
  }, [hoverTarget, requestRender]);

  useEffect(() => {
    focusRef.current = focus;
    const renderer = rendererRef.current;
    if (!focus || !renderer || !cameraRef.current) return;
    const target = centerOn(
      cameraRef.current,
      renderer.cellCenter(focus.x, focus.y),
      viewportRef.current,
      Math.max(cameraRef.current.zoom, 1),
    );
    setCamera(target, true);
  }, [focus, setCamera]);

  // Canvas size follows the container.
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const prev = viewportRef.current;
      viewportRef.current = { width, height };
      const renderer = rendererRef.current;
      if (renderer) {
        if (!cameraRef.current) cameraRef.current = createFittedCamera(renderer.bounds, viewportRef.current);
        else if (prev.width > 0) {
          // Keep the same world point at the centre when the container resizes.
          cameraRef.current = pan(cameraRef.current, (width - prev.width) / 2, (height - prev.height) / 2);
        }
      }
      requestRender();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [requestRender]);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor) => {
        const camera = cameraRef.current;
        if (!camera) return;
        const v = viewportRef.current;
        setCamera(zoomAt(camera, factor, v.width / 2, v.height / 2), true);
      },
      resetView: () => {
        const renderer = rendererRef.current;
        if (renderer) setCamera(createFittedCamera(renderer.bounds, viewportRef.current), true);
      },
      centerWorld: () => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        if (!renderer || !camera) return;
        const b = renderer.bounds;
        setCamera(
          centerOn(camera, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, viewportRef.current),
          true,
        );
      },
      flyToCell: (x, y, minZoom = 0) => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        if (!renderer || !camera) return;
        setCamera(
          centerOn(camera, renderer.cellCenter(x, y), viewportRef.current, Math.max(camera.zoom, minZoom)),
          true,
        );
      },
    }),
    [setCamera],
  );

  // Hover picking runs at most once per frame, and React state changes only when the target does.
  const scheduleHover = useCallback(() => {
    if (hoverFrame.current !== null) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const p = pointerRef.current;
      const tip = tooltipRef.current;
      if (!renderer || !camera) return;
      const target = p ? renderer.pick(p.x, p.y, camera) : { target: null, ms: 0 };
      renderer.recordHitTest(target.ms);
      const key = targetKey(target.target);
      if (tip && p) {
        const v = viewportRef.current;
        const x = Math.min(p.x + 16, v.width - 230);
        const y = p.y + 16 > v.height - 140 ? p.y - 150 : p.y + 16;
        tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
      }
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      callbacks.current.onHover(target.target);
      setTooltip(target.target ? describeTarget(target.target, viewModelRef.current) : null);
    });
  }, []);
  useEffect(() => {
    viewModelRef.current = viewModel;
    // Data changed under a stationary pointer: refresh the tooltip text.
    hoverKey.current = "";
    if (pointerRef.current) scheduleHover();
  }, [viewModel, scheduleHover]);

  // Wheel zoom: a native non-passive listener on the canvas only, so the page still scrolls elsewhere.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-Math.max(-300, Math.min(300, delta)) * (e.ctrlKey ? 0.01 : 0.0018));
      animRef.current = null;
      cameraRef.current = zoomAt(camera, factor, e.clientX - rect.left, e.clientY - rect.top);
      requestRender();
      scheduleHover();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [requestRender, scheduleHover]);

  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const selectAt = (x: number, y: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    const { target } = renderer.pick(x, y, camera);
    if (!target) return;
    callbacks.current.onSelect(target);
    // Entities are brought to the centre; clicking plain terrain leaves the camera alone.
    const v = viewportRef.current;
    const at = (gx: number, gy: number, minZoom: number) =>
      setCamera(centerOn(camera, renderer.cellCenter(gx, gy), v, Math.max(camera.zoom, minZoom)), true);
    if (target.type === "settlement" || target.type === "building") {
      const id = target.type === "settlement" ? target.id : target.settlementId;
      const s = viewModelRef.current.settlements.find((x) => x.id === id);
      if (s) at(s.x, s.y, ZOOM.buildings + 0.25);
    } else if (target.type === "nomad") {
      const n = viewModelRef.current.nomads.find((x) => x.id === target.id);
      if (n) at(n.x, n.y, 0);
    } else if (target.type === "conflict") {
      const c = viewModelRef.current.conflicts.find((x) => x.id === target.id);
      if (c) at(Math.floor(c.anchor.x), Math.floor(c.anchor.y), 0);
    }
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-roledescription="mappa isometrica"
        aria-label={`Mappa isometrica del mondo ${viewModel.width}×${viewModel.height}. Trascina per spostare la vista, rotella o pizzico per lo zoom; frecce per muovere, + e − per lo zoom, 0 per vedere tutto, Esc per annullare la selezione.`}
        className="block h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ochre)] active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          animRef.current = null;
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            if (a && b && gesture.current) {
              gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
              gesture.current.moved = true;
            }
          } else gesture.current = { moved: false, startX: p.x, startY: p.y, pinch: null };
        }}
        onPointerMove={(e) => {
          const p = local(e);
          const prev = pointers.current.get(e.pointerId);
          const g = gesture.current;
          const camera = cameraRef.current;
          if (prev && g && camera) {
            pointers.current.set(e.pointerId, p);
            if (pointers.current.size >= 2 && g.pinch !== null) {
              const [a, b] = [...pointers.current.values()];
              if (a && b) {
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                // Half the pointer's own movement pans (the midpoint moves by half of it).
                let next = pan(camera, (p.x - prev.x) / 2, (p.y - prev.y) / 2);
                if (g.pinch > 0) next = zoomAt(next, dist / g.pinch, mid.x, mid.y);
                g.pinch = dist;
                cameraRef.current = next;
                requestRender();
              }
              return;
            }
            if (!g.moved && Math.abs(p.x - g.startX) + Math.abs(p.y - g.startY) > 5) g.moved = true;
            if (g.moved) {
              cameraRef.current = pan(camera, p.x - prev.x, p.y - prev.y);
              requestRender();
            }
          }
          if (e.pointerType === "mouse") {
            pointerRef.current = p;
            scheduleHover();
          }
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          const wasSingle = pointers.current.size === 1;
          pointers.current.delete(e.pointerId);
          if (pointers.current.size === 0) gesture.current = null;
          if (g && !g.moved && wasSingle) {
            const p = local(e);
            selectAt(p.x, p.y);
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size === 0) gesture.current = null;
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          pointerRef.current = null;
          scheduleHover();
        }}
        onKeyDown={(e) => {
          const camera = cameraRef.current;
          const renderer = rendererRef.current;
          if (!camera || !renderer) return;
          const v = viewportRef.current;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [KEY_PAN, 0],
            ArrowRight: [-KEY_PAN, 0],
            ArrowUp: [0, KEY_PAN],
            ArrowDown: [0, -KEY_PAN],
          };
          const move = moves[e.key];
          if (move) {
            e.preventDefault();
            setCamera(pan(camera, move[0], move[1]));
          } else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            setCamera(zoomAt(camera, 1.35, v.width / 2, v.height / 2), true);
          } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            setCamera(zoomAt(camera, 1 / 1.35, v.width / 2, v.height / 2), true);
          } else if (e.key === "0") {
            e.preventDefault();
            setCamera(createFittedCamera(renderer.bounds, v), true);
          } else if (e.key === "Enter" || e.key === " ") {
            // Select what is under the centre of the view.
            e.preventDefault();
            selectAt(v.width / 2, v.height / 2);
          }
        }}
      />
      <div
        ref={tooltipRef}
        role="tooltip"
        className={`border-line bg-abyss/95 pointer-events-none absolute top-0 left-0 z-10 max-w-[220px] rounded-md border px-2.5 py-1.5 text-xs shadow-lg transition-opacity ${tooltip ? "opacity-100" : "opacity-0"}`}
      >
        {tooltip && (
          <>
            <p className="text-parchment font-medium">{tooltip.title}</p>
            {tooltip.lines.map((l) => (
              <p key={l} className="text-muted">
                {l}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
});
