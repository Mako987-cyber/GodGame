import type { BiomeKind } from "./types";

export type Rgb = [number, number, number];

/** Top-face colours of the isometric atlas: natural, slightly desaturated, readable at small size. */
export const BIOME_TOP: Record<BiomeKind, string> = {
  ocean: "#24506a",
  coast: "#cdb983",
  plains: "#86a655",
  forest: "#4a7a45",
  hills: "#8f8a55",
  mountain: "#8d867c",
  desert: "#d2b06f",
  tundra: "#a9b8b1",
};

export const PALETTE = {
  background: "#0c161b",
  deepWater: "#173a50",
  shallowWater: "#3b7f8f",
  foam: "#d7ecea",
  river: "#6fb2d6",
  riverEdge: "#2f6f95",
  road: "#b89668",
  roadEdge: "#6f5638",
  street: "#cbb48a",
  field: "#d8bf62",
  fieldAlt: "#b9a04a",
  pasture: "#a7c77a",
  snow: "#eef3f2",
  rock: "#6f6860",
  trunk: "#5a4330",
  foliage: "#3f6d3c",
  foliageLight: "#5e8a4a",
  conifer: "#2f5a3c",
  plaster: "#e5d8bd",
  timber: "#9a7652",
  stone: "#b7ae9f",
  stoneDark: "#857d70",
  roofClay: "#b4583a",
  roofThatch: "#b99a5c",
  roofSlate: "#5d6670",
  tent: "#d8c7a2",
  fire: "#f0a53a",
  gold: "#e8b654",
  selection: "#f3d27a",
  hover: "#fff4d6",
  trade: "#e9c46a",
  war: "#d6543f",
  warSoft: "#f08a5d",
  label: "#f4ecd8",
  labelShadow: "rgba(8, 14, 18, 0.85)",
  grid: "rgba(255, 255, 255, 0.12)",
} as const;

export function hexToRgb(hex: string): Rgb {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join("") : clean;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToCss([r, g, b]: Rgb, alpha = 1): string {
  const R = Math.round(Math.max(0, Math.min(255, r)));
  const G = Math.round(Math.max(0, Math.min(255, g)));
  const B = Math.round(Math.max(0, Math.min(255, b)));
  return alpha >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${alpha})`;
}

export function shadeRgb(c: Rgb, factor: number): Rgb {
  return [c[0] * factor, c[1] * factor, c[2] * factor];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Shade a hex colour and return CSS. */
export function shade(hex: string, factor: number, alpha = 1): string {
  return rgbToCss(shadeRgb(hexToRgb(hex), factor), alpha);
}

export function mix(a: string, b: string, t: number, alpha = 1): string {
  return rgbToCss(mixRgb(hexToRgb(a), hexToRgb(b), t), alpha);
}

export function withAlpha(hex: string, alpha: number): string {
  return rgbToCss(hexToRgb(hex), alpha);
}

/** Roof colour of a settlement: terracotta pulled towards the owner's colour, so ownership reads at a glance. */
export function roofColor(ownerColor: string, tier: string): string {
  const base = tier === "camp" ? PALETTE.tent : tier === "village" ? PALETTE.roofThatch : PALETTE.roofClay;
  return mix(base, ownerColor, tier === "camp" ? 0.12 : 0.2);
}

/** Fertility ramp for the fertility layer, t in 0..1. */
export function fertilityColor(t: number): string {
  return mix("#8a5a3a", "#9fe06a", t);
}

export const RESOURCE_COLORS = {
  food: "#8fc15a",
  wood: "#7a5a36",
  stone: "#a8a39a",
  copper: "#d9783a",
  iron: "#aeb6bf",
  tin: "#8fd0c4",
  coal: "#3b3b42",
  clay: "#c98f6b",
  water: "#5fa8d3",
} as const;
