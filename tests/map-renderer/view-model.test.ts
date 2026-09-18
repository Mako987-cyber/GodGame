import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemorySimulationLock } from "@/lib/db/lock";
import type { Database } from "@/lib/db";
import type { WorldDetail } from "@/lib/dto";
import { buildIsometricMapViewModel, describeTarget } from "@/lib/map-renderer";
import { countRawBorderEdges } from "@/lib/map-renderer/border-renderer";
import { buildSettlementLayout } from "@/lib/map-renderer/settlement-layout";
import { elevationLevel, visualTier } from "@/lib/map-renderer/view-model";
import { MAX_ELEVATION } from "@/lib/map-renderer/projection";
import {
  createWorldService,
  getWorldDetailService,
  simulateWorldService,
} from "@/lib/services/world-service";
import { createTestDb } from "../db-helpers";

let db: Database;
let close: () => Promise<void>;
let detail: WorldDetail;

// A real world, generated and simulated by the engine: the adapter is tested on actual API data.
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const lock = new InMemorySimulationLock();
  const world = await createWorldService(
    { name: "Mappa", seed: "iso-test", width: 32, height: 32 },
    { db, lock },
  );
  for (let k = 0; k < 2; k++) await simulateWorldService(world.id, 100, { db, lock });
  detail = await getWorldDetailService(world.id, { db });
}, 120_000);
afterAll(async () => {
  await close();
});

describe("elevazione e livelli visivi", () => {
  it("acqua a 0, terra da 1 a MAX_ELEVATION, crescente con l'altitudine", () => {
    expect(elevationLevel("ocean", 0.2)).toBe(0);
    expect(elevationLevel("coast", 0.36)).toBe(1);
    expect(elevationLevel("plains", 0.35)).toBe(1);
    expect(elevationLevel("mountain", 1)).toBe(MAX_ELEVATION);
    expect(elevationLevel("hills", 0.7)).toBeGreaterThan(elevationLevel("plains", 0.45));
  });

  it("mappa i tier della simulazione sulle classi visive", () => {
    expect(visualTier("camp", false)).toBe("camp");
    expect(visualTier("village", false)).toBe("village");
    expect(visualTier("town", false)).toBe("town");
    expect(visualTier("city_state", false)).toBe("city");
    expect(visualTier("capital", false)).toBe("capital");
    expect(visualTier("town", true)).toBe("capital");
  });
});

describe("adapter WorldDetail → view model (dati reali)", () => {
  it("una cella per posizione, con biomi ed elevazioni coerenti", () => {
    const vm = buildIsometricMapViewModel(detail);
    expect(vm.cells.length).toBe(detail.world.width * detail.world.height);
    vm.cells.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.x + c.y * vm.width).toBe(i);
      expect(c.elevation === 0).toBe(c.biome === "ocean");
    });
  });

  it("insediamenti, regioni e capitali derivano dallo stato reale", () => {
    const vm = buildIsometricMapViewModel(detail);
    expect(vm.settlements.length).toBe(detail.settlements.length);
    const owned = vm.cells.filter((c) => c.region >= 0).length;
    expect(vm.regions.reduce((s, r) => s + r.cellCount, 0)).toBe(owned);
    for (const civ of detail.civilizations.filter((c) => c.status === "active" && c.capitalSettlementId)) {
      const capital = vm.settlements.find((s) => s.id === civ.capitalSettlementId);
      if (capital?.status === "active") expect(capital.tier).toBe("capital");
    }
    // Tribes of the same active civilization share one region.
    for (const civ of detail.civilizations.filter((c) => c.status === "active")) {
      const regions = vm.regions.filter((r) => r.kind === "civilization" && r.id === civ.id);
      expect(regions.length).toBe(1);
    }
  });

  it("i confini uniti non superano mai i lati di cella di partenza", () => {
    const vm = buildIsometricMapViewModel(detail);
    const raw = countRawBorderEdges({
      width: vm.width,
      height: vm.height,
      owner: vm.cells.map((c) => c.region),
      elevation: vm.cells.map((c) => c.elevation),
    });
    expect(vm.borders.length).toBeLessThanOrEqual(raw);
  });

  it("le rotte commerciali sono limitate alle principali, in ordine di volume", () => {
    const vm = buildIsometricMapViewModel(detail, { maxTradeRoutes: 3 });
    expect(vm.tradeRoutes.length).toBeLessThanOrEqual(3);
    for (let k = 1; k < vm.tradeRoutes.length; k++) {
      expect(vm.tradeRoutes[k - 1]!.volume).toBeGreaterThanOrEqual(vm.tradeRoutes[k]!.volume);
    }
  });

  it("è deterministico: stessi dati, stesso view model e stessi layout", () => {
    const a = buildIsometricMapViewModel(detail);
    const b = buildIsometricMapViewModel(detail);
    expect(b).toEqual(a);
    const terrain = {
      width: a.width,
      height: a.height,
      buildable: (x: number, y: number) => a.cells[y * a.width + x]?.biome !== "ocean",
      isWater: (x: number, y: number) => a.cells[y * a.width + x]?.biome === "ocean",
      isRocky: () => false,
    };
    for (const s of a.settlements) {
      expect(buildSettlementLayout(s, a.seed, terrain)).toEqual(buildSettlementLayout(s, b.seed, terrain));
    }
  });

  it("descrive celle e insediamenti per i tooltip", () => {
    const vm = buildIsometricMapViewModel(detail);
    const land = vm.cells.find((c) => c.biome !== "ocean")!;
    const cell = describeTarget({ type: "cell", x: land.x, y: land.y }, vm);
    expect(cell?.lines).toContain(`Coordinate: ${land.x}, ${land.y}`);
    expect(cell?.lines.some((l) => l.startsWith("Fertilità: "))).toBe(true);
    const s = vm.settlements.find((x) => x.status === "active");
    if (s) {
      const d = describeTarget({ type: "settlement", id: s.id }, vm);
      expect(d?.title).toBe(s.name);
      expect(d?.lines.some((l) => l.startsWith("Popolazione: "))).toBe(true);
      expect(d?.lines.some((l) => l.startsWith("Tipo: "))).toBe(true);
    }
  });
});
