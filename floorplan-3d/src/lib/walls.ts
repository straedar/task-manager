import { greedyRects, type Rect } from "./process";

export type WallSeg = Rect & { id: string };

export function wallsFromGrid(solid: Uint8Array, cols: number, rows: number): WallSeg[] {
  return greedyRects(solid, cols, rows, 1)
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .map((rect, index) => ({ ...rect, id: `wall-${index}-${rect.c}-${rect.r}-${rect.w}-${rect.d}` }));
}

export function wallSizeMm(wall: WallSeg, cellMm: number) {
  const alongX = wall.w >= wall.d;
  return {
    length: Math.max(1, Math.round((alongX ? wall.w : wall.d) * cellMm)),
    thickness: Math.max(1, Math.round((alongX ? wall.d : wall.w) * cellMm)),
  };
}

export function resizeWall(
  wall: WallSeg,
  lengthMm: number,
  thicknessMm: number,
  cellMm: number,
  cols: number,
  rows: number,
): WallSeg {
  const alongX = wall.w >= wall.d;
  const lenCells = Math.max(1, Math.round(lengthMm / cellMm));
  const thickCells = Math.max(1, Math.round(thicknessMm / cellMm));
  const cx = wall.c + wall.w / 2;
  const cy = wall.r + wall.d / 2;
  if (alongX) {
    const w = Math.min(lenCells, cols);
    const d = Math.min(thickCells, rows);
    return {
      ...wall,
      c: clampInt(Math.round(cx - w / 2), 0, cols - w),
      r: clampInt(Math.round(cy - d / 2), 0, rows - d),
      w,
      d,
    };
  }
  const w = Math.min(thickCells, cols);
  const d = Math.min(lenCells, rows);
  return {
    ...wall,
    c: clampInt(Math.round(cx - w / 2), 0, cols - w),
    r: clampInt(Math.round(cy - d / 2), 0, rows - d),
    w,
    d,
  };
}

export function moveWallTo(
  wall: WallSeg,
  col: number,
  row: number,
  cols: number,
  rows: number,
): WallSeg {
  return {
    ...wall,
    c: clampInt(Math.round(col - wall.w / 2), 0, Math.max(0, cols - wall.w)),
    r: clampInt(Math.round(row - wall.d / 2), 0, Math.max(0, rows - wall.d)),
  };
}

export function paintWalls(walls: WallSeg[], cols: number, rows: number): Uint8Array {
  const grid = new Uint8Array(cols * rows);
  for (const wall of walls) {
    const r0 = Math.max(0, wall.r);
    const c0 = Math.max(0, wall.c);
    const r1 = Math.min(rows, wall.r + wall.d);
    const c1 = Math.min(cols, wall.c + wall.w);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) grid[r * cols + c] = 1;
    }
  }
  return grid;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
