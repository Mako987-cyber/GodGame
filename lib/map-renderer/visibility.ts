import type { MapLayerId, MapLayerVisibility, SettlementVisualTier } from "./types";

export const DEFAULT_LAYERS: MapLayerVisibility = {
  terrain: true,
  elevation: true,
  water: true,
  rivers: true,
  settlements: true,
  buildings: true,
  resources: false,
  fertility: false,
  territories: true,
  roads: true,
  tradeRoutes: false,
  conflicts: false,
  labels: true,
  debugGrid: false,
};

export const LAYER_LABELS: Record<MapLayerId, string> = {
  terrain: "Terreno",
  elevation: "Rilievo",
  water: "Acqua e coste",
  rivers: "Fiumi",
  settlements: "Insediamenti",
  buildings: "Edifici",
  resources: "Risorse",
  fertility: "Fertilità",
  territories: "Territori",
  roads: "Strade",
  tradeRoutes: "Commercio",
  conflicts: "Conflitti e crisi",
  labels: "Nomi",
  debugGrid: "Griglia debug",
};

/**
 * Zoom thresholds (camera zoom, 1 = a tile is 64 CSS px wide). Detail appears progressively:
 * low zoom shows biomes, large territories and major cities; medium adds villages, roads and main
 * buildings; high zoom adds individual houses, resources and fields.
 */
export const ZOOM = {
  /** Below this, settlements are icons instead of building clusters. */
  buildings: 0.42,
  /** Houses of camps and villages (minor detail of small places). */
  minorBuildings: 0.7,
  /** Houses of towns and cities. */
  urbanBuildings: 0.55,
  /** Redrawing terrain in front of buildings (invisible below this). */
  occlusion: 0.6,
  roads: 0.3,
  resources: 0.55,
  /** Below this, resources are clustered instead of drawn one per cell. */
  resourceClusters: 1.1,
  trees: 0.28,
  fields: 0.35,
  regionLabels: 0.9,
} as const;

/** Minimum zoom at which a settlement's name is shown (selected or hovered ones are always labelled). */
export function labelZoomFor(tier: SettlementVisualTier): number {
  switch (tier) {
    case "capital":
      return 0;
    case "city":
      return 0.22;
    case "town":
      return 0.38;
    case "village":
      return 0.75;
    case "camp":
      return 1.3;
  }
}

/** Minimum zoom at which the settlement itself is drawn: capitals and cities are always visible. */
export function settlementZoomFor(tier: SettlementVisualTier): number {
  return tier === "camp" ? 0.3 : 0;
}

export type DetailLevel = "overview" | "regional" | "local";

export function detailLevel(zoom: number): DetailLevel {
  if (zoom < ZOOM.buildings) return "overview";
  if (zoom < ZOOM.resourceClusters) return "regional";
  return "local";
}

/** Cluster size in cells for the resource layer at a given zoom (1 = one icon per cell). */
export function resourceClusterSize(zoom: number): number {
  if (zoom >= ZOOM.resourceClusters) return 1;
  if (zoom >= 0.75) return 3;
  if (zoom >= 0.45) return 6;
  return 10;
}

export function toggleLayer(layers: MapLayerVisibility, id: MapLayerId): MapLayerVisibility {
  return { ...layers, [id]: !layers[id] };
}
