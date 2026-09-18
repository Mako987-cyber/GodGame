"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { WorldDetail } from "@/lib/dto";
import { BIOME_LABELS } from "@/lib/client/format";
import { BIOME_COLORS } from "@/lib/client/map-palette";
import { OVERLAY_LABELS, useWorldUi, type Overlay } from "@/lib/client/store";
import { drawMap, type View } from "./map-renderer";

const OVERLAYS: { value: Overlay; label: string }[] = (Object.keys(OVERLAY_LABELS) as Overlay[]).map(
  (value) => ({ value, label: OVERLAY_LABELS[value] }),
);

const MIN_SCALE = 1;
const MAX_SCALE = 8;

function clampView(view: View, size: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const extent = size * scale;
  return {
    scale,
    offsetX: Math.min(0, Math.max(size - extent, view.offsetX)),
    offsetY: Math.min(0, Math.max(size - extent, view.offsetY)),
  };
}

export function WorldMap({ detail }: { detail: WorldDetail }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [view, setView] = useState<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const { overlay, setOverlay, selection, select, focus } = useWorldUi();
  const { width, height } = detail.world;
  const cellSize = size ? (size / Math.max(width, height)) * view.scale : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame = requestAnimationFrame(() =>
      drawMap(ctx, detail, { overlay, view, cssSize: size, selection, focus }),
    );
    return () => cancelAnimationFrame(frame);
  }, [detail, overlay, view, size, selection, focus]);

  // Centre on an event's location when the timeline requests it (state adjusted during render, not in an effect).
  const [appliedFocus, setAppliedFocus] = useState<number | null>(null);
  if (focus && size && focus.nonce !== appliedFocus) {
    setAppliedFocus(focus.nonce);
    const scale = Math.max(view.scale, 2.5);
    const cell = (size / Math.max(width, height)) * scale;
    setView(
      clampView(
        { scale, offsetX: size / 2 - (focus.x + 0.5) * cell, offsetY: size / 2 - (focus.y + 0.5) * cell },
        size,
      ),
    );
  }

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        return clampView(
          { scale, offsetX: px - (px - v.offsetX) * k, offsetY: py - (py - v.offsetY) * k },
          size,
        );
      });
    },
    [size],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Native listener: React's wheel handler is passive and cannot prevent page scroll.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const cellAtPoint = (px: number, py: number) => {
    if (!cellSize) return null;
    const x = Math.floor((px - view.offsetX) / cellSize);
    const y = Math.floor((py - view.offsetY) / cellSize);
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  };

  const selectAt = (x: number, y: number) => {
    const settlement = detail.settlements.find((s) => s.x === x && s.y === y && s.status === "active");
    if (settlement) return select({ kind: "settlement", id: settlement.id });
    const band = detail.tribes.find(
      (t) => t.status === "nomadic" && t.population > 0 && t.x === x && t.y === y,
    );
    if (band) return select({ kind: "tribe", id: band.id });
    select({ kind: "cell", x, y });
  };

  const hoverIndex = hover ? hover.y * width + hover.x : -1;
  const hoverOwner = hover ? detail.tribes[detail.map.owner[hoverIndex] ?? -1] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs label="Livello della mappa" items={OVERLAYS} value={overlay} onChange={setOverlay} />
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Aumenta zoom"
            onClick={() => zoomAt(1.4, size / 2, size / 2)}
          >
            <Plus />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Riduci zoom"
            onClick={() => zoomAt(1 / 1.4, size / 2, size / 2)}
          >
            <Minus />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Mostra tutta la mappa"
            onClick={() => setView({ scale: 1, offsetX: 0, offsetY: 0 })}
          >
            <Scan />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="relative w-full">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Mappa del mondo ${width}×${height}. Trascina per spostare, rotella o +/− per lo zoom, frecce per muovere la vista.`}
          style={{ width: size, height: size }}
          className="border-line block cursor-crosshair touch-none rounded-md border"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY, moved: false };
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const d = drag.current;
            if (d) {
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
              if (d.moved) setView((v) => clampView({ ...v, offsetX: d.ox + dx, offsetY: d.oy + dy }, size));
            }
            const c = cellAtPoint(px, py);
            setHover(c ? { ...c, px, py } : null);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const c = cellAtPoint(e.clientX - rect.left, e.clientY - rect.top);
            if (c) selectAt(c.x, c.y);
          }}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            const step = 40;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [step, 0],
              ArrowRight: [-step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const move = moves[e.key];
            if (move) {
              e.preventDefault();
              setView((v) =>
                clampView({ ...v, offsetX: v.offsetX + move[0], offsetY: v.offsetY + move[1] }, size),
              );
            } else if (e.key === "+" || e.key === "=") zoomAt(1.4, size / 2, size / 2);
            else if (e.key === "-") zoomAt(1 / 1.4, size / 2, size / 2);
          }}
        />
        {hover && (
          <div
            className="border-line bg-abyss/95 pointer-events-none absolute z-10 rounded-md border px-2 py-1 text-xs shadow-lg"
            style={{ left: Math.min(hover.px + 14, size - 170), top: Math.min(hover.py + 14, size - 60) }}
          >
            <p className="text-parchment">
              {BIOME_LABELS[detail.map.biome[hoverIndex] ?? 0]} ({hover.x}, {hover.y})
            </p>
            <p className="text-muted">
              {detail.map.riverNames[hoverIndex] ? `Fiume ${detail.map.riverNames[hoverIndex]} · ` : ""}
              {hoverOwner ? `Territorio ${hoverOwner.name}` : "Terra libera"}
            </p>
          </div>
        )}
      </div>
      <MapLegend overlay={overlay} />
    </div>
  );
}

function MapLegend({ overlay }: { overlay: Overlay }) {
  if (overlay === "biome") {
    return (
      <ul className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legenda biomi">
        {BIOME_LABELS.map((label, i) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: BIOME_COLORS[i] }} />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-[#4f8fb5]" />
          Fiume
        </li>
        <MarkerLegend />
      </ul>
    );
  }
  const ramps: Partial<Record<Overlay, [string, string, string, string]>> = {
    fertility: ["#3b3326", "#a8cf6c", "Terra sterile", "Molto fertile"],
    water: ["#3a3228", "#5fa8d3", "Terra arida", "Acqua abbondante"],
    resources: ["#2c2a22", "#d6b25a", "Risorse esaurite", "Selvaggina e legname abbondanti"],
  };
  const r = ramps[overlay];
  return (
    <div className="text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {r && (
        <span className="flex items-center gap-2">
          {r[2]}
          <span
            className="h-2.5 w-28 rounded-sm"
            style={{ background: `linear-gradient(90deg, ${r[0]}, ${r[1]})` }}
          />
          {r[3]}
        </span>
      )}
      {overlay === "resources" && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#e07b39]" /> Rame
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#b8bcc2]" /> Ferro
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#9fd3c7]" /> Stagno
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#4d4d55]" /> Carbone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#c98f6b]" /> Argilla
          </span>
        </>
      )}
      {overlay === "population" && <span>Aloni più grandi e luminosi indicano più abitanti.</span>}
      {overlay === "borders" && <span>Ogni colore è il territorio di una tribù.</span>}
      {overlay === "culture" && <span>La tinta indica la tribù che esercita influenza sulla cella.</span>}
      {overlay === "trade" && (
        <span>Linee tratteggiate azzurre: rotte commerciali attive, più spesse se più intense.</span>
      )}
      {overlay === "conflicts" && (
        <span>
          Linee rosse: guerre in corso; arancioni: forte ostilità. I cerchi segnalano le crisi attive.
        </span>
      )}
      {overlay === "infrastructure" && (
        <span>
          Righe gialle: campi. Punti verdi: pascoli. Linee chiare: strade. Cornice: palizzata o mura.
        </span>
      )}
      <ul className="flex gap-4">
        <MarkerLegend />
      </ul>
    </div>
  );
}

function MarkerLegend() {
  return (
    <>
      <li className="flex items-center gap-1.5">
        <span className="bg-parchment size-3" /> Insediamento
      </li>
      <li className="flex items-center gap-1.5">
        <span className="bg-parchment size-3 rounded-full" /> Tribù nomade
      </li>
    </>
  );
}
