import {
  gridToScreen,
  worldToGrid,
  type CameraState,
  type IsoProjectionConfig,
  type Point,
  type Rect,
} from "./projection";

export interface Viewport {
  width: number;
  height: number;
}

export const ABSOLUTE_MAX_ZOOM = 3.2;

/** Zoom that fits `bounds` inside the viewport with a margin. */
export function fitZoom(bounds: Rect, viewport: Viewport, padding = 24): number {
  const w = Math.max(1, viewport.width - padding * 2);
  const h = Math.max(1, viewport.height - padding * 2);
  return Math.min(w / bounds.width, h / bounds.height);
}

/**
 * Camera centred on the map; zoom limits adapt to the map size. `contain` shows the whole map,
 * `cover` fills the viewport (the map-first opening view), still allowing to zoom out to `contain`.
 */
export function createFittedCamera(
  bounds: Rect,
  viewport: Viewport,
  mode: "contain" | "cover" = "contain",
): CameraState {
  const contain = fitZoom(bounds, viewport);
  const cover = Math.max(viewport.width / bounds.width, viewport.height / bounds.height);
  const zoom = mode === "cover" ? Math.max(contain, cover) : contain;
  const camera: CameraState = {
    x: 0,
    y: 0,
    zoom,
    minZoom: Math.min(contain * 0.75, 1),
    maxZoom: Math.max(ABSOLUTE_MAX_ZOOM, zoom * 2),
  };
  return centerOn(camera, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, viewport);
}

/** Moves the camera so the world point sits at the centre of the viewport. */
export function centerOn(
  camera: CameraState,
  world: Point,
  viewport: Viewport,
  zoom = camera.zoom,
): CameraState {
  const z = clampZoom(zoom, camera);
  return { ...camera, zoom: z, x: viewport.width / 2 - world.x * z, y: viewport.height / 2 - world.y * z };
}

export function clampZoom(zoom: number, camera: Pick<CameraState, "minZoom" | "maxZoom">): number {
  return Math.min(camera.maxZoom, Math.max(camera.minZoom, zoom));
}

export function pan(camera: CameraState, dx: number, dy: number): CameraState {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/** Zooms by `factor` keeping the world point under (screenX, screenY) fixed. */
export function zoomAt(camera: CameraState, factor: number, screenX: number, screenY: number): CameraState {
  const zoom = clampZoom(camera.zoom * factor, camera);
  const k = zoom / camera.zoom;
  return { ...camera, zoom, x: screenX - (screenX - camera.x) * k, y: screenY - (screenY - camera.y) * k };
}

/**
 * Keeps the map reachable: the viewport centre is kept over the map's diamond on the ground plane
 * (0..width × 0..height on the ground plane), so the view can never drift into the empty corners
 * of the map's bounding rectangle.
 */
export function clampCameraToGrid(
  camera: CameraState,
  viewport: Viewport,
  config: IsoProjectionConfig,
  width: number,
  height: number,
): CameraState {
  const zoom = clampZoom(camera.zoom, camera);
  const centre = { x: (viewport.width / 2 - camera.x) / zoom, y: (viewport.height / 2 - camera.y) / zoom };
  const g = worldToGrid(centre.x, centre.y, config);
  const gx = Math.min(width, Math.max(0, g.x));
  const gy = Math.min(height, Math.max(0, g.y));
  if (gx === g.x && gy === g.y && zoom === camera.zoom) return camera;
  const w = gridToScreen(gx, gy, 0, config);
  return { ...camera, zoom, x: viewport.width / 2 - w.x * zoom, y: viewport.height / 2 - w.y * zoom };
}

/** Visible world rectangle for the current camera. */
export function visibleWorldRect(camera: CameraState, viewport: Viewport): Rect {
  return {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  };
}

/** World point at the centre of the viewport. */
export function cameraCenter(camera: CameraState, viewport: Viewport): Point {
  return {
    x: (viewport.width / 2 - camera.x) / camera.zoom,
    y: (viewport.height / 2 - camera.y) / camera.zoom,
  };
}

/**
 * Interpolates between two cameras, t in 0..1: the viewed centre moves linearly and the zoom
 * geometrically, so a fly-to never drifts sideways while zooming.
 */
export function lerpCamera(from: CameraState, to: CameraState, t: number, viewport: Viewport): CameraState {
  const k = Math.max(0, Math.min(1, t));
  const a = cameraCenter(from, viewport);
  const b = cameraCenter(to, viewport);
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, k);
  const center = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  return { ...to, zoom, x: viewport.width / 2 - center.x * zoom, y: viewport.height / 2 - center.y * zoom };
}

/** Keeps the viewport centre inside a world rectangle (maps without a projected diamond, e.g. hex). */
export function clampCameraToRect(camera: CameraState, viewport: Viewport, rect: Rect): CameraState {
  const zoom = clampZoom(camera.zoom, camera);
  const c = { x: (viewport.width / 2 - camera.x) / zoom, y: (viewport.height / 2 - camera.y) / zoom };
  const x = Math.min(rect.x + rect.width, Math.max(rect.x, c.x));
  const y = Math.min(rect.y + rect.height, Math.max(rect.y, c.y));
  if (x === c.x && y === c.y && zoom === camera.zoom) return camera;
  return { ...camera, zoom, x: viewport.width / 2 - x * zoom, y: viewport.height / 2 - y * zoom };
}
