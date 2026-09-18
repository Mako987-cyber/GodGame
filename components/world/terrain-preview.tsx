"use client";

import { BIOMES, generateTerrain } from "@genesis/simulation-core";
import { useEffect, useMemo, useRef } from "react";
import { BIOME_COLORS, hexToRgb, shade } from "@/lib/client/map-palette";

/** Runs the real terrain generator in the browser: the preview is exactly the map the seed will produce. */
export function TerrainPreview({ seed, size }: { seed: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cells = useMemo(() => (seed ? generateTerrain(seed, size, size) : null), [seed, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = size;
    canvas.height = size;
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const cell = cells?.[i];
      const base = cell
        ? hexToRgb(BIOME_COLORS[BIOMES.indexOf(cell.biome)] ?? "#000000")
        : ([21, 35, 42] as [number, number, number]);
      const color = cell?.river
        ? hexToRgb("#5aa0c8")
        : cell
          ? shade(base, 0.75 + cell.altitude * 0.45)
          : base;
      image.data.set([color[0], color[1], color[2], 255], i * 4);
    }
    ctx.putImageData(image, 0, 0);
  }, [cells, size]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={seed ? `Anteprima della mappa per il seed ${seed}` : "Anteprima della mappa"}
      className="border-line aspect-square w-full rounded-md border [image-rendering:pixelated]"
    />
  );
}
