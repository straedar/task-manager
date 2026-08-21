import type { FloorPlanModel, RoomPatch } from "./process";
import { REAL_WALL_HEIGHT, type BoxPart } from "./parts";
import { mmToM } from "./units";

export type ShelfBack = "n" | "e" | "s" | "w";

export type Furniture = {
  id: string;
  kind: "shelf";
  c: number;
  r: number;
  w: number;
  d: number;
  back: ShelfBack;
};

const REAL_WIDTH_MM = 1096;
const REAL_DEPTH_MM = 593;
const REAL_HEIGHT_MM = 2700;
const REAL_POST_MM = 55;
const REAL_BEAM_MM = 50;
const REAL_DECK_MM = 12;
const REAL_BRACE_MM = 30;
const REAL_LEVELS_MM = [465, 922, 1362, 1802, 2242];

export const SHELF_HEIGHT_MM = 92;
export const SHELF_WIDTH_MM = (REAL_WIDTH_MM * SHELF_HEIGHT_MM) / REAL_HEIGHT_MM;
export const SHELF_DEPTH_MM = (REAL_DEPTH_MM * SHELF_HEIGHT_MM) / REAL_HEIGHT_MM;
export const SHELF_BOARD_COUNT = REAL_LEVELS_MM.length;

const BACK_CYCLE: ShelfBack[] = ["n", "e", "s", "w"];

export function newFurnitureId() {
  return `shelf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createShelfAt(
  col: number,
  row: number,
  model: FloorPlanModel,
  planWidthMm: number,
): Furniture {
  const cellMm = planWidthMm / model.cols;
  const snapped = snapShelfToWall(col, row, model, cellMm);
  if (snapped && mostlyEmpty(model, snapped)) return snapped;
  const { along, depth } = shelfCells(cellMm, model.cols, model.rows);
  return clampFurniture({
    id: newFurnitureId(),
    kind: "shelf",
    c: col - along / 2,
    r: row - depth / 2,
    w: along,
    d: depth,
    back: "n",
  }, model.cols, model.rows);
}

export function moveFurnitureTo(
  item: Furniture,
  col: number,
  row: number,
  cols: number,
  rows: number,
): Furniture {
  return clampFurniture({ ...item, c: col - item.w / 2, r: row - item.d / 2 }, cols, rows);
}

export function rotateFurniture(item: Furniture, cols: number, rows: number): Furniture {
  const cx = item.c + item.w / 2;
  const cz = item.r + item.d / 2;
  const nextBack = BACK_CYCLE[(BACK_CYCLE.indexOf(item.back) + 1) % BACK_CYCLE.length]!;
  return clampFurniture({
    ...item,
    c: cx - item.d / 2,
    r: cz - item.w / 2,
    w: item.d,
    d: item.w,
    back: nextBack,
  }, cols, rows);
}

export function placeDefaultShelf(model: FloorPlanModel, planWidthMm: number): Furniture | null {
  const cellMm = planWidthMm / model.cols;
  const size = shelfCells(cellMm, model.cols, model.rows);
  const rooms = [...model.rooms].sort((a, b) => b.area - a.area);
  for (const room of rooms) {
    const placed = shelfInRoom(room, model, size.along, size.depth);
    if (placed) return placed;
  }
  if (model.cols < 4 || model.rows < 4) return null;
  return clampFurniture({
    id: newFurnitureId(),
    kind: "shelf",
    c: (model.cols - size.along) / 2,
    r: (model.rows - size.depth) / 2,
    w: size.along,
    d: size.depth,
    back: "n",
  }, model.cols, model.rows);
}

export type ShelfLevel = {
  index: number;
  beamY: number;
  deckTop: number;
  clearH: number;
};

export type ShelfFrame = {
  along: number;
  deep: number;
  height: number;
  post: number;
  beamH: number;
  beamD: number;
  deckT: number;
  braceT: number;
  innerW: number;
  innerD: number;
  hx: number;
  hz: number;
  yBot: number;
  yTop: number;
  levels: ShelfLevel[];
};

export function shelfFrame(item: Furniture, cell: number): ShelfFrame {
  const width = Math.max(item.w * cell, mmToM(8));
  const depth = Math.max(item.d * cell, mmToM(6));
  const alongX = item.back === "n" || item.back === "s";
  const along = alongX ? width : depth;
  const deep = alongX ? depth : width;
  const height = Math.min(mmToM(SHELF_HEIGHT_MM), REAL_WALL_HEIGHT * 0.95);
  const scale = height / mmToM(REAL_HEIGHT_MM);
  const post = clamp(mmToM(REAL_POST_MM) * scale, mmToM(1.4), mmToM(2.4));
  const beamH = clamp(mmToM(REAL_BEAM_MM) * scale, mmToM(1.2), mmToM(2.0));
  const beamD = clamp(post * 0.72, mmToM(1.1), mmToM(1.8));
  const deckT = clamp(mmToM(REAL_DECK_MM) * scale, mmToM(0.8), mmToM(1.3));
  const braceT = clamp(mmToM(REAL_BRACE_MM) * scale, mmToM(1.1), mmToM(1.6));
  const hx = along / 2 - post / 2;
  const hz = deep / 2 - post / 2;
  const innerW = Math.max(along - post * 2, along * 0.55);
  const innerD = Math.max(deep - post * 2, deep * 0.5);
  const levels: ShelfLevel[] = REAL_LEVELS_MM.map((level, index) => {
    const beamY = clamp((level / REAL_HEIGHT_MM) * height, beamH / 2, height - beamH / 2);
    const deckTop = beamY + beamH / 2 + deckT;
    const next = REAL_LEVELS_MM[index + 1];
    const ceiling = next
      ? clamp((next / REAL_HEIGHT_MM) * height, beamH / 2, height - beamH / 2) - beamH / 2
      : height;
    return {
      index,
      beamY,
      deckTop,
      clearH: Math.max(0.004, ceiling - deckTop),
    };
  });
  return {
    along,
    deep,
    height,
    post,
    beamH,
    beamD,
    deckT,
    braceT,
    innerW,
    innerD,
    hx,
    hz,
    yBot: beamH * 0.6,
    yTop: height - beamH * 0.6,
    levels,
  };
}

export function furniturePose(item: Furniture, cell: number) {
  return {
    x: (item.c + item.w / 2) * cell,
    z: (item.r + item.d / 2) * cell,
    yaw: backYaw(item.back),
  };
}

export function shelfParts(item: Furniture, cell: number, yOffset = 0): BoxPart[] {
  const frame = shelfFrame(item, cell);
  const { hx, hz, height, post, innerW, innerD, beamH, beamD, deckT, braceT, yBot, yTop } = frame;

  const locals: BoxPart[] = [
    box([-hx, height / 2, -hz], [post, height, post], "rackUpright"),
    box([hx, height / 2, -hz], [post, height, post], "rackUpright"),
    box([-hx, height / 2, hz], [post, height, post], "rackUpright"),
    box([hx, height / 2, hz], [post, height, post], "rackUpright"),
  ];

  for (const level of frame.levels) {
    locals.push(box([0, level.beamY, -hz], [innerW, beamH, beamD], "rackBeam"));
    locals.push(box([0, level.beamY, hz], [innerW, beamH, beamD], "rackBeam"));
    locals.push(box([0, level.beamY + beamH / 2 + deckT / 2, 0], [innerW, deckT, innerD], "rackDeck"));
  }

  for (const x of [-hx, hx]) {
    locals.push(diagonalYZ(x, yBot, -hz, yTop, hz, braceT, "rackUpright"));
    locals.push(diagonalYZ(x, yBot, hz, yTop, -hz, braceT, "rackUpright"));
    locals.push(box([x, height / 2, 0], [braceT, braceT, innerD], "rackUpright"));
  }

  return locals.map((piece) => ({
    ...piece,
    position: [piece.position[0], piece.position[1] + yOffset, piece.position[2]],
  }));
}

function box(
  position: [number, number, number],
  size: [number, number, number],
  role: BoxPart["role"],
): BoxPart {
  return { position, rotationX: 0, rotationY: 0, rotationZ: 0, size, role };
}

function diagonalYZ(
  x: number,
  y0: number,
  z0: number,
  y1: number,
  z1: number,
  thick: number,
  role: BoxPart["role"],
): BoxPart {
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.max(Math.hypot(dy, dz), thick);
  return {
    position: [x, (y0 + y1) / 2, (z0 + z1) / 2],
    rotationX: Math.atan2(dz, dy),
    rotationY: 0,
    rotationZ: 0,
    size: [thick, len, thick],
    role,
  };
}

export function furnitureSizeMm(item: Furniture, cellMm: number) {
  const alongX = item.back === "n" || item.back === "s";
  return {
    width: Math.max(1, Math.round((alongX ? item.w : item.d) * cellMm)),
    depth: Math.max(1, Math.round((alongX ? item.d : item.w) * cellMm)),
  };
}

export function resizeFurniture(
  item: Furniture,
  widthMm: number,
  depthMm: number,
  cellMm: number,
  cols: number,
  rows: number,
): Furniture {
  const alongX = item.back === "n" || item.back === "s";
  const widthCells = Math.max(2, widthMm / cellMm);
  const depthCells = Math.max(2, depthMm / cellMm);
  const w = alongX ? widthCells : depthCells;
  const d = alongX ? depthCells : widthCells;
  const cx = item.c + item.w / 2;
  const cz = item.r + item.d / 2;
  return clampFurniture({ ...item, c: cx - w / 2, r: cz - d / 2, w, d }, cols, rows);
}

function shelfCells(cellMm: number, cols: number, rows: number) {
  const along = clampInt(Math.round(SHELF_WIDTH_MM / cellMm), 4, Math.max(4, cols - 2));
  const depth = clampInt(Math.round(SHELF_DEPTH_MM / cellMm), 2, Math.max(2, rows - 2));
  return { along, depth };
}

function snapShelfToWall(
  col: number,
  row: number,
  model: FloorPlanModel,
  cellMm: number,
): Furniture | null {
  const hit = nearestSolid(col, row, model, 10);
  if (!hit) return null;
  const { along, depth } = shelfCells(cellMm, model.cols, model.rows);
  const room = roomSide(hit.c, hit.r, model);
  if (!room) return null;

  if (room === "s" || room === "n") {
    const back: ShelfBack = room === "s" ? "n" : "s";
    const r = back === "n" ? hit.r + 1 : hit.r - depth;
    return clampFurniture({
      id: newFurnitureId(),
      kind: "shelf",
      c: col - along / 2,
      r,
      w: along,
      d: depth,
      back,
    }, model.cols, model.rows);
  }

  const back: ShelfBack = room === "e" ? "w" : "e";
  const c = back === "w" ? hit.c + 1 : hit.c - depth;
  return clampFurniture({
    id: newFurnitureId(),
    kind: "shelf",
    c,
    r: row - along / 2,
    w: depth,
    d: along,
    back,
  }, model.cols, model.rows);
}

function shelfInRoom(
  room: RoomPatch,
  model: FloorPlanModel,
  along: number,
  depth: number,
): Furniture | null {
  const rects = [...room.rects].sort((a, b) => b.w * b.d - a.w * a.d);
  for (const rect of rects) {
    if (rect.w >= along + 1 && rect.d >= depth + 1) {
      const topWall = isSolid(model, Math.floor(rect.c + rect.w / 2), Math.floor(rect.r) - 1);
      const back: ShelfBack = topWall ? "n" : "s";
      const r = back === "n" ? rect.r : rect.r + rect.d - depth;
      const candidate = clampFurniture({
        id: newFurnitureId(),
        kind: "shelf",
        c: rect.c + (rect.w - along) / 2,
        r,
        w: along,
        d: depth,
        back,
      }, model.cols, model.rows);
      if (mostlyEmpty(model, candidate)) return candidate;
    }
    if (rect.d >= along + 1 && rect.w >= depth + 1) {
      const leftWall = isSolid(model, Math.floor(rect.c) - 1, Math.floor(rect.r + rect.d / 2));
      const back: ShelfBack = leftWall ? "w" : "e";
      const c = back === "w" ? rect.c : rect.c + rect.w - depth;
      const candidate = clampFurniture({
        id: newFurnitureId(),
        kind: "shelf",
        c,
        r: rect.r + (rect.d - along) / 2,
        w: depth,
        d: along,
        back,
      }, model.cols, model.rows);
      if (mostlyEmpty(model, candidate)) return candidate;
    }
  }
  return null;
}

function mostlyEmpty(model: FloorPlanModel, item: Furniture) {
  const c0 = Math.max(0, Math.floor(item.c));
  const r0 = Math.max(0, Math.floor(item.r));
  const c1 = Math.min(model.cols, Math.ceil(item.c + item.w));
  const r1 = Math.min(model.rows, Math.ceil(item.r + item.d));
  let empty = 0;
  let total = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      total++;
      if (!model.solidGrid[r * model.cols + c]) empty++;
    }
  }
  return total > 0 && empty / total >= 0.65;
}

function nearestSolid(
  col: number,
  row: number,
  model: FloorPlanModel,
  radius: number,
): { c: number; r: number } | null {
  const sc = clampInt(Math.round(col), 0, model.cols - 1);
  const sr = clampInt(Math.round(row), 0, model.rows - 1);
  if (isSolid(model, sc, sr)) return { c: sc, r: sr };
  let best: { c: number; r: number } | null = null;
  let bestD = Infinity;
  const r0 = Math.max(0, sr - radius);
  const r1 = Math.min(model.rows - 1, sr + radius);
  const c0 = Math.max(0, sc - radius);
  const c1 = Math.min(model.cols - 1, sc + radius);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isSolid(model, c, r)) continue;
      const dist = (c - col) ** 2 + (r - row) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = { c, r };
      }
    }
  }
  return best;
}

function roomSide(c: number, r: number, model: FloorPlanModel): ShelfBack | null {
  const order: Array<[ShelfBack, number, number]> = [
    ["s", 0, 1],
    ["n", 0, -1],
    ["e", 1, 0],
    ["w", -1, 0],
  ];
  for (const [side, dc, dr] of order) {
    if (!isSolid(model, c + dc, r + dr)) return side;
  }
  return null;
}

function isSolid(model: FloorPlanModel, c: number, r: number) {
  if (c < 0 || r < 0 || c >= model.cols || r >= model.rows) return false;
  return Boolean(model.solidGrid[r * model.cols + c]);
}

function clampFurniture(item: Furniture, cols: number, rows: number): Furniture {
  const w = Math.min(Math.max(item.w, 1), cols);
  const d = Math.min(Math.max(item.d, 1), rows);
  return {
    ...item,
    w,
    d,
    c: clamp(item.c, 0, Math.max(0, cols - w)),
    r: clamp(item.r, 0, Math.max(0, rows - d)),
  };
}

function backYaw(back: ShelfBack) {
  if (back === "s") return Math.PI;
  if (back === "w") return Math.PI / 2;
  if (back === "e") return -Math.PI / 2;
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
