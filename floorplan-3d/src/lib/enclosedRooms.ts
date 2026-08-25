import type { MapObject } from "../api";
import { GRID, worldToMeters } from "../world";

export type RoomFloorRectM = {
  x: number;
  z: number;
  width: number;
  depth: number;
};

const PERIMETER = new Set(["wall", "window", "door"]);
const N4: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Полностью закрытые стенами (окна/двери тоже считаются периметром) комнаты. */
export function detectEnclosedRoomFloors(objects: MapObject[]): RoomFloorRectM[] {
  const segments = objects.filter((o) => PERIMETER.has(o.type));
  if (segments.length === 0) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.width);
    maxY = Math.max(maxY, s.y + s.height);
  }
  minX = Math.floor(minX / GRID) * GRID - GRID;
  minY = Math.floor(minY / GRID) * GRID - GRID;
  maxX = Math.ceil(maxX / GRID) * GRID + GRID;
  maxY = Math.ceil(maxY / GRID) * GRID + GRID;

  const cols = Math.max(1, Math.round((maxX - minX) / GRID));
  const rows = Math.max(1, Math.round((maxY - minY) / GRID));
  if (cols * rows > 250_000) return [];

  const blocked = new Uint8Array(cols * rows);
  for (const s of segments) paintSegment(blocked, cols, rows, minX, minY, s);

  const exterior = floodExterior(blocked, cols, rows);
  const interior = new Uint8Array(cols * rows);
  for (let i = 0; i < interior.length; i++) {
    interior[i] = !blocked[i] && !exterior[i] ? 1 : 0;
  }

  const seen = new Uint8Array(cols * rows);
  const floors: RoomFloorRectM[] = [];
  const minCells = 4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (!interior[start] || seen[start]) continue;

      const blob = new Uint8Array(cols * rows);
      const stack = [start];
      seen[start] = 1;
      let area = 0;
      while (stack.length) {
        const i = stack.pop()!;
        blob[i] = 1;
        area += 1;
        const cc = i % cols;
        const rr = (i / cols) | 0;
        for (const [dc, dr] of N4) {
          const nc = cc + dc;
          const nr = rr + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (seen[ni] || !interior[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (area < minCells) continue;

      for (const rect of greedyCover(blob, cols, rows)) {
        floors.push({
          x: worldToMeters(minX + rect.c * GRID),
          z: worldToMeters(minY + rect.r * GRID),
          width: worldToMeters(rect.w * GRID),
          depth: worldToMeters(rect.d * GRID),
        });
      }
    }
  }
  return floors;
}

function paintSegment(
  blocked: Uint8Array,
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  s: MapObject,
) {
  let { x, y, width, height } = s;
  if (s.type === "door") {
    if (width >= height) {
      const cy = y + height / 2;
      y = Math.floor(cy / GRID) * GRID;
      height = GRID;
    } else {
      const cx = x + width / 2;
      x = Math.floor(cx / GRID) * GRID;
      width = GRID;
    }
  }
  const c0 = Math.floor((x - originX) / GRID);
  const r0 = Math.floor((y - originY) / GRID);
  const c1 = Math.ceil((x + width - originX) / GRID);
  const r1 = Math.ceil((y + height - originY) / GRID);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      blocked[r * cols + c] = 1;
    }
  }
}

function floodExterior(
  blocked: Uint8Array,
  cols: number,
  rows: number,
): Uint8Array {
  const exterior = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const tryPush = (c: number, r: number) => {
    const i = r * cols + c;
    if (blocked[i] || exterior[i]) return;
    exterior[i] = 1;
    stack.push(i);
  };
  for (let c = 0; c < cols; c++) {
    tryPush(c, 0);
    tryPush(c, rows - 1);
  }
  for (let r = 0; r < rows; r++) {
    tryPush(0, r);
    tryPush(cols - 1, r);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % cols;
    const r = (i / cols) | 0;
    for (const [dc, dr] of N4) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      tryPush(nc, nr);
    }
  }
  return exterior;
}

function greedyCover(
  mask: Uint8Array,
  cols: number,
  rows: number,
): Array<{ c: number; r: number; w: number; d: number }> {
  const seen = new Uint8Array(cols * rows);
  const out: Array<{ c: number; r: number; w: number; d: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!mask[i] || seen[i]) continue;
      let w = 1;
      while (c + w < cols && mask[r * cols + c + w] && !seen[r * cols + c + w]) {
        w += 1;
      }
      let d = 1;
      outer: while (r + d < rows) {
        for (let x = 0; x < w; x++) {
          const j = (r + d) * cols + c + x;
          if (!mask[j] || seen[j]) break outer;
        }
        d += 1;
      }
      for (let y = 0; y < d; y++) {
        for (let x = 0; x < w; x++) seen[(r + y) * cols + c + x] = 1;
      }
      out.push({ c, r, w, d });
    }
  }
  return out;
}
