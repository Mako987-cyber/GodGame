/**
 * Common contract of the map renderers, so the canvas component can host either of them:
 * - `hex`: the default hexagonal strategy map;
 * - `isometric`: the legacy 2:1 isometric map, kept as an alternative while the hex view matures.
 * (The technical top-down map is a separate React component and does not use this contract.)
 */
import type { Viewport } from "./camera";
import type { HitTarget } from "./hit-testing";
import { HexRenderer } from "./hex/hex-renderer";
import type { FrameStats } from "./performance";
import type { CameraState, Point, Rect } from "./projection";
import { IsometricRenderer, type RenderOptions, type RenderResult } from "./renderer";
import type { IsometricMapViewModel } from "./types";

export type { RenderOptions, RenderResult };

export type CanvasRendererKind = "hex" | "isometric";

export interface MapRenderer {
  /** World-space bounds of the whole map. */
  readonly bounds: Rect;
  readonly stats: FrameStats;
  /** True when `vm` is the same world (size and seed) and can be applied incrementally. */
  accepts(vm: IsometricMapViewModel): boolean;
  setViewModel(vm: IsometricMapViewModel): void;
  render(opts: RenderOptions): RenderResult;
  pick(screenX: number, screenY: number, camera: CameraState): { target: HitTarget | null; ms: number };
  recordHitTest(ms: number): void;
  /** World-space centre of a cell (camera centring). */
  cellCenter(x: number, y: number): Point;
  /** Keeps the view over the map. */
  clampCamera(camera: CameraState, viewport: Viewport): CameraState;
  dispose(): void;
}

export function createMapRenderer(
  kind: CanvasRendererKind,
  canvas: HTMLCanvasElement,
  vm: IsometricMapViewModel,
): MapRenderer {
  return kind === "hex" ? new HexRenderer(canvas, vm) : new IsometricRenderer(canvas, vm);
}
