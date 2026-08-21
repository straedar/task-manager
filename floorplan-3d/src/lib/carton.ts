import type { Furniture, ShelfFrame } from "./furniture";
import { SHELF_HEIGHT_MM, shelfFrame } from "./furniture";
import { mmToM } from "./units";

export type Carton = {
  id: string;
  furnitureId: string;
  level: number;
  along: number;
  depth: number;
};

const REAL_HEIGHT_MM = 2700;
const CARTON_REAL_MM = { w: 380, d: 280, h: 250 };
const GAP = 0.0006;

export function newCartonId() {
  return `carton-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function cartonSize(frame: ShelfFrame, levelIndex: number) {
  const scale = frame.height / mmToM(REAL_HEIGHT_MM);
  const level = frame.levels[levelIndex];
  const maxH = level ? Math.max(0.004, level.clearH * 0.88) : mmToM(8);
  const w = Math.min(mmToM(CARTON_REAL_MM.w) * scale, frame.innerW * 0.42);
  const d = Math.min(mmToM(CARTON_REAL_MM.d) * scale, frame.innerD * 0.72);
  const h = Math.min(mmToM(CARTON_REAL_MM.h) * scale, maxH);
  return {
    w: Math.max(mmToM(4), w),
    d: Math.max(mmToM(3), d),
    h: Math.max(mmToM(3.5), h),
  };
}

export function cartonLocalPose(
  frame: ShelfFrame,
  carton: Carton,
  yOffset = 0,
) {
  const size = cartonSize(frame, carton.level);
  const level = frame.levels[carton.level];
  if (!level) return null;
  const spanX = Math.max(frame.innerW - size.w, 0);
  const spanZ = Math.max(frame.innerD - size.d, 0);
  const along = clamp01(carton.along);
  const depth = clamp01(carton.depth);
  return {
    position: [
      -frame.innerW / 2 + size.w / 2 + along * spanX,
      yOffset + level.deckTop + size.h / 2,
      -frame.innerD / 2 + size.d / 2 + depth * spanZ,
    ] as [number, number, number],
    size: [size.w, size.h, size.d] as [number, number, number],
  };
}

export function addCartonAt(
  furniture: Furniture,
  cell: number,
  level: number,
  alongHint: number,
  existing: Carton[],
): Carton | null {
  const frame = shelfFrame(furniture, cell);
  if (!frame.levels[level]) return null;
  const size = cartonSize(frame, level);
  if (size.w > frame.innerW - GAP * 2 || size.d > frame.innerD - GAP * 2) return null;
  const spanX = Math.max(frame.innerW - size.w, 0.0001);
  const neighbors = existing.filter((item) => item.furnitureId === furniture.id && item.level === level);
  const along = findAlong(clamp01(alongHint), neighbors, size.w, spanX);
  if (along == null) return null;
  return {
    id: newCartonId(),
    furnitureId: furniture.id,
    level,
    along,
    depth: 0.72,
  };
}

export function moveCartonAlong(
  carton: Carton,
  along: number,
  furniture: Furniture,
  cell: number,
  existing: Carton[],
): Carton {
  const frame = shelfFrame(furniture, cell);
  const size = cartonSize(frame, carton.level);
  const spanX = Math.max(frame.innerW - size.w, 0.0001);
  const neighbors = existing.filter(
    (item) => item.id !== carton.id && item.furnitureId === carton.furnitureId && item.level === carton.level,
  );
  const next = resolveAlong(clamp01(along), carton, neighbors, size.w, spanX);
  return { ...carton, along: next };
}

function findAlong(hint: number, neighbors: Carton[], boxW: number, spanX: number) {
  const minSep = spanX <= 0 ? 1 : (boxW + GAP) / spanX;
  const sorted = [...neighbors].sort((a, b) => a.along - b.along);
  if (!overlapsAny(hint, sorted, minSep)) return clamp01(hint);
  for (const start of [hint, 0, ...sorted.map((item) => item.along + minSep)]) {
    const along = clamp01(start);
    if (!overlapsAny(along, sorted, minSep)) return along;
  }
  return null;
}

function resolveAlong(
  hint: number,
  self: Carton,
  neighbors: Carton[],
  boxW: number,
  spanX: number,
) {
  const minSep = spanX <= 0 ? 1 : (boxW + GAP) / spanX;
  if (!overlapsAny(hint, neighbors, minSep)) return hint;
  return self.along;
}

function overlapsAny(along: number, neighbors: Carton[], minSep: number) {
  return neighbors.some((item) => Math.abs(item.along - along) < minSep * 0.98);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function printCartonMm() {
  const scale = SHELF_HEIGHT_MM / REAL_HEIGHT_MM;
  return {
    w: Math.round(CARTON_REAL_MM.w * scale),
    d: Math.round(CARTON_REAL_MM.d * scale),
    h: Math.round(CARTON_REAL_MM.h * scale),
  };
}
