/**
 * 2:1 isometric projection.
 *
 * Grid space: cell (x, y) covers [x, x+1] × [y, y+1]; its centre is (x + 0.5, y + 0.5).
 * World space: projected pixels at zoom 1, before the camera transform.
 * Screen space: CSS pixels inside the canvas, `screen = world * zoom + (camera.x, camera.y)`.
 */

export interface IsoProjectionConfig {
  tileWidth: number;
  tileHeight: number;
  /** World pixels per terrace level. */
  elevationStep: number;
  originX: number;
  originY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraState {
  /** Screen position of the world origin (CSS pixels). */
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
}

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const ELEVATION_STEP = 6;
export const MAX_ELEVATION = 7;
/** Extra headroom above a tile for peaks, trees and buildings (world pixels). */
export const DECORATION_HEADROOM = 56;

/** Projection for a map of the given size; the origin keeps every tile at non-negative world x. */
export function createProjection(width: number, height: number): IsoProjectionConfig {
  return {
    tileWidth: TILE_WIDTH,
    tileHeight: TILE_HEIGHT,
    elevationStep: ELEVATION_STEP,
    originX: height * (TILE_WIDTH / 2),
    originY: MAX_ELEVATION * ELEVATION_STEP + DECORATION_HEADROOM,
  };
}

export function gridToScreen(
  gridX: number,
  gridY: number,
  elevation: number,
  config: IsoProjectionConfig,
): Point {
  return {
    x: config.originX + ((gridX - gridY) * config.tileWidth) / 2,
    y: config.originY + ((gridX + gridY) * config.tileHeight) / 2 - elevation * config.elevationStep,
  };
}

/** Inverse of `gridToScreen` on the ground plane (elevation 0), in world pixels. */
export function worldToGrid(worldX: number, worldY: number, config: IsoProjectionConfig): Point {
  const a = (worldX - config.originX) / (config.tileWidth / 2);
  const b = (worldY - config.originY) / (config.tileHeight / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function screenToWorld(screenX: number, screenY: number, camera: CameraState): Point {
  return { x: (screenX - camera.x) / camera.zoom, y: (screenY - camera.y) / camera.zoom };
}

export function worldToScreen(worldX: number, worldY: number, camera: CameraState): Point {
  return { x: worldX * camera.zoom + camera.x, y: worldY * camera.zoom + camera.y };
}

/**
 * Screen point to continuous grid coordinates on the ground plane, or null outside the map.
 * Elevation-aware picking (a raised tile covering the cell behind it) lives in `hit-testing.ts`.
 */
export function screenToGrid(
  screenX: number,
  screenY: number,
  camera: CameraState,
  config: IsoProjectionConfig,
  bounds?: { width: number; height: number },
): Point | null {
  const world = screenToWorld(screenX, screenY, camera);
  const grid = worldToGrid(world.x, world.y, config);
  if (!Number.isFinite(grid.x) || !Number.isFinite(grid.y)) return null;
  if (bounds && (grid.x < 0 || grid.y < 0 || grid.x >= bounds.width || grid.y >= bounds.height)) return null;
  return grid;
}

/** The four corners of a tile's top face: top, right, bottom, left. */
export function tileCorners(
  x: number,
  y: number,
  elevation: number,
  config: IsoProjectionConfig,
): [Point, Point, Point, Point] {
  return [
    gridToScreen(x, y, elevation, config),
    gridToScreen(x + 1, y, elevation, config),
    gridToScreen(x + 1, y + 1, elevation, config),
    gridToScreen(x, y + 1, elevation, config),
  ];
}

/** World-space bounds of the whole map, including terrace walls and decoration headroom. */
export function mapWorldBounds(width: number, height: number, config: IsoProjectionConfig): Rect {
  const left = gridToScreen(0, height, 0, config).x;
  const right = gridToScreen(width, 0, 0, config).x;
  const top = gridToScreen(0, 0, MAX_ELEVATION, config).y - DECORATION_HEADROOM;
  const bottom = gridToScreen(width, height, 0, config).y + config.elevationStep * 2;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Screen-space point-in-diamond test for a tile's top face. */
export function pointInTile(
  worldX: number,
  worldY: number,
  x: number,
  y: number,
  elevation: number,
  config: IsoProjectionConfig,
): boolean {
  const c = gridToScreen(x + 0.5, y + 0.5, elevation, config);
  const dx = Math.abs(worldX - c.x) / (config.tileWidth / 2);
  const dy = Math.abs(worldY - c.y) / (config.tileHeight / 2);
  return dx + dy <= 1;
}
