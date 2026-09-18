import type { Cell, WorldState } from "./types";

type Grid = Pick<WorldState, "width" | "height" | "cells">;

export function inBounds(grid: Pick<WorldState, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function cellAt(grid: Grid, x: number, y: number): Cell {
  const cell = grid.cells[y * grid.width + x];
  if (!cell) throw new Error(`Cell out of bounds: ${x},${y}`);
  return cell;
}

export function tryCellAt(grid: Grid, x: number, y: number): Cell | null {
  return inBounds(grid, x, y) ? (grid.cells[y * grid.width + x] ?? null) : null;
}

/** Chebyshev distance: movement on the grid allows diagonals. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function cellsInRadius(grid: Grid, cx: number, cy: number, radius: number): Cell[] {
  const result: Cell[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const cell = tryCellAt(grid, x, y);
      if (cell) result.push(cell);
    }
  }
  return result;
}

export function neighbors(grid: Grid, cell: Cell): Cell[] {
  const result: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = tryCellAt(grid, cell.x + dx, cell.y + dy);
      if (n) result.push(n);
    }
  }
  return result;
}

/** Bresenham line, used for roads. */
export function lineCells(grid: Grid, x0: number, y0: number, x1: number, y1: number): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    const cell = tryCellAt(grid, x, y);
    if (cell) cells.push(cell);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

export function round(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
