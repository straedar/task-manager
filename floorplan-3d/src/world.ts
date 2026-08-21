import type { MapObject, ObjectType } from "./api";

/** Stockmap world grid cell size (pixels). */
export const GRID = 50;

/** 1 GRID unit → meters in 3D. Pallet ~2×2 cells ≈ 1.2×1.2 m. */
export const METERS_PER_GRID = 0.6;

export const WALL_HEIGHT_M = 3.6;
export const RACK_HEIGHT_M = 2.7;
export const TABLE_HEIGHT_M = 0.75;
export const CHAIR_HEIGHT_M = 0.9;
export const PALLET_HEIGHT_M = 0.15;
export const DOOR_HEIGHT_M = 2.1;
export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEIGHT_M = 1.5;

/** Поворот на 90° вокруг центра; у стеллажа/паллета/стола ориентация = обмен width/height. */
export function rotateMapObject90(obj: MapObject): Partial<MapObject> {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;

  if (obj.type === "rack" || obj.type === "pallet" || obj.type === "table") {
    let width = obj.height;
    let height = obj.width;
    // Квадрат: после обмена ничего не видно — делаем вытянутый вдоль «новой» оси
    if (Math.abs(width - height) < 1) {
      width = Math.max(GRID * 2, height + GRID);
    }
    return {
      x: snapToGrid(cx - width / 2),
      y: snapToGrid(cy - height / 2),
      width: snapToGrid(width) || width,
      height: snapToGrid(height) || height,
      rotation: 0,
    };
  }

  return {
    rotation: (((obj.rotation ?? 0) + 90) % 360 + 360) % 360,
  };
}

export function worldToMeters(px: number): number {
  return (px / GRID) * METERS_PER_GRID;
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * Стена/окно толщиной ровно в одну клетку.
 * Ось на узлах сетки → сегмент заполняет клетки вдоль прохода (без half-cell зазоров в углах).
 */
export function wallRectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  const x1 = snapToGrid(a.x);
  const y1 = snapToGrid(a.y);
  let x2 = snapToGrid(b.x);
  let y2 = snapToGrid(b.y);
  // Ортогонально: держим ось старта
  if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
    y2 = y1;
  } else {
    x2 = x1;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return {
      x: left,
      y: y1,
      width: Math.max(GRID, right - left),
      height: GRID,
    };
  }
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return {
    x: x1,
    y: top,
    width: GRID,
    height: Math.max(GRID, bottom - top),
  };
}

/** Привести старые «тонкие» стены/окна к толщине GRID на сетке. */
export function normalizeSegmentObject<T extends MapObject>(obj: T): T {
  if (obj.type !== "wall" && obj.type !== "window") return obj;

  const horizontal = obj.width >= obj.height;
  if (horizontal) {
    const axisY = snapToGrid(obj.y + obj.height / 2);
    let left = snapToGrid(obj.x);
    let right = snapToGrid(obj.x + obj.width);
    if (right <= left) right = left + GRID;
    const next = {
      ...obj,
      x: left,
      y: axisY,
      width: right - left,
      height: GRID,
    };
    return next;
  }

  const axisX = snapToGrid(obj.x + obj.width / 2);
  let top = snapToGrid(obj.y);
  let bottom = snapToGrid(obj.y + obj.height);
  if (bottom <= top) bottom = top + GRID;
  return {
    ...obj,
    x: axisX,
    y: top,
    width: GRID,
    height: bottom - top,
  };
}

export function segmentNeedsNormalize(obj: MapObject): boolean {
  if (obj.type !== "wall" && obj.type !== "window") return false;
  const n = normalizeSegmentObject(obj);
  return (
    n.x !== obj.x ||
    n.y !== obj.y ||
    n.width !== obj.width ||
    n.height !== obj.height
  );
}

export function clampScale(scale: number): number {
  return Math.min(4, Math.max(0.08, scale));
}

export function snapsToMapGrid(type: ObjectType): boolean {
  return (
    type === "rack" ||
    type === "pallet" ||
    type === "zone" ||
    type === "table" ||
    type === "wall" ||
    type === "window"
  );
}

export function minSize(type: ObjectType): { minSide: number; minLong: number } {
  switch (type) {
    case "wall":
    case "window":
      return { minSide: GRID, minLong: GRID };
    case "door":
      return { minSide: Math.round(GRID * 0.28), minLong: GRID };
    case "chair":
      return { minSide: GRID * 0.6, minLong: GRID * 0.6 };
    default:
      return { minSide: GRID, minLong: GRID };
  }
}

export function objectWorldBounds(obj: MapObject) {
  const rot = ((obj.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const bw = obj.width * cos + obj.height * sin;
  const bh = obj.width * sin + obj.height * cos;
  return {
    minX: obj.x,
    minY: obj.y,
    maxX: obj.x + bw,
    maxY: obj.y + bh,
  };
}

export function fitStageToObjects(
  objects: MapObject[],
  viewW: number,
  viewH: number,
  paddingRatio = 0.1,
): { scale: number; x: number; y: number } | null {
  if (objects.length === 0 || viewW < 40 || viewH < 40) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    const b = objectWorldBounds(obj);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  const worldW = Math.max(GRID, maxX - minX);
  const worldH = Math.max(GRID, maxY - minY);
  const pad = Math.min(viewW, viewH) * paddingRatio;
  const availW = Math.max(1, viewW - pad * 2);
  const availH = Math.max(1, viewH - pad * 2);
  const scale = clampScale(Math.min(availW / worldW, availH / worldH));
  return {
    scale,
    x: (viewW - worldW * scale) / 2 - minX * scale,
    y: (viewH - worldH * scale) / 2 - minY * scale,
  };
}

export function defaultObjectAt(
  type: ObjectType,
  world: { x: number; y: number },
): Omit<MapObject, "id"> {
  const x = snapToGrid(world.x);
  const y = snapToGrid(world.y);
  switch (type) {
    case "wall":
      return {
        type,
        label: "Стена",
        x,
        y,
        width: GRID * 4,
        height: GRID,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "window":
      return {
        type,
        label: "Окно",
        x,
        y,
        width: GRID * 2,
        height: GRID,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "door":
      return {
        type,
        label: "Дверь",
        x,
        y,
        width: GRID,
        height: Math.round(GRID * 0.28),
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "rack":
      return {
        type,
        label: "Стеллаж",
        x,
        y,
        width: GRID * 4,
        height: GRID * 2,
        shelvesCount: 5,
        rotation: 0,
        frameWidth: GRID * 4,
        rackTheme: "blue",
      };
    case "pallet":
      return {
        type,
        label: "Паллет",
        x,
        y,
        width: GRID * 2,
        height: GRID * 2,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "zone":
      return {
        type,
        label: "Жёлтая зона",
        x,
        y,
        width: GRID * 4,
        height: GRID * 4,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "table":
      return {
        type,
        label: "Стол",
        x,
        y,
        width: GRID * 2,
        height: GRID,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "chair":
      return {
        type,
        label: "Стул",
        x,
        y,
        width: GRID,
        height: GRID,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
  }
}

export const OBJECT_FILL: Record<ObjectType, string> = {
  rack: "#3a4550",
  pallet: "#b8956a",
  zone: "rgba(250, 204, 21, 0.32)",
  wall: "#1a1d22",
  window: "#7eb6d4",
  door: "#a67c52",
  table: "#6b5344",
  chair: "#5a6a4a",
};

export const LABELED_TYPES: ReadonlySet<ObjectType> = new Set([
  "rack",
  "pallet",
  "zone",
]);

export const TOOL_LABELS: { type: ObjectType; label: string }[] = [
  { type: "wall", label: "Стена" },
  { type: "window", label: "Окно" },
  { type: "door", label: "Дверь" },
  { type: "rack", label: "Стеллаж" },
  { type: "pallet", label: "Паллет" },
  { type: "zone", label: "Жёлтая зона" },
  { type: "table", label: "Стол" },
  { type: "chair", label: "Стул" },
];
