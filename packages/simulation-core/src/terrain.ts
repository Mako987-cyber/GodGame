import { BIOME_PROFILES } from "./constants";
import { clamp, neighbors } from "./grid";
import { riverName } from "./names";
import { deriveRng, type Rng } from "./prng";
import type { Biome, Cell } from "./types";

/** Lattice value noise with smooth interpolation; enough for a coherent 48x48 map. */
function createValueNoise(rng: Rng, size: number): (x: number, y: number) => number {
  const lattice = Array.from({ length: (size + 2) * (size + 2) }, () => rng.next());
  const at = (x: number, y: number) => lattice[y * (size + 2) + x] ?? 0;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number, scale: number) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1 / scale;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

const SEA_LEVEL = 0.34;

function classify(cell: Pick<Cell, "altitude" | "moisture" | "temperature">): Biome {
  if (cell.altitude < SEA_LEVEL) return "ocean";
  if (cell.altitude > 0.8) return "mountain";
  if (cell.temperature < 0.22) return "tundra";
  if (cell.altitude > 0.66) return "hills";
  if (cell.moisture < 0.32 && cell.temperature > 0.5) return "desert";
  if (cell.moisture > 0.58) return "forest";
  return "plains";
}

export function generateTerrain(seed: string, width: number, height: number): Cell[] {
  const size = Math.max(width, height);
  const altNoise = createValueNoise(deriveRng(seed, "altitude"), size);
  const moistNoise = createValueNoise(deriveRng(seed, "moisture"), size);
  const tempNoise = createValueNoise(deriveRng(seed, "temperature"), size);
  const mineralRng = deriveRng(seed, "minerals");

  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / (width - 1)) * 2 - 1;
      const ny = (y / (height - 1)) * 2 - 1;
      // Radial falloff shapes a continent surrounded by sea.
      const edge = Math.min(1, Math.sqrt(nx * nx + ny * ny) / 1.25);
      const raw = fbm(altNoise, x, y, 4, size / 3.2);
      const altitude = clamp(raw * 1.1 - edge * edge * 0.55 + 0.12);
      const moisture = clamp(fbm(moistNoise, x, y, 3, size / 2.5) * 1.15 - 0.05);
      const latitude = y / (height - 1);
      const temperature = clamp(
        0.15 +
          latitude * 0.75 +
          (fbm(tempNoise, x, y, 2, size / 2) - 0.5) * 0.3 -
          Math.max(0, altitude - 0.55) * 0.8,
      );
      cells.push({
        x,
        y,
        altitude,
        moisture,
        temperature,
        biome: "ocean",
        fertility: 0,
        baseFertility: 0,
        water: 0,
        wood: 0,
        maxWood: 0,
        stone: 0,
        fauna: 0,
        maxFauna: 0,
        copper: 0,
        iron: 0,
        clay: 0,
        tin: 0,
        coal: 0,
        habitability: 0,
        river: false,
        riverName: null,
        coastal: false,
        ownerTribeId: null,
        settlementId: null,
        road: false,
        fields: 0,
        pastures: 0,
      });
    }
  }

  const grid = { width, height, cells };
  for (const cell of cells) cell.biome = classify(cell);
  for (const cell of cells) {
    if (cell.biome === "ocean") continue;
    cell.coastal = neighbors(grid, cell).some((n) => n.biome === "ocean");
    if (cell.coastal && cell.altitude < SEA_LEVEL + 0.08 && cell.biome !== "tundra") cell.biome = "coast";
  }

  carveRivers(seed, grid);

  for (const cell of cells) {
    if (cell.biome === "ocean") {
      cell.water = 1;
      continue;
    }
    const profile = BIOME_PROFILES[cell.biome];
    const nearRiver = cell.river || neighbors(grid, cell).some((n) => n.river);
    cell.water = clamp(cell.river ? 1 : nearRiver ? 0.75 : cell.coastal ? 0.55 : cell.moisture * 0.6);
    const climate = 1 - Math.abs(cell.temperature - 0.6) * 0.8;
    cell.baseFertility = clamp(
      profile.fertility * (0.6 + cell.moisture * 0.5) * climate + (nearRiver ? 0.22 : 0),
    );
    cell.fertility = cell.baseFertility;
    cell.maxFauna = Math.round(profile.maxFauna * (0.7 + cell.moisture * 0.5) + (nearRiver ? 4 : 0));
    cell.fauna = cell.maxFauna;
    cell.maxWood = Math.round(profile.maxWood * (0.6 + cell.moisture * 0.6));
    cell.wood = cell.maxWood;
    cell.stone = Math.round(profile.stone * (0.7 + mineralRng.next() * 0.6));
    if ((cell.biome === "hills" || cell.biome === "mountain") && mineralRng.chance(0.14)) {
      cell.copper = mineralRng.int(40, 100);
    }
    if (cell.biome === "mountain" && mineralRng.chance(0.1)) cell.iron = mineralRng.int(30, 90);
    // Tin is rare and only pairs with highlands: bronze will often require trade.
    if ((cell.biome === "hills" || cell.biome === "mountain") && mineralRng.chance(0.05)) {
      cell.tin = mineralRng.int(20, 60);
    }
    // Clay follows water: riverbanks, coasts and damp plains.
    if ((cell.river || cell.coastal || cell.moisture > 0.55) && mineralRng.chance(0.3)) {
      cell.clay = mineralRng.int(30, 90);
    }
    // Peat and coal: mountains, hills and wet forests.
    if (
      (cell.biome === "mountain" || cell.biome === "hills" || cell.biome === "forest") &&
      mineralRng.chance(0.08)
    ) {
      cell.coal = mineralRng.int(25, 80);
    }
    cell.habitability = computeHabitability(cell);
  }
  return cells;
}

export function computeHabitability(cell: Cell): number {
  if (cell.biome === "ocean") return 0;
  const temperate = 1 - Math.abs(cell.temperature - 0.6) * 1.6;
  const value =
    cell.fertility * 0.35 +
    cell.water * 0.25 +
    Math.min(1, cell.fauna / 26) * 0.2 +
    clamp(temperate) * 0.1 +
    (cell.river ? 0.1 : 0) +
    BIOME_PROFILES[cell.biome].habitabilityModifier;
  return clamp(value);
}

function carveRivers(seed: string, grid: { width: number; height: number; cells: Cell[] }) {
  const rng = deriveRng(seed, "rivers");
  const sources = grid.cells
    .filter((c) => c.altitude > 0.62 && c.moisture > 0.45 && c.biome !== "ocean")
    .sort((a, b) => b.altitude - a.altitude || a.y - b.y || a.x - b.x);
  const count = Math.max(2, Math.round(grid.width / 9));
  let made = 0;
  for (const source of rng.shuffle(sources)) {
    if (made >= count) break;
    if (source.river) continue;
    const name = riverName(rng);
    const path: Cell[] = [];
    const visited = new Set<Cell>();
    let current: Cell = source;
    let reachedWater = false;
    for (let step = 0; step < grid.width * 2; step++) {
      path.push(current);
      visited.add(current);
      const options = neighbors(grid, current).filter((n) => !visited.has(n));
      if (options.length === 0) break;
      const next = options.reduce((best, n) => (n.altitude < best.altitude ? n : best));
      if (next.biome === "ocean" || next.river) {
        reachedWater = true;
        break;
      }
      current = next;
    }
    if (!reachedWater || path.length < 4) continue;
    for (const cell of path) {
      cell.river = true;
      cell.riverName = name;
      cell.moisture = clamp(cell.moisture + 0.2);
      if (cell.biome === "desert") cell.biome = "plains";
    }
    made++;
  }
  // Rivers also humidify their banks.
  for (const cell of grid.cells) {
    if (!cell.river) continue;
    for (const n of neighbors(grid, cell)) n.moisture = clamp(n.moisture + 0.06);
  }
}
