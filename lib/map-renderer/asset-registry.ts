/**
 * Asset registry.
 *
 * Every visual has a procedural implementation, so the map never depends on external files.
 * A sprite can be registered for any id (e.g. from a spritesheet in `public/assets/map/`); when it
 * is present and loaded it replaces the procedural drawing, otherwise the fallback is used.
 */
import {
  drawBarracks,
  drawCampfire,
  drawFoundry,
  drawHall,
  drawHouse,
  drawHut,
  drawKiln,
  drawLargeHouse,
  drawMarket,
  drawMine,
  drawPalace,
  drawPort,
  drawQuarry,
  drawRuin,
  drawTemple,
  drawTent,
  drawTower,
  drawWarehouse,
  drawWell,
  type BuildingStyle,
} from "./building-renderer";
import type { BuildingKind } from "./settlement-layout";

export type AssetId = `building:${BuildingKind}`;

export type ProceduralDraw = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  style: BuildingStyle,
) => void;

/** Image-backed sprite; (anchorX, anchorY) is the ground point inside the image, in image pixels. */
export interface SpriteAsset {
  kind: "sprite";
  image: CanvasImageSource & { width: number; height: number };
  /** Source rectangle inside a spritesheet (defaults to the whole image). */
  frame?: { x: number; y: number; width: number; height: number };
  anchorX: number;
  anchorY: number;
  /** World pixels per image pixel at size 1. */
  scale: number;
}

export interface ProceduralAsset {
  kind: "procedural";
  draw: ProceduralDraw;
}

export type TextureOrProceduralAsset = SpriteAsset | ProceduralAsset;

export interface AssetRegistry {
  get(assetId: AssetId): TextureOrProceduralAsset;
  has(assetId: AssetId): boolean;
  register(assetId: AssetId, sprite: SpriteAsset): void;
}

const PROCEDURAL: Record<BuildingKind, ProceduralDraw> = {
  tent: drawTent,
  campfire: (ctx, x, y, s) => drawCampfire(ctx, x, y, s),
  hut: drawHut,
  house: drawHouse,
  "house-large": drawLargeHouse,
  hall: drawHall,
  palace: drawPalace,
  warehouse: drawWarehouse,
  market: drawMarket,
  temple: drawTemple,
  well: (ctx, x, y, s) => drawWell(ctx, x, y, s),
  kiln: (ctx, x, y, s) => drawKiln(ctx, x, y, s),
  foundry: drawFoundry,
  barracks: drawBarracks,
  tower: drawTower,
  mine: (ctx, x, y, s) => drawMine(ctx, x, y, s),
  quarry: (ctx, x, y, s) => drawQuarry(ctx, x, y, s),
  port: drawPort,
  ruin: (ctx, x, y, s, st) => drawRuin(ctx, x, y, s, st.variant),
};

/** Placeholder drawn for an id nobody implements: a neutral box, never a crash. */
const MISSING: ProceduralAsset = {
  kind: "procedural",
  draw: (ctx, x, y, s, st) => drawHouse(ctx, x, y, s, st),
};

function isUsable(sprite: SpriteAsset): boolean {
  const img = sprite.image as { complete?: boolean; naturalWidth?: number };
  if (img.complete === false) return false;
  if (img.naturalWidth === 0) return false;
  return sprite.image.width > 0 && sprite.image.height > 0;
}

export function createAssetRegistry(): AssetRegistry {
  const sprites = new Map<AssetId, SpriteAsset>();
  return {
    has: (id) => sprites.has(id) || id.slice("building:".length) in PROCEDURAL,
    register: (id, sprite) => {
      sprites.set(id, sprite);
    },
    get: (id) => {
      const sprite = sprites.get(id);
      if (sprite && isUsable(sprite)) return sprite;
      // Ids come from untyped sources too (manifests): an unknown one gets the placeholder.
      const draw = (PROCEDURAL as Partial<Record<string, ProceduralDraw>>)[id.slice("building:".length)];
      return draw ? { kind: "procedural", draw } : MISSING;
    },
  };
}

/**
 * Registry used by the map by default. Register sprites on it (e.g. at app start-up): once an image
 * has loaded, the map uses it from the next frame it draws.
 */
export const sharedAssetRegistry: AssetRegistry = createAssetRegistry();

/** Draws an asset at a ground anchor: sprites when available, procedural geometry otherwise. */
export function drawAsset(
  ctx: CanvasRenderingContext2D,
  asset: TextureOrProceduralAsset,
  x: number,
  y: number,
  size: number,
  style: BuildingStyle,
) {
  if (asset.kind === "procedural") {
    asset.draw(ctx, x, y, size, style);
    return;
  }
  const f = asset.frame ?? { x: 0, y: 0, width: asset.image.width, height: asset.image.height };
  const k = asset.scale * (size / 0.1);
  ctx.drawImage(
    asset.image,
    f.x,
    f.y,
    f.width,
    f.height,
    x - asset.anchorX * k,
    y - asset.anchorY * k,
    f.width * k,
    f.height * k,
  );
}
