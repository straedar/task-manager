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

export function worldToMeters(px: number): number {
  return (px / GRID) * METERS_PER_GRID;
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** Сторона карты, куда смотрит открытый фронт стеллажа. */
export type RackFront = "n" | "e" | "s" | "w";

/**
 * Ориентация стеллажа: длинная сторона footprint = вдоль полок (along),
 * короткая = глубина; открытый фронт — длинная грань (без крестов).
 * rotation 180° переворачивает фронт на противоположную длинную сторону.
 */
export function rackPose(obj: Pick<MapObject, "width" | "height" | "rotation">): {
  alongM: number;
  deepM: number;
  rotY: number;
  front: RackFront;
} {
  const w = worldToMeters(obj.width);
  const d = worldToMeters(obj.height);
  const flip =
    Math.round(((((obj.rotation ?? 0) % 360) + 360) % 360) / 180) % 2 === 1;

  if (obj.width >= obj.height) {
    // Вдоль X, глубина Z; фронт юг (+Z) или север (−Z)
    return {
      alongM: Math.max(w, 0.4),
      deepM: Math.max(d, 0.25),
      rotY: flip ? Math.PI : 0,
      front: flip ? "n" : "s",
    };
  }

  // Вдоль Y карты: yaw ±90°, локальный +Z → восток или запад
  return {
    alongM: Math.max(d, 0.4),
    deepM: Math.max(w, 0.25),
    rotY: flip ? -Math.PI / 2 : Math.PI / 2,
    front: flip ? "w" : "e",
  };
}

/**
 * Ориентация стола: перегородка всегда на длинной стороне (как фронт стеллажа).
 * rotation 180° переносит перегородку на противоположную длинную кромку.
 * Локально: along = длина перегородки (X), deep = глубина столешницы (Z),
 * перегородка на −Z.
 */
export function deskPose(
  obj: Pick<MapObject, "width" | "height" | "rotation">,
): {
  alongM: number;
  deepM: number;
  rotY: number;
  partitionOn: RackFront;
} {
  const pose = rackPose(obj);
  const partitionOn: RackFront =
    pose.front === "s"
      ? "n"
      : pose.front === "n"
        ? "s"
        : pose.front === "e"
          ? "w"
          : "e";
  return {
    alongM: pose.alongM,
    deepM: pose.deepM,
    rotY: pose.rotY,
    partitionOn,
  };
}

/** Точки стрелки фронта внутри прямоугольника стеллажа (локальные coords). */
export function rackFrontArrowPoints(
  width: number,
  height: number,
  front: RackFront,
): number[] {
  const cx = width / 2;
  const cy = height / 2;
  const tip = 0.92;
  const base = 0.68;
  const half = 0.16;
  switch (front) {
    case "s":
      return [
        cx - width * half,
        height * base,
        cx,
        height * tip,
        cx + width * half,
        height * base,
      ];
    case "n":
      return [
        cx - width * half,
        height * (1 - base),
        cx,
        height * (1 - tip),
        cx + width * half,
        height * (1 - base),
      ];
    case "e":
      return [
        width * base,
        cy - height * half,
        width * tip,
        cy,
        width * base,
        cy + height * half,
      ];
    case "w":
      return [
        width * (1 - base),
        cy - height * half,
        width * (1 - tip),
        cy,
        width * (1 - base),
        cy + height * half,
      ];
  }
}

/** Поворот на 90° вокруг центра; у стеллажа/паллета/стола — обмен width/height. */
export function rotateMapObject90(obj: MapObject): Partial<MapObject> {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;

  if (
    obj.type === "rack" ||
    obj.type === "pallet" ||
    obj.type === "table" ||
    obj.type === "computer_desk"
  ) {
    let width = obj.height;
    let height = obj.width;
    // Квадратный стеллаж/паллет — слегка удлиняем, чтобы ориентация была видна.
    if (
      obj.type !== "table" &&
      obj.type !== "computer_desk" &&
      Math.abs(width - height) < 1
    ) {
      width = Math.max(GRID * 2, height + GRID);
    }
    const flip =
      Math.round(((((obj.rotation ?? 0) % 360) + 360) % 360) / 180) % 2 === 1;
    return {
      x: snapToGrid(cx - width / 2),
      y: snapToGrid(cy - height / 2),
      width: snapToGrid(width) || width,
      height: snapToGrid(height) || height,
      rotation:
        obj.type === "table" || obj.type === "computer_desk"
          ? 0
          : flip
            ? 180
            : 0,
    };
  }

  return {
    rotation: (((obj.rotation ?? 0) + 90) % 360 + 360) % 360,
  };
}

/** Перевернуть открытый фронт на противоположную длинную сторону. */
export function flipRackFront(obj: MapObject): Partial<MapObject> {
  const flip =
    Math.round(((((obj.rotation ?? 0) % 360) + 360) % 360) / 180) % 2 === 1;
  return { rotation: flip ? 0 : 180 };
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

/** Ортогональный сегмент стены/окна + конечная точка для продолжения цепочки. */
export function wallSegmentFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): {
  rect: { x: number; y: number; width: number; height: number };
  end: { x: number; y: number };
} | null {
  const start = { x: snapToGrid(a.x), y: snapToGrid(a.y) };
  const aimed = { x: snapToGrid(b.x), y: snapToGrid(b.y) };
  const end =
    Math.abs(aimed.x - start.x) >= Math.abs(aimed.y - start.y)
      ? { x: aimed.x, y: start.y }
      : { x: start.x, y: aimed.y };
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  if (len < GRID - 0.5) return null;
  return { rect: wallRectFromPoints(start, end), end };
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

  // normalizeSegmentObject исторически приводил "старые тонкие" стены,
  // где координаты хранились в другом формате (ось вместо границы).
  // Сейчас новые стены создаются через edge-based координаты,
  // и повторная нормализация будет смещать их.
  const EPS = 0.0001;
  const alignedX = Math.abs(obj.x - snapToGrid(obj.x)) < EPS;
  const alignedY = Math.abs(obj.y - snapToGrid(obj.y)) < EPS;
  const horizontal = obj.width >= obj.height;

  if (horizontal) {
    // Для горизонтальных стен ожидаем "толщину" ровно в 1 GRID (edge-based y кратен GRID).
    if (Math.abs(obj.height - GRID) < EPS && alignedY) return false;
  } else {
    // Для вертикальных стен ожидаем width = 1 GRID (edge-based x кратен GRID).
    if (Math.abs(obj.width - GRID) < EPS && alignedX) return false;
  }

  // Любое другое состояние считаем потенциально "старым" и требующим нормализации.
  return true;
}

export function clampScale(scale: number): number {
  return Math.min(4, Math.max(0.02, scale));
}

export function snapsToMapGrid(type: ObjectType): boolean {
  return (
    type === "rack" ||
    type === "pallet" ||
    type === "zone" ||
    type === "table" ||
    type === "computer_desk" ||
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
      return { minSide: GRID * 6, minLong: GRID * 6 };
    case "table":
      return { minSide: GRID, minLong: GRID * 2 };
    case "computer_desk":
      return { minSide: GRID, minLong: GRID * 2 };
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
  paddingRatio = 0.06,
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
        label: "Компьютерный стол",
        x,
        y,
        width: GRID * 13,
        height: GRID * 7,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "computer_desk":
      return {
        type,
        label: "Стол",
        x,
        y,
        width: GRID * 13,
        height: GRID * 7,
        shelvesCount: null,
        rotation: 0,
        frameWidth: null,
        rackTheme: null,
      };
    case "chair":
      return {
        type,
        label: "Кресло",
        x,
        y,
        width: GRID * 6,
        height: GRID * 6,
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
  table: "#cbb892",
  computer_desk: "#bfa67f",
  chair: "#2a2e34",
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
  { type: "table", label: "Компьютерный стол" },
  { type: "computer_desk", label: "Стол" },
  { type: "chair", label: "Кресло" },
];
