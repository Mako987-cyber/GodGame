import type { SettlementViewModel } from "@/lib/map-renderer";
import type { LayoutTerrain } from "@/lib/map-renderer/settlement-layout";
import type { MapCellViewModel } from "@/lib/map-renderer/types";

/** Flat land cell for synthetic grids used by unit tests. */
export function cell(
  x: number,
  y: number,
  width: number,
  over: Partial<MapCellViewModel> = {},
): MapCellViewModel {
  return {
    x,
    y,
    index: y * width + x,
    biome: "plains",
    altitude: 0.5,
    elevation: 1,
    temperature: 0.6,
    moisture: 0.5,
    fertility: 0.6,
    water: 0.5,
    river: false,
    riverName: null,
    coastal: false,
    road: false,
    fields: 0,
    pastures: 0,
    wood: 20,
    stone: 15,
    fauna: 10,
    maxFauna: 22,
    copper: 0,
    iron: 0,
    tin: 0,
    coal: 0,
    clay: 0,
    region: -1,
    tribe: -1,
    settlement: -1,
    noise: 0.5,
    ...over,
  };
}

export function grid(
  width: number,
  height: number,
  over: (x: number, y: number) => Partial<MapCellViewModel> = () => ({}),
) {
  const out: MapCellViewModel[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.push(cell(x, y, width, over(x, y)));
  return out;
}

export function settlement(over: Partial<SettlementViewModel> = {}): SettlementViewModel {
  return {
    id: "s1",
    name: "Namar",
    x: 10,
    y: 10,
    tier: "village",
    rawTier: "village",
    level: 2,
    status: "active",
    population: 120,
    buildings: { hut: 4, storehouse: 1, well: 1 },
    construction: null,
    isCapital: false,
    epidemic: false,
    tribeId: "t1",
    tribeName: "Arven",
    civilizationId: null,
    civilizationName: null,
    color: "#6d8fb0",
    food: 824,
    stability: 71,
    techs: ["Agricoltura", "Ceramica"],
    foundedYear: -9000,
    abandonedYear: null,
    nearWater: false,
    ...over,
  };
}

/** Open land everywhere, water on the column x = 0. */
export const OPEN_TERRAIN: LayoutTerrain = {
  width: 24,
  height: 24,
  buildable: (x, y) => x > 0 && y >= 0 && x < 24 && y < 24,
  isWater: (x) => x === 0,
  isRocky: (x, y) => x === 15 && y === 10,
};
