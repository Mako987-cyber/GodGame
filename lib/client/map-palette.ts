/** Muted atlas palette, indexed like BIOMES in the simulation core. */
export const BIOME_COLORS = [
  "#1d3a4a", // oceano
  "#b3a476", // costa
  "#7d9a5a", // pianura
  "#3f6b45", // foresta
  "#8c7c57", // collina
  "#9b968f", // montagna
  "#c9a96b", // deserto
  "#b7c3c1", // tundra
] as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb([r, g, b]: [number, number, number], alpha = 1): string {
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function shade(color: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.min(255, color[0] * factor),
    Math.min(255, color[1] * factor),
    Math.min(255, color[2] * factor),
  ];
}

/** Two-stop ramp between colors (t in 0..1). */
export function ramp(from: string, to: string, t: number): [number, number, number] {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
