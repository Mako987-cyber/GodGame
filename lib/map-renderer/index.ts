export * from "./types";
export * from "./projection";
export * from "./camera";
export { IsometricRenderer, type RenderOptions, type RenderResult } from "./renderer";
export { HexRenderer } from "./hex/hex-renderer";
export { HexGrid, HEX_SIZE, MAP_OFFSET_LAYOUT, MAP_ORIENTATION } from "./hex/geometry";
export { createMapRenderer, type CanvasRendererKind, type MapRenderer } from "./map-renderer";
export { buildIsometricMapViewModel, type MapViewOptions } from "./view-model";
export { DEFAULT_LAYERS, LAYER_LABELS, ZOOM, toggleLayer } from "./visibility";
export { describeTarget, type TargetDescription } from "./describe";
export { targetKey, type HitTarget } from "./hit-testing";
export type { FrameStats } from "./performance";
export {
  createAssetRegistry,
  sharedAssetRegistry,
  type AssetId,
  type AssetRegistry,
  type SpriteAsset,
} from "./asset-registry";
