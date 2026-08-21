import { greedyRects, type FloorPlanModel, type Opening, type Rect } from "./process";
import { mmToM, mToMm } from "./units";
import { paintWalls, type WallSeg } from "./walls";

export type WindowEdit = {
  sillHeight: number;
  width: number;
};

export function defaultWindowEdit(
  opening: Opening,
  cellMm: number,
  wallHeightM: number,
): WindowEdit {
  const lengthMm = (opening.axis === "x" ? opening.w : opening.d) * cellMm;
  return {
    sillHeight: mToMm(clamp(wallHeightM * 0.32, wallHeightM * 0.08, wallHeightM * 0.5)),
    width: Math.max(8, Math.round(lengthMm)),
  };
}

export function applyPlanEdits(
  model: FloorPlanModel,
  walls: WallSeg[],
  openings: Opening[],
  edits: Record<string, WindowEdit>,
  planWidthMm: number,
): FloorPlanModel {
  const solid = walls.length > 0 ? paintWalls(walls, model.cols, model.rows) : model.solidGrid;
  const cellMm = planWidthMm / model.cols;
  const nextOpenings = openings.map((opening) => {
    if (opening.kind !== "window") return opening;
    const edit = edits[opening.id];
    if (!edit) return opening;
    const resized = resizeOpening(opening, edit, cellMm, model.cols, model.rows, solid);
    return { ...resized, sillHeight: mmToM(edit.sillHeight) };
  });
  return {
    ...model,
    solidGrid: solid,
    openings: nextOpenings,
    wallRects: punchOpenings(solid, nextOpenings, model.cols, model.rows),
  };
}

export function newOpeningId(kind: Opening["kind"]) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createOpeningAt(
  col: number,
  row: number,
  kind: Opening["kind"],
  model: FloorPlanModel,
  planWidthMm: number,
): Opening | null {
  const cellMm = planWidthMm / model.cols;
  const lengthMm = kind === "window" ? Math.max(12, planWidthMm * 0.1) : Math.max(10, planWidthMm * 0.07);
  const lengthCells = Math.max(4, Math.round(lengthMm / cellMm));
  const snapped = snapOpeningToWall(
    col,
    row,
    model.solidGrid,
    model.cols,
    model.rows,
    kind,
    lengthCells,
  );
  if (!snapped) return null;
  return {
    ...snapped,
    id: newOpeningId(kind),
    hasLeaf: kind === "door" ? true : undefined,
  };
}

export function moveOpeningTo(
  opening: Opening,
  col: number,
  row: number,
  model: FloorPlanModel,
): Opening {
  const length = opening.axis === "x" ? opening.w : opening.d;
  const snapped = snapOpeningToWall(
    col,
    row,
    model.solidGrid,
    model.cols,
    model.rows,
    opening.kind,
    Math.max(2, length),
  );
  if (!snapped) return opening;
  return { ...opening, ...snapped };
}

export function attachOpeningsToWalls(model: FloorPlanModel, list: Opening[]): Opening[] {
  return list.map((opening) => {
    const cx = opening.c + opening.w / 2;
    const cy = opening.r + opening.d / 2;
    const len = opening.axis === "x" ? opening.w : opening.d;
    const snapped = snapOpeningToWall(
      cx,
      cy,
      model.solidGrid,
      model.cols,
      model.rows,
      opening.kind,
      Math.max(2, len),
    );
    if (!snapped) return opening;
    return { ...opening, ...snapped };
  });
}

export function snapOpeningToWall(
  col: number,
  row: number,
  solid: Uint8Array,
  cols: number,
  rows: number,
  kind: Opening["kind"],
  lengthCells: number,
): Omit<Opening, "id"> | null {
  const hit = nearestWallCell(col, row, solid, cols, rows, 18);
  if (!hit) return null;
  const axis = localAxis(hit.c, hit.r, solid, cols, rows);
  const run = wallRun(hit.c, hit.r, axis, solid, cols, rows);
  const len = Math.max(1, Math.min(Math.max(2, lengthCells), run.length));

  if (axis === "x") {
    const desired = Math.round(col - len / 2);
    const c = clampInt(desired, run.start, run.start + run.length - len);
    const band = thicknessAlong(c, len, hit.r, "x", solid, cols, rows);
    return { c, r: band.start, w: len, d: band.thick, axis, kind };
  }
  const desired = Math.round(row - len / 2);
  const r = clampInt(desired, run.start, run.start + run.length - len);
  const band = thicknessAlong(r, len, hit.c, "z", solid, cols, rows);
  return { c: band.start, r, w: band.thick, d: len, axis, kind };
}

function nearestWallCell(
  col: number,
  row: number,
  solid: Uint8Array,
  cols: number,
  rows: number,
  radius: number,
): { c: number; r: number } | null {
  const sc = clampInt(Math.round(col), 0, cols - 1);
  const sr = clampInt(Math.round(row), 0, rows - 1);
  if (solid[sr * cols + sc]) return { c: sc, r: sr };

  let best: { c: number; r: number } | null = null;
  let bestD = Infinity;
  for (let r = sr - radius; r <= sr + radius; r++) {
    if (r < 0 || r >= rows) continue;
    for (let c = sc - radius; c <= sc + radius; c++) {
      if (c < 0 || c >= cols || !solid[r * cols + c]) continue;
      const d = (c - col) * (c - col) + (r - row) * (r - row);
      if (d < bestD) {
        bestD = d;
        best = { c, r };
      }
    }
  }
  return best;
}

function localAxis(
  c: number,
  r: number,
  solid: Uint8Array,
  cols: number,
  rows: number,
): "x" | "z" {
  let horizontal = 1;
  let vertical = 1;
  for (let x = c + 1; x < cols && solid[r * cols + x]; x++) horizontal++;
  for (let x = c - 1; x >= 0 && solid[r * cols + x]; x--) horizontal++;
  for (let y = r + 1; y < rows && solid[y * cols + c]; y++) vertical++;
  for (let y = r - 1; y >= 0 && solid[y * cols + c]; y--) vertical++;
  return horizontal >= vertical ? "x" : "z";
}

function wallRun(
  c: number,
  r: number,
  axis: "x" | "z",
  solid: Uint8Array,
  cols: number,
  rows: number,
): { start: number; length: number } {
  if (axis === "x") {
    let c0 = c;
    let c1 = c;
    while (c0 > 0 && solid[r * cols + (c0 - 1)]) c0--;
    while (c1 + 1 < cols && solid[r * cols + (c1 + 1)]) c1++;
    return { start: c0, length: c1 - c0 + 1 };
  }
  let r0 = r;
  let r1 = r;
  while (r0 > 0 && solid[(r0 - 1) * cols + c]) r0--;
  while (r1 + 1 < rows && solid[(r1 + 1) * cols + c]) r1++;
  return { start: r0, length: r1 - r0 + 1 };
}

function thicknessAlong(
  alongStart: number,
  alongLen: number,
  pivot: number,
  axis: "x" | "z",
  solid: Uint8Array,
  cols: number,
  rows: number,
): { start: number; thick: number } {
  let start = 0;
  let end = axis === "x" ? rows : cols;
  let any = false;
  for (let i = alongStart; i < alongStart + alongLen; i++) {
    const c = axis === "x" ? i : pivot;
    const r = axis === "x" ? pivot : i;
    if (r < 0 || c < 0 || r >= rows || c >= cols || !solid[r * cols + c]) continue;
    const band = wallBand(c, r, axis, solid, cols, rows);
    if (!any) {
      start = band.start;
      end = band.start + band.thick;
      any = true;
    } else {
      start = Math.max(start, band.start);
      end = Math.min(end, band.start + band.thick);
    }
  }
  if (!any || end <= start) {
    const c = axis === "x" ? alongStart : pivot;
    const r = axis === "x" ? pivot : alongStart;
    return wallBand(c, r, axis, solid, cols, rows);
  }
  return { start, thick: Math.max(1, end - start) };
}

function wallBand(
  c: number,
  r: number,
  axis: "x" | "z",
  solid: Uint8Array,
  cols: number,
  rows: number,
): { start: number; thick: number } {
  if (axis === "x") {
    let r0 = r;
    let r1 = r;
    while (r0 > 0 && solid[(r0 - 1) * cols + c]) r0--;
    while (r1 + 1 < rows && solid[(r1 + 1) * cols + c]) r1++;
    return { start: r0, thick: r1 - r0 + 1 };
  }
  let c0 = c;
  let c1 = c;
  while (c0 > 0 && solid[r * cols + (c0 - 1)]) c0--;
  while (c1 + 1 < cols && solid[r * cols + (c1 + 1)]) c1++;
  return { start: c0, thick: c1 - c0 + 1 };
}

function resizeOpening(
  opening: Opening,
  edit: WindowEdit,
  cell: number,
  cols: number,
  rows: number,
  solid: Uint8Array,
): Opening {
  const alongX = opening.axis === "x";
  const newCells = Math.max(2, Math.round(edit.width / cell));
  const cx = opening.c + opening.w / 2;
  const cy = opening.r + opening.d / 2;
  const snapped = snapOpeningToWall(cx, cy, solid, cols, rows, opening.kind, newCells);
  if (!snapped) {
    if (alongX) {
      const c = clampInt(Math.round(cx - newCells / 2), 0, Math.max(0, cols - newCells));
      return { ...opening, c, w: Math.min(newCells, cols - c), sillHeight: edit.sillHeight };
    }
    const r = clampInt(Math.round(cy - newCells / 2), 0, Math.max(0, rows - newCells));
    return { ...opening, r, d: Math.min(newCells, rows - r), sillHeight: edit.sillHeight };
  }
  return { ...opening, ...snapped, sillHeight: edit.sillHeight };
}

function punchOpenings(
  solid: Uint8Array,
  openings: Opening[],
  cols: number,
  rows: number,
): Rect[] {
  const grid = solid.slice();
  for (const opening of openings) paintRect(grid, opening, cols, rows, 0);
  return greedyRects(grid, cols, rows, 1);
}

function paintRect(
  grid: Uint8Array,
  rect: { c: number; r: number; w: number; d: number },
  cols: number,
  rows: number,
  value: number,
) {
  const r0 = Math.max(0, rect.r);
  const c0 = Math.max(0, rect.c);
  const r1 = Math.min(rows, rect.r + rect.d);
  const c1 = Math.min(cols, rect.c + rect.w);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) grid[r * cols + c] = value;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
