"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { FrameStats } from "@/lib/map-renderer";

export interface MapDebugPanelHandle {
  update: (stats: FrameStats) => void;
}

/** Performance readout. Updated imperatively (a few times per second), never through React state. */
export const MapDebugPanel = forwardRef<MapDebugPanelHandle>(function MapDebugPanel(_, ref) {
  const pre = useRef<HTMLPreElement>(null);
  useImperativeHandle(ref, () => ({
    update: (s) => {
      if (!pre.current) return;
      pre.current.textContent = [
        `FPS          ${s.fps || "—"}`,
        `frame        ${s.frameMs.toFixed(1)} ms`,
        `tile visibili ${s.visibleTiles} / ${s.totalTiles}`,
        `entità       ${s.entities}`,
        `chunk vis.   ${s.visibleChunks} (cache ${s.cachedChunks}, +${s.chunkBuilds})`,
        `zoom         ${s.zoom.toFixed(2)}`,
        `hit test     ${s.hitTestMs.toFixed(2)} ms`,
      ].join("\n");
    },
  }));
  return (
    <pre
      ref={pre}
      aria-label="Statistiche di rendering"
      className="hud-glass text-muted pointer-events-none rounded-md px-2 py-1.5 font-mono text-[11px] leading-4"
    >
      In attesa del primo frame…
    </pre>
  );
});
