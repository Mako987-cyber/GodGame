import { describe, expect, it } from "vitest";
import {
  createAssetRegistry,
  drawAsset,
  type AssetId,
  type SpriteAsset,
} from "@/lib/map-renderer/asset-registry";

/** Minimal 2D context that records calls: enough to run the procedural drawers in Node. */
function recordingContext() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_, prop: string) => {
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
        if (prop === "measureText") return () => ({ width: 10 });
        return () => {
          calls.push(prop);
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const style = { owner: "#6d8fb0", roof: "#b4583a", wall: "#e5d8bd", variant: 0.3 };
const ids: AssetId[] = [
  "building:house",
  "building:palace",
  "building:tower",
  "building:market",
  "building:mine",
  "building:port",
];

describe("registry degli asset", () => {
  it("senza sprite usa il disegno procedurale per ogni edificio", () => {
    const registry = createAssetRegistry();
    for (const id of ids) {
      expect(registry.has(id)).toBe(true);
      const asset = registry.get(id);
      expect(asset.kind).toBe("procedural");
      const { ctx, calls } = recordingContext();
      drawAsset(ctx, asset, 100, 100, 0.1, style);
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  it("usa lo sprite registrato solo quando l'immagine è caricata", () => {
    const registry = createAssetRegistry();
    const image = {
      width: 32,
      height: 32,
      complete: false,
      naturalWidth: 0,
    } as unknown as SpriteAsset["image"];
    const sprite: SpriteAsset = { kind: "sprite", image, anchorX: 16, anchorY: 28, scale: 1 };
    registry.register("building:house", sprite);
    expect(registry.get("building:house").kind).toBe("procedural");
    Object.assign(image, { complete: true, naturalWidth: 32 });
    expect(registry.get("building:house")).toBe(sprite);
    const { ctx, calls } = recordingContext();
    drawAsset(ctx, sprite, 50, 50, 0.1, style);
    expect(calls).toEqual(["drawImage"]);
  });

  it("un id sconosciuto ricade su un segnaposto invece di rompere il rendering", () => {
    const registry = createAssetRegistry();
    const asset = registry.get("building:unknown" as AssetId);
    expect(asset.kind).toBe("procedural");
    const { ctx, calls } = recordingContext();
    expect(() => drawAsset(ctx, asset, 0, 0, 0.1, style)).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });
});
