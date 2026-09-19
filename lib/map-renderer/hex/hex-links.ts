/**
 * Which hex edges rivers and roads cross.
 *
 * The simulation marks river and road cells on its square grid; on hexes three such cells are
 * often mutual neighbours, and linking every pair would draw triangles. Links are therefore
 * trees: a river cell flows into its lowest river or sea neighbour (and receives its upstream
 * cells), roads follow a spanning tree of each connected road network. Results are 6-bit masks
 * per cell, bit d = the link crosses edge d.
 */
import type { MapCellViewModel } from "../types";
import type { HexGrid } from "./geometry";

const isWater = (c: MapCellViewModel | undefined) => c?.biome === "ocean";

export function riverLinks(grid: HexGrid, cells: MapCellViewModel[]): Uint8Array {
  const mask = new Uint8Array(cells.length);
  for (const c of cells) {
    if (!c.river || isWater(c)) continue;
    let best = -1;
    let bestAlt = Infinity;
    let bestIndex = -1;
    for (let d = 0; d < 6; d++) {
      const n = grid.neighbor(c.x, c.y, d);
      if (!grid.inBounds(n.x, n.y)) continue;
      const j = grid.index(n.x, n.y);
      const nc = cells[j];
      if (!nc || !(nc.river || isWater(nc))) continue;
      // The sea wins, then the lowest river neighbour below this cell.
      const alt = isWater(nc) ? -1 : nc.altitude;
      if (
        alt < bestAlt &&
        (isWater(nc) || nc.altitude < c.altitude || (nc.altitude === c.altitude && j < c.index))
      ) {
        best = d;
        bestAlt = alt;
        bestIndex = j;
      }
    }
    if (best < 0) continue;
    mask[c.index] = (mask[c.index] ?? 0) | (1 << best);
    // The receiving cell draws the same edge from its side (river cells only; the sea needs nothing).
    const recv = cells[bestIndex];
    if (recv && !isWater(recv)) mask[bestIndex] = (mask[bestIndex] ?? 0) | (1 << ((best + 3) % 6));
  }
  return mask;
}

export function roadLinks(grid: HexGrid, cells: MapCellViewModel[]): Uint8Array {
  const mask = new Uint8Array(cells.length);
  const seen = new Uint8Array(cells.length);
  for (const start of cells) {
    if (!start.road || seen[start.index]) continue;
    // Breadth-first spanning tree: stable order (row-major roots, fixed direction order).
    const queue = [start.index];
    seen[start.index] = 1;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      const c = cells[i];
      if (!c) continue;
      for (let d = 0; d < 6; d++) {
        const n = grid.neighbor(c.x, c.y, d);
        if (!grid.inBounds(n.x, n.y)) continue;
        const j = grid.index(n.x, n.y);
        if (seen[j] || !cells[j]?.road) continue;
        seen[j] = 1;
        mask[i] = (mask[i] ?? 0) | (1 << d);
        mask[j] = (mask[j] ?? 0) | (1 << ((d + 3) % 6));
        queue.push(j);
      }
    }
  }
  return mask;
}

export function linkDirections(mask: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) out.push(d);
  return out;
}
