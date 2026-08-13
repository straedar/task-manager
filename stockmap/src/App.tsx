import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text,
  Line,
  Transformer,
  Group,
  Circle,
  Arc,
} from "react-konva";
import type Konva from "konva";
import {
  createObject,
  createShelfItem,
  deleteObject,
  deleteShelfItem,
  fetchMe,
  listObjects,
  listShelfItems,
  replaceRackItems,
  searchWarehouse,
  setShelfItemContents,
  updateObject,
  updateShelfItem,
  type AuthUser,
  type MapObject,
  type ObjectType,
  type RackTheme,
  type ShelfItem,
  type ShelfItemType,
  type WarehouseSearchHit,
} from "./api";
import { CatalogContentsPicker, type CatalogPick } from "./CatalogContentsPicker";
import { LoginScreen } from "./LoginScreen";
import { PalletInterior } from "./PalletInterior";
import { useDialog } from "./DialogContext";
import { readAccentColor } from "./uiTheme";

type DraftRect = { x: number; y: number; width: number; height: number };
type WorldPoint = { x: number; y: number };
type ShelfDropTarget = {
  shelfIndex: number;
  depthRow: number;
  /** null — курсор над полкой, но свободного места нет */
  posX: number | null;
};

const MAX_SHELF_ROWS = 8;

const WALL_THICKNESS = 26;
const DOOR_THICKNESS = 18;
const WINDOW_THICKNESS = 24;

/** Базовый шаг сетки. Для длины/ширины стеллажа = одна клетка. */
const GRID = 50;
const RACK_SIZE_MIN = GRID; // минимум 1 клетка
/** Без жёсткого потолка — только сетка и минимум. */
const RACK_SIZE_MAX = GRID * 200;
const RACK_DEFAULT_WIDTH = GRID * 2; // 2 клетки
const RACK_DEFAULT_LENGTH = GRID * 2;

function normalizeRackTheme(value: unknown): RackTheme {
  if (value === "black") return "black";
  // legacy "orange" theme → black frame + orange shelves
  if (value === "orange") return "black";
  return "blue";
}

function rackMapColors(theme: RackTheme, selected: boolean) {
  // Фиксированные цвета стеллажа — не зависят от системной/хаб-темы.
  switch (theme) {
    case "black":
      return {
        shadow: "#0a0c0e",
        fill: selected ? "#2a2e34" : "#1a1d22",
        stroke: selected ? "#f0a05a" : "#0d0f12",
        top: "#e07a2f",
        text: "#f2f4f6",
        ring: "#e07a2f",
      };
    case "blue":
    default:
      return {
        shadow: "#1a2a34",
        fill: selected ? "#2f6f8f" : "#3a5568",
        stroke: selected ? "#7eb6d4" : "#243846",
        top: "#5ba3c9",
        text: "#f4f8fb",
        ring: "#5ba3c9",
      };
  }
}
const SCALE_MIN = 0.08;
const SCALE_MAX = 3;
const SCALE_STEP = 1.12;
/** Макс. зум внутри стеллажа: выше — «мыло» у CSS-градиентов и подписей. */
const VIEW_SCALE_MAX = 2.5;
const ENTITY_GAP = 6;
/** Максимум сущностей в одном столбце стека. */
const MAX_STACK = 4;
/** Ячеек сетки на ширину стандартной коробки (больше = мельче шаг). */
const SHELF_CELLS_PER_BOX = 6;
const DEFAULT_FRAME_WIDTH = 720;
const FRAME_WIDTH_MIN = 360;
const FRAME_WIDTH_MAX = 1600;
/** Задержка перед появлением «Отделить» после выбора коробки. */
const UNSTACK_ARM_MS = 300;

function snapToGridValue(value: number, enabled = true) {
  if (!enabled) return Math.round(value);
  return Math.round(value / GRID) * GRID;
}

/** Ширина/длина объекта на сетке — только целые клетки. */
function snapRackSize(value: number) {
  const snapped = Math.round(value / GRID) * GRID;
  return Math.min(
    RACK_SIZE_MAX,
    Math.max(RACK_SIZE_MIN, snapped || RACK_SIZE_MIN),
  );
}

function snapsToMapGrid(type: ObjectType) {
  return (
    type === "rack" ||
    type === "pallet" ||
    type === "zone" ||
    type === "table"
  );
}

/** Порядок отрисовки: зона снизу, стены, двери, окна поверх стен, остальное сверху. */
function mapObjectDrawOrder(type: ObjectType) {
  switch (type) {
    case "zone":
      return 0;
    case "wall":
      return 1;
    case "door":
      return 2;
    case "window":
      return 3;
    default:
      return 4;
  }
}

/** Подпись на карте: растёт при отдалении камеры, но не вылезает из объекта. */
/**
 * Размер подписи на карте: компенсирует зум (примерно targetScreenPx на экране),
 * но не увеличивается дальше, чем влезает вся строка в объект — без «…»/точки.
 */
function mapLabelFontSize(
  width: number,
  height: number,
  stageScale: number,
  text: string,
  opts?: {
    targetScreenPx?: number;
    maxShareW?: number;
    maxShareH?: number;
    padding?: number;
  },
) {
  const target = opts?.targetScreenPx ?? 15;
  const pad = opts?.padding ?? 0;
  const maxW = Math.max(4, (width - pad * 2) * (opts?.maxShareW ?? 0.92));
  const maxH = Math.max(4, (height - pad * 2) * (opts?.maxShareH ?? 0.5));
  const desired = target / Math.max(stageScale, 0.05);
  const label = text.trim() || " ";
  // ширина символа ~0.72em — с запасом под кириллицу и bold
  const maxByText = maxW / (label.length * 0.72);
  return Math.max(2, Math.min(desired, maxH, maxByText));
}

/** Контур выделения для тонких объектов (стена / окно / дверь). */
function SegmentSelectionOutline({
  width,
  height,
  stageScale = 1,
  color,
  x = 0,
  y = 0,
}: {
  width: number;
  height: number;
  stageScale?: number;
  color?: string;
  x?: number;
  y?: number;
}) {
  const accent = color ?? readAccentColor();
  const pad = Math.max(4, 6 / Math.max(stageScale, 0.08));
  const stroke = Math.max(2.5, 3.5 / Math.max(stageScale, 0.08));
  return (
    <Rect
      x={x - pad}
      y={y - pad}
      width={width + pad * 2}
      height={height + pad * 2}
      fill="transparent"
      stroke={accent}
      strokeWidth={stroke}
      cornerRadius={0}
      listening={false}
      opacity={0.95}
    />
  );
}

/**
 * Визуальный бокс стены/окна/двери: удлиняем на полтолщины с каждого торца,
 * чтобы на внешних углах не было «дырки» при стыке двух сегментов.
 */
function segmentDrawBox(width: number, height: number) {
  const thick = Math.min(width, height);
  const horizontal = width >= height;
  if (horizontal) {
    return {
      x: -thick / 2,
      y: 0,
      width: width + thick,
      height,
      horizontal: true as const,
      thick,
    };
  }
  return {
    x: 0,
    y: -thick / 2,
    width,
    height: height + thick,
    horizontal: false as const,
    thick,
  };
}

/** Ресайз стеллажа по сетке: неподвижный край остаётся на месте. */
function snapRackBox(
  start: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number },
  anchor?: string | null,
) {
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  const nextRight = next.x + next.width;
  const nextBottom = next.y + next.height;

  const anchorName = anchor ?? "";
  const moveLeft = anchorName.includes("left");
  const moveRight = anchorName.includes("right");
  const moveTop = anchorName.includes("top");
  const moveBottom = anchorName.includes("bottom");

  // Если якорь неизвестен — смотрим, какой край сдвинулся сильнее.
  const fallLeft =
    !anchorName &&
    Math.abs(next.x - start.x) >= Math.abs(nextRight - startRight);
  const fallRight =
    !anchorName &&
    Math.abs(nextRight - startRight) > Math.abs(next.x - start.x);
  const fallTop =
    !anchorName &&
    Math.abs(next.y - start.y) >= Math.abs(nextBottom - startBottom);
  const fallBottom =
    !anchorName &&
    Math.abs(nextBottom - startBottom) > Math.abs(next.y - start.y);

  const doLeft = moveLeft || fallLeft;
  const doRight = moveRight || fallRight;
  const doTop = moveTop || fallTop;
  const doBottom = moveBottom || fallBottom;

  let left: number;
  let right: number;
  let top: number;
  let bottom: number;

  if (doLeft && !doRight) {
    right = snapToGridValue(startRight);
    left = right - snapRackSize(right - next.x);
  } else if (doRight && !doLeft) {
    left = snapToGridValue(start.x);
    right = left + snapRackSize(nextRight - left);
  } else if (doLeft && doRight) {
    left = snapToGridValue(next.x);
    right = left + snapRackSize(nextRight - next.x);
  } else {
    left = snapToGridValue(start.x);
    right = left + snapRackSize(start.width);
  }

  if (doTop && !doBottom) {
    bottom = snapToGridValue(startBottom);
    top = bottom - snapRackSize(bottom - next.y);
  } else if (doBottom && !doTop) {
    top = snapToGridValue(start.y);
    bottom = top + snapRackSize(nextBottom - top);
  } else if (doTop && doBottom) {
    top = snapToGridValue(next.y);
    bottom = top + snapRackSize(nextBottom - next.y);
  } else {
    top = snapToGridValue(start.y);
    bottom = top + snapRackSize(start.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(RACK_SIZE_MIN, right - left),
    height: Math.max(RACK_SIZE_MIN, bottom - top),
  };
}

function absBoxToWorld(
  box: { x: number; y: number; width: number; height: number },
  stage: {
    x: () => number;
    y: () => number;
    scaleX: () => number;
    scaleY: () => number;
  },
) {
  const sx = stage.scaleX() || 1;
  const sy = stage.scaleY() || 1;
  return {
    x: (box.x - stage.x()) / sx,
    y: (box.y - stage.y()) / sy,
    width: box.width / sx,
    height: box.height / sy,
  };
}

function worldBoxToAbs(
  box: { x: number; y: number; width: number; height: number },
  stage: {
    x: () => number;
    y: () => number;
    scaleX: () => number;
    scaleY: () => number;
  },
) {
  const sx = stage.scaleX() || 1;
  const sy = stage.scaleY() || 1;
  return {
    x: box.x * sx + stage.x(),
    y: box.y * sy + stage.y(),
    width: box.width * sx,
    height: box.height * sy,
  };
}

const TOOLS: { type: ObjectType; title: string }[] = [
  { type: "rack", title: "Стеллаж" },
  { type: "pallet", title: "Паллет" },
  { type: "zone", title: "Жёлтая зона" },
  { type: "wall", title: "Стена" },
  { type: "window", title: "Окно" },
  { type: "door", title: "Дверь" },
  { type: "table", title: "Стол" },
  { type: "chair", title: "Стул" },
];

function clampScale(value: number) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function objectWorldBounds(obj: MapObject) {
  const rot = (((obj.rotation ?? 0) % 360) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const corners = [
    { x: 0, y: 0 },
    { x: obj.width, y: 0 },
    { x: obj.width, y: obj.height },
    { x: 0, y: obj.height },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    const x = obj.x + p.x * cos - p.y * sin;
    const y = obj.y + p.x * sin + p.y * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Масштаб и сдвиг так, чтобы всё нарисованное влезло в экран. */
function fitStageToObjects(
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

function clearDomSelection() {
  const sel = window.getSelection?.();
  sel?.removeAllRanges();
}

function entityPixelWidth(
  item: Pick<ShelfItem, "widthRatio" | "type">,
  shelfHeight: number,
) {
  const heightFactor = item.type === "stack" ? 0.55 : 0.99;
  return Math.max(
    item.type === "stack" ? 56 : 24,
    shelfHeight * heightFactor * (item.widthRatio || 1),
  );
}

/** Ширина одной ячейки полки (мелкая сетка ≈ 1/4 стандартной коробки). */
function shelfCellSize(shelfHeight: number) {
  const box = Math.max(24, shelfHeight * 0.99);
  return Math.max(12, Math.round(box / SHELF_CELLS_PER_BOX));
}

/** Шаг сетки без лишнего зазора — плотность задаёт cellsForWidth. */
function shelfCellStride(shelfHeight: number) {
  return shelfCellSize(shelfHeight);
}

function cellsForWidth(width: number, shelfHeight: number) {
  const cell = shelfCellSize(shelfHeight);
  // Занимаем ячейки под корпус + небольшой зазор до соседа
  return Math.max(1, Math.ceil((width + ENTITY_GAP) / cell - 1e-9));
}

function cellIndexFromPos(posX: number, shelfHeight: number) {
  const stride = shelfCellStride(shelfHeight);
  if (stride <= 0) return 0;
  return Math.round(posX / stride);
}

function posFromCellIndex(index: number, shelfHeight: number) {
  return Math.max(0, Math.round(index) * shelfCellStride(shelfHeight));
}

function snapToShelfCell(posX: number, shelfHeight: number) {
  return posFromCellIndex(cellIndexFromPos(posX, shelfHeight), shelfHeight);
}

function occupiedCellIndices(
  footprints: { posX: number; width: number }[],
  shelfHeight: number,
) {
  const occupied = new Set<number>();
  for (const print of footprints) {
    const start = cellIndexFromPos(print.posX, shelfHeight);
    const span = cellsForWidth(print.width, shelfHeight);
    for (let i = 0; i < span; i += 1) occupied.add(start + i);
  }
  return occupied;
}

function maxCellIndexForWidth(
  width: number,
  shelfWidth: number,
  shelfHeight: number,
) {
  const stride = shelfCellStride(shelfHeight);
  if (stride <= 0) return -1;
  return Math.floor(Math.max(0, shelfWidth - width) / stride);
}

/**
 * Свободная позиция на сетке полок. Одна колонка = одна или несколько ячеек.
 * null — нет свободной ячейки.
 */
function resolvePosNoOverlap(
  desired: number,
  width: number,
  others: { posX: number; width: number }[],
  maxRight?: number,
  shelfHeight = 120,
): number | null {
  const shelfWidth =
    maxRight != null && Number.isFinite(maxRight)
      ? maxRight
      : Number.POSITIVE_INFINITY;

  if (!(shelfWidth > 0) || width > shelfWidth) return null;

  const span = cellsForWidth(width, shelfHeight);
  const maxIndex =
    shelfWidth === Number.POSITIVE_INFINITY
      ? 200
      : maxCellIndexForWidth(width, shelfWidth, shelfHeight);
  if (maxIndex < 0) return null;

  const occupied = occupiedCellIndices(others, shelfHeight);
  const preferred = Math.min(
    maxIndex,
    Math.max(0, cellIndexFromPos(desired, shelfHeight)),
  );

  const fits = (idx: number) => {
    if (idx < 0 || idx > maxIndex) return false;
    for (let i = 0; i < span; i += 1) {
      if (occupied.has(idx + i)) return false;
    }
    return true;
  };

  for (let dist = 0; dist <= maxIndex; dist += 1) {
    if (fits(preferred + dist)) {
      return posFromCellIndex(preferred + dist, shelfHeight);
    }
    if (dist > 0 && fits(preferred - dist)) {
      return posFromCellIndex(preferred - dist, shelfHeight);
    }
  }
  return null;
}

/** Свободная позиция отдельно от существующих столбцов. null = нет места. */
function findSeparatePosX(
  preferred: number,
  width: number,
  others: { posX: number; width: number }[],
  shelfWidth: number,
  shelfHeight = 120,
): number | null {
  return resolvePosNoOverlap(
    preferred,
    width,
    others,
    shelfWidth,
    shelfHeight,
  );
}

function shelfMaxLeft(columnWidth: number, shelfWidth: number) {
  return Math.max(0, shelfWidth - Math.max(columnWidth, 24));
}

function clampToShelfBounds(
  pos: number,
  columnWidth: number,
  shelfWidth: number,
) {
  const maxLeft = shelfMaxLeft(columnWidth, shelfWidth);
  return Math.min(maxLeft, Math.max(0, Math.round(pos)));
}

function isFreeColumnPos(
  pos: number,
  columnWidth: number,
  shelfWidth: number,
  others: { posX: number; width: number }[],
  shelfHeight = 120,
) {
  const width = Math.max(columnWidth, 24);
  const snapped = snapToShelfCell(pos, shelfHeight);
  if (Math.abs(snapped - pos) > 0.5) return false;
  const maxIndex = maxCellIndexForWidth(width, shelfWidth, shelfHeight);
  const idx = cellIndexFromPos(snapped, shelfHeight);
  if (idx < 0 || idx > maxIndex) return false;
  const occupied = occupiedCellIndices(others, shelfHeight);
  const span = cellsForWidth(width, shelfHeight);
  for (let i = 0; i < span; i += 1) {
    if (occupied.has(idx + i)) return false;
  }
  return true;
}

function groupShelfFootprints(
  shelfItems: ShelfItem[],
  shelfHeight: number,
): { posX: number; width: number; ids: number[] }[] {
  const byPos = new Map<number, ShelfItem[]>();
  for (const item of shelfItems) {
    const list = byPos.get(item.posX) ?? [];
    list.push(item);
    byPos.set(item.posX, list);
  }

  const footprints: { posX: number; width: number; ids: number[] }[] = [];
  for (const [posX, group] of byPos) {
    const width = Math.max(
      ...group.map((item) => entityPixelWidth(item, shelfHeight)),
    );
    footprints.push({
      posX,
      width,
      ids: group.map((item) => item.id),
    });
  }
  return footprints.sort((a, b) => a.posX - b.posX);
}

function sameStackColumn(a: ShelfItem, b: ShelfItem) {
  return (
    a.shelfIndex === b.shelfIndex &&
    (a.depthRow ?? 1) === (b.depthRow ?? 1) &&
    a.posX === b.posX
  );
}

function stackColumnItems(all: ShelfItem[], item: ShelfItem) {
  return all
    .filter((entry) => sameStackColumn(entry, item))
    .sort((a, b) => a.stackOrder - b.stackOrder || a.id - b.id);
}

/**
 * Драг: только по ячейкам сетки, без наезда на занятые.
 */
function slideDragPos(
  desired: number,
  columnWidth: number,
  shelfWidth: number,
  others: { posX: number; width: number }[],
  lastGood: number,
  shelfHeight = 120,
) {
  const width = Math.max(columnWidth, 24);
  const origin = snapToShelfCell(
    clampToShelfBounds(lastGood, width, shelfWidth),
    shelfHeight,
  );
  const target = snapToShelfCell(
    clampToShelfBounds(desired, width, shelfWidth),
    shelfHeight,
  );
  if (target === origin) return origin;
  if (isFreeColumnPos(target, width, shelfWidth, others, shelfHeight)) {
    return target;
  }

  const stride = shelfCellStride(shelfHeight);
  const step = target > origin ? stride : -stride;
  let best = origin;
  for (
    let p = origin + step;
    step > 0 ? p <= target : p >= target;
    p += step
  ) {
    if (!isFreeColumnPos(p, width, shelfWidth, others, shelfHeight)) break;
    best = p;
  }
  return best;
}

function readColumnPosX(column: HTMLElement | null, fallback: number) {
  if (!column) return fallback;
  const inline = column.style.left.trim();
  if (inline.endsWith("px")) {
    const parsed = Number.parseFloat(inline);
    if (Number.isFinite(parsed)) return parsed;
  }
  return column.offsetLeft;
}

function packShelfItems(
  shelfItems: ShelfItem[],
  shelfHeight: number,
  shelfWidth?: number,
): ShelfItem[] {
  const footprints = groupShelfFootprints(shelfItems, shelfHeight);
  let nextCell = 0;
  const posById = new Map<number, number>();
  for (const print of footprints) {
    const span = cellsForWidth(print.width, shelfHeight);
    let cell = Math.max(nextCell, cellIndexFromPos(print.posX, shelfHeight));
    let posX = posFromCellIndex(cell, shelfHeight);
    if (shelfWidth != null) {
      const maxIdx = maxCellIndexForWidth(print.width, shelfWidth, shelfHeight);
      cell = Math.min(cell, Math.max(0, maxIdx));
      posX = posFromCellIndex(cell, shelfHeight);
    }
    nextCell = cell + span;
    for (const id of print.ids) posById.set(id, posX);
  }
  return shelfItems.map((item) => {
    const next = posById.get(item.id);
    if (next == null || next === item.posX) return item;
    return { ...item, posX: next };
  });
}

function nextFreePos(
  shelfItems: ShelfItem[],
  width: number,
  shelfHeight: number,
  shelfWidth?: number,
): number | null {
  const others = groupShelfFootprints(shelfItems, shelfHeight).map((print) => ({
    posX: print.posX,
    width: print.width,
  }));
  return resolvePosNoOverlap(0, width, others, shelfWidth, shelfHeight);
}

function clampFrameWidth(value: number) {
  return Math.min(FRAME_WIDTH_MAX, Math.max(FRAME_WIDTH_MIN, Math.round(value)));
}

function getWorldPointer(stage: Konva.Stage) {
  const pointer = stage.getPointerPosition();
  if (!pointer) return null;
  return {
    x: (pointer.x - stage.x()) / stage.scaleX(),
    y: (pointer.y - stage.y()) / stage.scaleY(),
  };
}

function snapToGrid(point: WorldPoint, enabled: boolean): WorldPoint {
  if (!enabled) return point;
  return {
    x: Math.round(point.x / GRID) * GRID,
    y: Math.round(point.y / GRID) * GRID,
  };
}

/** Узлы сетки для осевых объектов (стена / окно / дверь) — всегда. */
function snapWallPoint(point: WorldPoint): WorldPoint {
  return {
    x: Math.round(point.x / GRID) * GRID,
    y: Math.round(point.y / GRID) * GRID,
  };
}

function segmentThickness(type: "wall" | "door" | "window") {
  if (type === "door") return DOOR_THICKNESS;
  if (type === "window") return WINDOW_THICKNESS;
  return WALL_THICKNESS;
}

/**
 * Стена/окно/дверь: ось лежит на линии сетки (горизонталь или вертикаль),
 * торцы — в узлах сетки. Не «по клеткам площади», а по границам клеток.
 */
function snapSegmentRect(
  type: "wall" | "door" | "window",
  rect: { x: number; y: number; width: number; height: number },
) {
  const thickness = segmentThickness(type);
  const horizontal = Math.abs(rect.width) >= Math.abs(rect.height);
  if (horizontal) {
    const yCenter = snapToGridValue(rect.y + rect.height / 2);
    let left = snapToGridValue(rect.x);
    let right = snapToGridValue(rect.x + rect.width);
    if (right === left) right = left + GRID;
    if (right < left) [left, right] = [right, left];
    return {
      x: left,
      y: yCenter - thickness / 2,
      width: right - left,
      height: thickness,
    };
  }
  const xCenter = snapToGridValue(rect.x + rect.width / 2);
  let top = snapToGridValue(rect.y);
  let bottom = snapToGridValue(rect.y + rect.height);
  if (bottom === top) bottom = top + GRID;
  if (bottom < top) [top, bottom] = [bottom, top];
  return {
    x: xCenter - thickness / 2,
    y: top,
    width: thickness,
    height: bottom - top,
  };
}

/** Ось стены: строго горизонталь или вертикаль от точки a. */
function orthogonalWallEnd(a: WorldPoint, b: WorldPoint): WorldPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: b.x, y: a.y };
  }
  return { x: a.x, y: b.y };
}

/** Отрезок → объект на карте (стены/двери — тонкая полоса по оси сетки). */
function segmentToDraft(
  type: ObjectType,
  a: WorldPoint,
  b: WorldPoint,
): DraftRect | null {
  if (type === "chair") {
    const side = 36;
    return {
      x: b.x - side / 2,
      y: b.y - side / 2,
      width: side,
      height: side,
    };
  }

  if (type === "wall" || type === "door" || type === "window") {
    const start = snapWallPoint(a);
    const aimed = snapWallPoint(b);
    const end = orthogonalWallEnd(start, aimed);
    const axisEnd = {
      x: snapToGridValue(end.x),
      y: snapToGridValue(end.y),
    };
    // держим ось: для горизонтали y старта, для вертикали x старта
    const finalEnd =
      Math.abs(axisEnd.x - start.x) >= Math.abs(axisEnd.y - start.y)
        ? { x: axisEnd.x, y: start.y }
        : { x: start.x, y: axisEnd.y };
    const dx = finalEnd.x - start.x;
    const dy = finalEnd.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < GRID - 0.5) return null;
    const thickness = segmentThickness(type);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return snapSegmentRect(type, {
        x: Math.min(start.x, finalEnd.x),
        y: start.y - thickness / 2,
        width: Math.abs(dx),
        height: thickness,
      });
    }
    return snapSegmentRect(type, {
      x: start.x - thickness / 2,
      y: Math.min(start.y, finalEnd.y),
      width: thickness,
      height: Math.abs(dy),
    });
  }

  // стеллаж / стол — прямоугольник по двум углам
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
  return { x: a.x, y: a.y, width: dx, height: dy };
}

function wallSegmentFromPoints(
  type: "wall" | "door" | "window",
  a: WorldPoint,
  b: WorldPoint,
): { rect: DraftRect; end: WorldPoint } | null {
  const start = snapWallPoint(a);
  const aimed = snapWallPoint(b);
  const endRaw = orthogonalWallEnd(start, aimed);
  const end =
    Math.abs(endRaw.x - start.x) >= Math.abs(endRaw.y - start.y)
      ? { x: snapToGridValue(endRaw.x), y: start.y }
      : { x: start.x, y: snapToGridValue(endRaw.y) };
  const rect = segmentToDraft(type, start, end);
  if (!rect) return null;
  return { rect, end };
}

/** Объект по двойному клику/тапу в одной точке (размер по умолчанию). */
function defaultDraftAt(type: ObjectType, pos: WorldPoint): DraftRect {
  switch (type) {
    case "wall":
    case "window":
    case "door": {
      const p = snapWallPoint(pos);
      return snapSegmentRect(type, {
        x: p.x - GRID,
        y: p.y - segmentThickness(type) / 2,
        width: GRID * 2,
        height: segmentThickness(type),
      });
    }
    case "rack":
      return {
        x: pos.x - RACK_DEFAULT_WIDTH / 2,
        y: pos.y - RACK_DEFAULT_LENGTH / 2,
        width: RACK_DEFAULT_WIDTH,
        height: RACK_DEFAULT_LENGTH,
      };
    case "pallet":
      return {
        x: snapToGridValue(pos.x - GRID),
        y: snapToGridValue(pos.y - GRID),
        width: GRID * 2,
        height: GRID * 2,
      };
    case "zone":
      return {
        x: snapToGridValue(pos.x - GRID * 2),
        y: snapToGridValue(pos.y - GRID * 2),
        width: GRID * 4,
        height: GRID * 4,
      };
    case "table":
      return {
        x: snapToGridValue(pos.x - GRID / 2),
        y: snapToGridValue(pos.y - GRID / 2),
        width: GRID,
        height: GRID,
      };
    case "chair":
    default:
      return { x: pos.x - 18, y: pos.y - 18, width: 36, height: 36 };
  }
}

const DOUBLE_TAP_MS = 340;
const DOUBLE_TAP_DIST = 16;

function buildVisibleGrid(
  viewW: number,
  viewH: number,
  scale: number,
  pos: { x: number; y: number },
) {
  // Запас на целый экран — при панорамировании без ререндера края не «обрываются».
  const pad = Math.max(GRID * 10, viewW / Math.max(scale, 0.05), viewH / Math.max(scale, 0.05));
  const worldX = -pos.x / scale - pad;
  const worldY = -pos.y / scale - pad;
  const worldW = viewW / scale + pad * 2;
  const worldH = viewH / scale + pad * 2;

  const startX = Math.floor(worldX / GRID) * GRID;
  const startY = Math.floor(worldY / GRID) * GRID;
  const endX = Math.ceil((worldX + worldW) / GRID) * GRID;
  const endY = Math.ceil((worldY + worldH) / GRID) * GRID;

  const vertical: number[][] = [];
  const horizontal: number[][] = [];

  for (let x = startX; x <= endX; x += GRID) {
    vertical.push([x, startY, x, endY]);
  }
  for (let y = startY; y <= endY; y += GRID) {
    horizontal.push([startX, y, endX, y]);
  }

  return {
    floor: {
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
    },
    vertical,
    horizontal,
  };
}

function minSize(type: ObjectType) {
  switch (type) {
    case "wall":
    case "window":
    case "door":
      return { minSide: 6, minLong: 24 };
    case "chair":
      return { minSide: 18, minLong: 18 };
    case "table":
      return { minSide: RACK_SIZE_MIN, minLong: RACK_SIZE_MIN };
    case "zone":
      return { minSide: RACK_SIZE_MIN, minLong: RACK_SIZE_MIN };
    case "pallet":
      return { minSide: RACK_SIZE_MIN, minLong: RACK_SIZE_MIN };
    case "rack":
    default:
      return { minSide: RACK_SIZE_MIN, minLong: RACK_SIZE_MIN };
  }
}

function normalizeDrawnSize(type: ObjectType, width: number, height: number) {
  let w = width;
  let h = height;

  // Стена / окно — только длина отрезка, толщина фиксирована
  if (type === "wall") {
    if (w >= h) return { width: Math.max(w, 24), height: WALL_THICKNESS };
    return { width: WALL_THICKNESS, height: Math.max(h, 24) };
  }
  if (type === "window") {
    if (w >= h) return { width: Math.max(w, 24), height: WINDOW_THICKNESS };
    return { width: WINDOW_THICKNESS, height: Math.max(h, 24) };
  }

  if (type === "door" && Math.max(w, h) >= 24) {
    if (w >= h * 2) h = Math.max(10, Math.min(h, DOOR_THICKNESS));
    else if (h >= w * 2) w = Math.max(10, Math.min(w, DOOR_THICKNESS));
  }

  if (type === "chair") {
    const side = Math.max(28, Math.min(Math.max(w, h), 44));
    return { width: side, height: side };
  }

  if (snapsToMapGrid(type)) {
    return {
      width: snapRackSize(w),
      height: snapRackSize(h),
    };
  }

  return { width: w, height: h };
}

function ObjectVisual({
  obj,
  selected,
  stageScale = 1,
}: {
  obj: MapObject;
  selected: boolean;
  stageScale?: number;
}) {
  const { width: w, height: h, type } = obj;

  if (type === "wall") {
    const box = segmentDrawBox(w, h);
    const { x: bx, y: by, width: bw, height: bh, horizontal, thick } = box;
    const long = Math.max(bw, bh);
    const hatchGap = 8;
    const hatches: number[] = [];
    for (let i = hatchGap / 2; i < long; i += hatchGap) hatches.push(i);
    return (
      <Group>
        {selected && (
          <SegmentSelectionOutline
            x={bx}
            y={by}
            width={bw}
            height={bh}
            stageScale={stageScale}
          />
        )}
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill={selected ? "#3a4550" : "#2c353e"}
          stroke={selected ? readAccentColor() : "#1a2229"}
          strokeWidth={selected ? 2 : 1}
          cornerRadius={0}
          lineJoin="miter"
        />
        {hatches.map((off) =>
          horizontal ? (
            <Line
              key={off}
              points={[
                bx + off,
                by + 1,
                bx + off - thick * 0.35,
                by + bh - 1,
              ]}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
              listening={false}
            />
          ) : (
            <Line
              key={off}
              points={[
                bx + 1,
                by + off,
                bx + bw - 1,
                by + off - thick * 0.35,
              ]}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
              listening={false}
            />
          ),
        )}
        <Rect
          x={bx + 0.75}
          y={by + 0.75}
          width={Math.max(bw - 1.5, 0)}
          height={Math.max(bh - 1.5, 0)}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={0.75}
          cornerRadius={0}
          listening={false}
        />
      </Group>
    );
  }

  if (type === "window") {
    const box = segmentDrawBox(w, h);
    const { x: bx, y: by, width: bw, height: bh, horizontal, thick } = box;
    const frame = Math.max(3, Math.min(bw, bh) * 0.22);
    return (
      <Group>
        {selected && (
          <SegmentSelectionOutline
            x={bx}
            y={by}
            width={bw}
            height={bh}
            stageScale={stageScale}
          />
        )}
        {/* Тёмная подложка — окно читается и на полу, и поверх стены */}
        <Rect
          x={bx - 1}
          y={by - 1}
          width={bw + 2}
          height={bh + 2}
          fill="#0c4a6e"
          cornerRadius={0}
          listening={false}
        />
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill={selected ? "#38bdf8" : "#0ea5e9"}
          stroke={selected ? "#f0f9ff" : "#e0f2fe"}
          strokeWidth={selected ? 3 : 2.5}
          cornerRadius={0}
          lineJoin="miter"
        />
        <Rect
          x={bx + frame}
          y={by + frame}
          width={Math.max(bw - frame * 2, 0)}
          height={Math.max(bh - frame * 2, 0)}
          fill={selected ? "rgba(224, 242, 254, 0.92)" : "rgba(186, 230, 253, 0.88)"}
          stroke="#0369a1"
          strokeWidth={1.5}
          cornerRadius={0}
          listening={false}
        />
        {horizontal ? (
          <>
            <Line
              points={[bx + bw * 0.5, by + 1, bx + bw * 0.5, by + bh - 1]}
              stroke="#075985"
              strokeWidth={Math.max(2, thick * 0.12)}
              listening={false}
            />
            <Line
              points={[bx + frame, by + bh * 0.5, bx + bw - frame, by + bh * 0.5]}
              stroke="#0284c7"
              strokeWidth={1.5}
              listening={false}
            />
          </>
        ) : (
          <>
            <Line
              points={[bx + 1, by + bh * 0.5, bx + bw - 1, by + bh * 0.5]}
              stroke="#075985"
              strokeWidth={Math.max(2, thick * 0.12)}
              listening={false}
            />
            <Line
              points={[bx + bw * 0.5, by + frame, bx + bw * 0.5, by + bh - frame]}
              stroke="#0284c7"
              strokeWidth={1.5}
              listening={false}
            />
          </>
        )}
      </Group>
    );
  }

  if (type === "zone") {
    return (
      <Group>
        <Rect
          width={w}
          height={h}
          fill={selected ? "rgba(250, 204, 21, 0.42)" : "rgba(250, 204, 21, 0.32)"}
          stroke={selected ? "#ca8a04" : "#eab308"}
          strokeWidth={selected ? 2 : 1.5}
          dash={[10, 6]}
        />
      </Group>
    );
  }

  if (type === "pallet") {
    return (
      <Group>
        <Rect
          x={2}
          y={2}
          width={w}
          height={h}
          fill="#1a2a34"
          opacity={0.16}
          listening={false}
        />
        <Rect
          width={w}
          height={h}
          fill={selected ? "#c4a574" : "#b8956a"}
          stroke={selected ? "#8a6235" : "#9a7348"}
          strokeWidth={selected ? 2 : 1.5}
          cornerRadius={3}
        />
        {[0.22, 0.5, 0.78].map((t) => (
          <Rect
            key={t}
            x={w * 0.08}
            y={h * t - 2}
            width={w * 0.84}
            height={4}
            fill="rgba(90, 55, 20, 0.35)"
            listening={false}
          />
        ))}
        <Text
          text={obj.label.trim() || "Паллет"}
          width={w}
          height={h}
          align="center"
          verticalAlign="middle"
          fontSize={mapLabelFontSize(w, h, stageScale, obj.label.trim() || "Паллет", {
            targetScreenPx: 14,
            maxShareH: 0.5,
            padding: 4,
          })}
          fontStyle="bold"
          fill="#3d2a12"
          listening={false}
          padding={4}
          wrap="none"
        />
      </Group>
    );
  }

  if (type === "door") {
    const box = segmentDrawBox(w, h);
    const { x: bx, y: by, width: bw, height: bh, horizontal } = box;
    return (
      <Group>
        {selected && (
          <SegmentSelectionOutline
            x={bx}
            y={by}
            width={bw}
            height={bh}
            stageScale={stageScale}
          />
        )}
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          fill={selected ? "#8aa4b5" : "#6f8796"}
          stroke={selected ? readAccentColor() : "#455864"}
          strokeWidth={selected ? 2.5 : 1.5}
          dash={[6, 4]}
          cornerRadius={0}
          lineJoin="miter"
        />
        {horizontal ? (
          <Arc
            x={bx}
            y={by + bh / 2}
            innerRadius={0}
            outerRadius={Math.max(bw * 0.85, 20)}
            angle={90}
            rotation={-90}
            stroke="#5a7382"
            strokeWidth={1.5}
            listening={false}
          />
        ) : (
          <Arc
            x={bx + bw / 2}
            y={by}
            innerRadius={0}
            outerRadius={Math.max(bh * 0.85, 20)}
            angle={90}
            rotation={0}
            stroke="#5a7382"
            strokeWidth={1.5}
            listening={false}
          />
        )}
      </Group>
    );
  }

  if (type === "table") {
    return (
      <Group>
        <Rect
          x={2}
          y={2}
          width={w}
          height={h}
          fill="#1a2a34"
          opacity={0.18}
          listening={false}
        />
        <Rect
          width={w}
          height={h}
          fill={selected ? "#d7c4a3" : "#cbb892"}
          stroke={selected ? "#8a6f3e" : "#9a8050"}
          strokeWidth={selected ? 2 : 1.5}
          cornerRadius={4}
        />
        <Rect
          x={w * 0.18}
          y={h * 0.18}
          width={w * 0.64}
          height={h * 0.64}
          fill="rgba(255,255,255,0.18)"
          listening={false}
        />
      </Group>
    );
  }

  if (type === "chair") {
    const r = Math.min(w, h) / 2;
    return (
      <Group>
        <Circle
          x={w / 2}
          y={h / 2}
          radius={r * 0.72}
          fill={selected ? "#5f7f93" : "#4d6879"}
          stroke={selected ? "#16384a" : "#314859"}
          strokeWidth={1.5}
        />
        <Rect
          x={w * 0.18}
          y={h * 0.08}
          width={w * 0.64}
          height={h * 0.22}
          fill={selected ? "#3f5a6b" : "#355060"}
          cornerRadius={3}
          listening={false}
        />
      </Group>
    );
  }

  // rack
  const theme = normalizeRackTheme(obj.rackTheme);
  const colors = rackMapColors(theme, selected);
  const pad = 4;
  const labelW = Math.max(12, w - pad * 2);
  const labelH = Math.max(12, h - pad * 2);
  const labelText = obj.label || "Стеллаж";
  const fontSize = mapLabelFontSize(labelW, labelH, stageScale, labelText, {
    targetScreenPx: 16,
    maxShareW: 1,
    maxShareH: 1,
  });
  return (
    <Group>
      <Rect
        x={3}
        y={3}
        width={w}
        height={h}
        fill={colors.shadow}
        opacity={0.28}
        listening={false}
      />
      {selected && (
        <Rect
          x={-4}
          y={-4}
          width={w + 8}
          height={h + 8}
          fill="transparent"
          stroke={colors.ring}
          strokeWidth={3.5}
          cornerRadius={3}
          listening={false}
          opacity={0.95}
          shadowColor={colors.ring}
          shadowBlur={14}
          shadowOpacity={0.85}
        />
      )}
      <Rect
        width={w}
        height={h}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={selected ? 3 : 1.5}
      />
      <Rect
        width={w}
        height={Math.min(8, h * 0.18)}
        fill={colors.top}
        opacity={selected ? 0.95 : 0.55}
        listening={false}
      />
      <Text
        text={labelText}
        x={pad}
        y={pad}
        width={labelW}
        height={labelH}
        fontSize={fontSize}
        fontFamily="Outfit, sans-serif"
        fontStyle="600"
        fill={colors.text}
        align="center"
        verticalAlign="middle"
        wrap="none"
        listening={false}
        shadowColor="rgba(10, 18, 24, 0.65)"
        shadowBlur={4}
        shadowOpacity={0.8}
      />
    </Group>
  );
}

function MapObjectShape({
  obj,
  selected,
  drawMode,
  canEdit,
  stageScale,
  onSelect,
  onOpen,
  onEdit,
  onChange,
}: {
  obj: MapObject;
  selected: boolean;
  drawMode: boolean;
  canEdit: boolean;
  stageScale: number;
  onSelect: () => void;
  onOpen: () => void;
  onEdit?: () => void;
  onChange: (patch: Partial<MapObject>) => void;
}) {
  const shapeRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const transformStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const transformAnchorRef = useRef<string | null>(null);
  const longPressRef = useRef<{
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  const skipSelectRef = useRef(false);
  const limits = minSize(obj.type);
  const canRotate = obj.type === "door" || obj.type === "chair";
  const canResize = obj.type !== "wall" && obj.type !== "window";
  const gridSnap = snapsToMapGrid(obj.type);
  const isSegment =
    obj.type === "wall" || obj.type === "window" || obj.type === "door";
  const isEnterable = obj.type === "rack" || obj.type === "pallet";
  const showTransform = selected && !drawMode && canEdit && canResize;

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    document.body.classList.remove("long-pressing");
  };

  useEffect(() => {
    if (showTransform && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [showTransform, canRotate]);

  useEffect(() => () => clearLongPress(), []);

  return (
    <>
      <Group
        ref={shapeRef}
        name="map-object"
        id={`mo-${obj.id}`}
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        rotation={obj.rotation ?? 0}
        listening={!drawMode}
        draggable={canEdit && !drawMode && selected}
        onClick={(e) => {
          e.cancelBubble = true;
          if (drawMode) return;
          if (skipSelectRef.current) {
            skipSelectRef.current = false;
            return;
          }
          onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          if (drawMode) return;
          if (skipSelectRef.current) {
            skipSelectRef.current = false;
            return;
          }
          onSelect();
        }}
        onDblClick={(e) => {
          e.cancelBubble = true;
          if (drawMode || !isEnterable) return;
          clearLongPress();
          onOpen();
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          if (drawMode || !isEnterable) return;
          clearLongPress();
          onOpen();
        }}
        onPointerDown={(e) => {
          if (!canEdit || drawMode || !onEdit) return;
          if (obj.type !== "rack" && obj.type !== "zone") return;
          const evt = e.evt;
          if ("button" in evt && evt.button !== 0) return;
          const clientX =
            "clientX" in evt
              ? evt.clientX
              : (evt as TouchEvent).touches?.[0]?.clientX;
          const clientY =
            "clientY" in evt
              ? evt.clientY
              : (evt as TouchEvent).touches?.[0]?.clientY;
          if (clientX == null || clientY == null) return;
          clearLongPress();
          document.body.classList.add("long-pressing");
          const timer = window.setTimeout(() => {
            longPressRef.current = null;
            document.body.classList.remove("long-pressing");
            skipSelectRef.current = true;
            shapeRef.current?.stopDrag();
            onSelect();
            onEdit();
          }, 480);
          longPressRef.current = { timer, x: clientX, y: clientY };
        }}
        onPointerMove={(e) => {
          const lp = longPressRef.current;
          if (!lp) return;
          const evt = e.evt;
          const clientX =
            "clientX" in evt
              ? evt.clientX
              : (evt as TouchEvent).touches?.[0]?.clientX;
          const clientY =
            "clientY" in evt
              ? evt.clientY
              : (evt as TouchEvent).touches?.[0]?.clientY;
          if (clientX == null || clientY == null) return;
          if (Math.hypot(clientX - lp.x, clientY - lp.y) > 10) {
            clearLongPress();
          }
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        onDragStart={() => {
          clearLongPress();
        }}
        onDragEnd={(e) => {
          if (!canEdit) return;
          if (isSegment) {
            const snapped = snapSegmentRect(obj.type as "wall" | "door" | "window", {
              x: e.target.x(),
              y: e.target.y(),
              width: obj.width,
              height: obj.height,
            });
            e.target.position({ x: snapped.x, y: snapped.y });
            onChange({
              x: snapped.x,
              y: snapped.y,
              width: snapped.width,
              height: snapped.height,
            });
            return;
          }
          const x = gridSnap
            ? snapToGridValue(e.target.x(), true)
            : Math.round(e.target.x());
          const y = gridSnap
            ? snapToGridValue(e.target.y(), true)
            : Math.round(e.target.y());
          e.target.position({ x, y });
          onChange({ x, y });
        }}
        onTransformStart={() => {
          transformStartRef.current = {
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
          };
          transformAnchorRef.current =
            trRef.current?.getActiveAnchor() ?? null;
        }}
        onTransform={() => {
          const anchor = trRef.current?.getActiveAnchor();
          if (anchor) transformAnchorRef.current = anchor;
        }}
        onTransformEnd={() => {
          if (!canEdit) return;
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          let nextW = Math.max(
            limits.minSide,
            Math.round(Math.abs(node.width() * scaleX)),
          );
          let nextH = Math.max(
            limits.minSide,
            Math.round(Math.abs(node.height() * scaleY)),
          );
          let nextX = node.x();
          let nextY = node.y();
          // При ресайзе влево/вверх Konva двигает x/y вместе со scale
          if (scaleX < 0) nextX += node.width() * scaleX;
          if (scaleY < 0) nextY += node.height() * scaleY;
          if (gridSnap) {
            const start = transformStartRef.current ?? {
              x: obj.x,
              y: obj.y,
              width: obj.width,
              height: obj.height,
            };
            const snapped = snapRackBox(
              start,
              { x: nextX, y: nextY, width: nextW, height: nextH },
              transformAnchorRef.current,
            );
            nextX = snapped.x;
            nextY = snapped.y;
            nextW = snapped.width;
            nextH = snapped.height;
            node.width(nextW);
            node.height(nextH);
            node.position({ x: nextX, y: nextY });
          } else {
            nextX = Math.round(nextX);
            nextY = Math.round(nextY);
          }
          transformStartRef.current = null;
          transformAnchorRef.current = null;
          const rotation = canRotate
            ? Math.round(((((node.rotation() % 360) + 360) % 360) * 1000)) / 1000
            : 0;
          onChange({
            x: nextX,
            y: nextY,
            width: nextW,
            height: nextH,
            ...(canRotate ? { rotation } : {}),
          });
        }}
      >
        <ObjectVisual obj={obj} selected={selected} stageScale={stageScale} />
      </Group>
      {showTransform && (
        <Transformer
          ref={trRef}
          rotateEnabled={canRotate}
          rotationSnaps={[]}
          flipEnabled={false}
          borderStroke="#2f6f8f"
          anchorStroke="#16384a"
          anchorFill="#e8f1f6"
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "middle-left",
            "middle-right",
            "top-center",
            "bottom-center",
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            if (gridSnap) {
              const stage = shapeRef.current?.getStage();
              if (!stage) return oldBox;
              if (newBox.width < 0 || newBox.height < 0) return oldBox;
              const start =
                transformStartRef.current ?? absBoxToWorld(oldBox, stage);
              const next = absBoxToWorld(newBox, stage);
              if (
                next.width < RACK_SIZE_MIN * 0.35 ||
                next.height < RACK_SIZE_MIN * 0.35
              ) {
                return oldBox;
              }
              const anchor =
                trRef.current?.getActiveAnchor() ??
                transformAnchorRef.current;
              if (anchor) transformAnchorRef.current = anchor;
              const snapped = snapRackBox(start, next, anchor);
              const abs = worldBoxToAbs(snapped, stage);
              return {
                ...newBox,
                x: abs.x,
                y: abs.y,
                width: Math.max(1, abs.width),
                height: Math.max(1, abs.height),
              };
            }
            if (
              Math.min(newBox.width, newBox.height) < limits.minSide ||
              Math.max(newBox.width, newBox.height) < limits.minLong
            ) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
}

function RackInterior({
  rack,
  onBack,
  onRackChange,
  canEditMap = false,
  canEditShelves = false,
  requireShelfConfirm = false,
  focusItemId = null,
  onClearFocus,
}: {
  rack: MapObject;
  onBack: () => void;
  onRackChange: (patch: Partial<MapObject>) => void;
  canEditMap?: boolean;
  canEditShelves?: boolean;
  /** Правки полок только локально, пока не нажмут «Подтвердить». */
  requireShelfConfirm?: boolean;
  focusItemId?: number | null;
  onClearFocus?: () => void;
}) {
  const { confirm, prompt } = useDialog();
  const count = rack.shelvesCount ?? 1;
  const levels = Array.from({ length: count }, (_, i) => i + 1);
  /** Верх корпуса стеллажа (не отдельная полка) */
  const topDeckIndex = count + 1;
  const shelfTitle = (n: number) =>
    n === topDeckIndex ? "Верх стеллажа" : `Полка ${n}`;
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [shelfDirty, setShelfDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const [activeRows, setActiveRows] = useState<Record<number, number>>({});
  const [rowCounts, setRowCounts] = useState<Record<number, number>>({});
  const [rowMenuShelf, setRowMenuShelf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tempIdRef = useRef(-1);
  const itemsRef = useRef<ShelfItem[]>([]);
  const requireConfirmRef = useRef(requireShelfConfirm);
  requireConfirmRef.current = requireShelfConfirm;
  itemsRef.current = items;
  const [popup, setPopup] = useState<{
    shelf: number;
    x: number;
    y: number;
  } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [viewScale, setViewScale] = useState(1);
  const [viewPos, setViewPos] = useState({ x: 0, y: 0 });
  const [frameWidth, setFrameWidth] = useState(
    () => rack.frameWidth ?? DEFAULT_FRAME_WIDTH,
  );
  const widthSaveTimer = useRef<number | null>(null);
  const posSaveTimer = useRef<number | null>(null);
  const frameSaveTimer = useRef<number | null>(null);
  /** До этого времени не открывать карточку (анти-«клик навылет» после создания на телефоне). */
  const suppressDetailUntilRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewScaleRef = useRef(1);
  const viewPosRef = useRef({ x: 0, y: 0 });
  const frameWidthRef = useRef(frameWidth);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const pinchRef = useRef<{ lastDist: number } | null>(null);
  /** Пока pinch / короткий хвост после — не коммитить стек/перенос коробок. */
  const pinchGuardUntilRef = useRef(0);
  const longPressRef = useRef<{
    shelf: number;
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  const frameResizeRef = useRef<{
    side: "e" | "w";
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    viewScaleRef.current = viewScale;
  }, [viewScale]);
  useEffect(() => {
    viewPosRef.current = viewPos;
  }, [viewPos]);
  useEffect(() => {
    frameWidthRef.current = frameWidth;
  }, [frameWidth]);
  useEffect(() => {
    setFrameWidth(rack.frameWidth ?? DEFAULT_FRAME_WIDTH);
  }, [rack.id, rack.frameWidth]);

  useEffect(() => {
    listShelfItems(rack.id)
      .then((list) => {
        setItems(list);
        setShelfDirty(false);
        const counts: Record<number, number> = {};
        for (const entry of list) {
          const shelf = entry.shelfIndex;
          counts[shelf] = Math.max(counts[shelf] ?? 1, entry.depthRow ?? 1);
        }
        setRowCounts((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(counts)) {
            const shelf = Number(key);
            next[shelf] = Math.max(next[shelf] ?? 1, value);
          }
          return next;
        });
        if (focusItemId != null && list.some((item) => item.id === focusItemId)) {
          setDetailItemId(null);
          const focused = list.find((item) => item.id === focusItemId);
          if (focused) {
            setActiveRows((prev) => ({
              ...prev,
              [focused.shelfIndex]: focused.depthRow ?? 1,
            }));
          }
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [rack.id, focusItemId]);

  useEffect(() => {
    if (!requireShelfConfirm || !shelfDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [requireShelfConfirm, shelfDirty]);

  const markShelfDirty = useCallback(() => {
    if (requireConfirmRef.current) setShelfDirty(true);
  }, []);

  const persistShelfPatch = useCallback(
    async (
      id: number,
      patch: Parameters<typeof updateShelfItem>[1],
    ) => {
      if (requireConfirmRef.current) {
        markShelfDirty();
        return;
      }
      if (id < 0) return;
      await updateShelfItem(id, patch);
    },
    [markShelfDirty],
  );

  const commitShelfDraft = useCallback(async () => {
    if (!requireShelfConfirm) return true;
    setConfirming(true);
    setError(null);
    try {
      const snapshot = itemsRef.current.map((item) => ({
        id: item.id > 0 ? item.id : undefined,
        shelfIndex: item.shelfIndex,
        type: item.type,
        widthRatio: item.widthRatio,
        posX: item.posX,
        depthRow: item.depthRow ?? 1,
        stackOrder: item.stackOrder ?? 0,
        title: item.title,
        details: item.details,
        quantity: item.quantity,
        contents: (item.contents ?? []).map((c) => ({
          kind: c.kind,
          refId: c.refId,
          nameSnapshot: c.nameSnapshot,
          typeSnapshot: c.typeSnapshot,
          quantity: c.quantity,
        })),
      }));
      const fresh = await replaceRackItems(rack.id, snapshot);
      setItems(fresh);
      setShelfDirty(false);
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось подтвердить изменения",
      );
      return false;
    } finally {
      setConfirming(false);
    }
  }, [rack.id, requireShelfConfirm]);

  const discardShelfDraft = useCallback(async () => {
    try {
      const list = await listShelfItems(rack.id);
      setItems(list);
      setShelfDirty(false);
      setSelectedItemId(null);
      setDetailItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось откатить");
    }
  }, [rack.id]);

  const requestLeaveInterior = useCallback(async () => {
    if (requireShelfConfirm && shelfDirty) {
      const ok = await confirm({
        title: "Подтвердить изменения?",
        description:
          "Правки полок ещё не сохранены на сервере. Подтвердите, чтобы сохранить, или отмените выход.",
        confirmLabel: "Подтвердить и выйти",
      });
      if (!ok) return;
      const saved = await commitShelfDraft();
      if (!saved) return;
    }
    onBack();
  }, [
    commitShelfDraft,
    confirm,
    onBack,
    requireShelfConfirm,
    shelfDirty,
  ]);

  useEffect(() => {
    return () => {
      if (widthSaveTimer.current != null) {
        window.clearTimeout(widthSaveTimer.current);
      }
      if (posSaveTimer.current != null) {
        window.clearTimeout(posSaveTimer.current);
      }
      if (frameSaveTimer.current != null) {
        window.clearTimeout(frameSaveTimer.current);
      }
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timer);
      }
    };
  }, []);

  const estimateShelfSize = () => {
    const el = viewportRef.current?.querySelector(".shelf-items");
    if (!(el instanceof HTMLElement)) return { height: 120, width: 600 };
    return { height: el.clientHeight, width: el.clientWidth };
  };

  /** Минимальная ширина рамы, чтобы все коробки оставались в видимой зоне полки. */
  const minFrameWidthForContent = useCallback(
    (currentFrame: number) => {
      if (items.length === 0) return FRAME_WIDTH_MIN;
      const { height: shelfHeight, width: shelfWidth } = estimateShelfSize();
      const safeShelf = Math.max(shelfWidth, 1);
      let maxRight = 0;
      for (const item of items) {
        maxRight = Math.max(
          maxRight,
          (item.posX ?? 0) + entityPixelWidth(item, shelfHeight),
        );
      }
      // Небольшой запас справа, чтобы край коробки не обрезался
      const neededShelf = maxRight + ENTITY_GAP + 8;
      const chrome = Math.max(0, currentFrame - safeShelf);
      return clampFrameWidth(neededShelf + chrome);
    },
    [items],
  );

  const persistFrameWidth = useCallback(
    (next: number) => {
      const minByContent = minFrameWidthForContent(frameWidthRef.current);
      const clamped = Math.max(minByContent, clampFrameWidth(next));
      if (clamped === frameWidthRef.current) return;
      setFrameWidth(clamped);
      frameWidthRef.current = clamped;
      if (frameSaveTimer.current != null) {
        window.clearTimeout(frameSaveTimer.current);
      }
      frameSaveTimer.current = window.setTimeout(() => {
        onRackChange({ frameWidth: clamped });
      }, 120);
    },
    [minFrameWidthForContent, onRackChange],
  );

  const rowOf = (shelf: number) => activeRows[shelf] ?? 1;
  const rowCountOf = (shelf: number) =>
    Math.min(MAX_SHELF_ROWS, Math.max(1, rowCounts[shelf] ?? 1));

  const setShelfRow = (shelf: number, row: number) => {
    const max = rowCountOf(shelf);
    const next = Math.min(max, Math.max(1, Math.round(row)));
    setActiveRows((prev) => ({ ...prev, [shelf]: next }));
    setRowMenuShelf(shelf);
  };

  const addShelfRow = (shelf: number) => {
    setRowCounts((prev) => {
      const current = Math.min(MAX_SHELF_ROWS, Math.max(1, prev[shelf] ?? 1));
      if (current >= MAX_SHELF_ROWS) return prev;
      const nextCount = current + 1;
      setActiveRows((rows) => ({ ...rows, [shelf]: nextCount }));
      setRowMenuShelf(shelf);
      return { ...prev, [shelf]: nextCount };
    });
  };

  const removeShelfRow = (shelf: number) => {
    const current = rowCountOf(shelf);
    if (current <= 1) return;
    const rowToRemove = current;
    const onRow = items.filter(
      (item) =>
        item.shelfIndex === shelf && (item.depthRow ?? 1) === rowToRemove,
    );

    void (async () => {
      if (onRow.length > 0) {
        const ok = await confirm({
          title: `Удалить ряд ${rowToRemove}?`,
          description: `В ряде есть объекты (${onRow.length}). Они будут удалены вместе с рядом.`,
          confirmLabel: "Удалить ряд",
        });
        if (!ok) return;
      }

      const nextCount = current - 1;
      setRowCounts((prev) => ({ ...prev, [shelf]: nextCount }));
      setActiveRows((rows) => ({
        ...rows,
        [shelf]: Math.min(rows[shelf] ?? 1, nextCount),
      }));
      setRowMenuShelf(shelf);

      if (onRow.length === 0) return;

      const prevItems = items;
      const removeIds = new Set(onRow.map((item) => item.id));
      setItems((prev) => prev.filter((item) => !removeIds.has(item.id)));
      if (selectedItemId != null && removeIds.has(selectedItemId)) {
        setSelectedItemId(null);
      }
      if (detailItemId != null && removeIds.has(detailItemId)) {
        setDetailItemId(null);
      }

      try {
        if (requireConfirmRef.current) {
          markShelfDirty();
        } else {
          await Promise.all(
            onRow.filter((item) => item.id > 0).map((item) => deleteShelfItem(item.id)),
          );
        }
      } catch (err) {
        setItems(prevItems);
        setError(
          err instanceof Error ? err.message : "Не удалось удалить ряд",
        );
      }
    })();
  };

  const addItem = async (
    shelfIndex: number,
    type: ShelfItemType,
    stackOntoId?: number,
  ) => {
    if (!canEditShelves) return;
    try {
      const depthRow = rowOf(shelfIndex);
      const { height: shelfHeight, width: shelfWidth } = estimateShelfSize();
      const shelfItems = items.filter(
        (item) => item.shelfIndex === shelfIndex && item.depthRow === depthRow,
      );
      const width = entityPixelWidth(
        { widthRatio: type === "stack" ? 1.25 : 1, type },
        shelfHeight,
      );
      const posX = stackOntoId
        ? undefined
        : nextFreePos(shelfItems, width, shelfHeight, shelfWidth);
      if (!stackOntoId && posX == null) {
        setError("Нет места на полке");
        return;
      }

      if (requireConfirmRef.current) {
        const base = stackOntoId
          ? items.find((entry) => entry.id === stackOntoId)
          : null;
        if (stackOntoId && !base) return;
        if (stackOntoId) {
          const column = stackColumnItems(items, base!);
          if (column.length >= MAX_STACK) {
            setError(`В стеке не больше ${MAX_STACK} сущностей`);
            return;
          }
        }
        const tempId = tempIdRef.current--;
        const created: ShelfItem = {
          id: tempId,
          rackId: rack.id,
          shelfIndex,
          type,
          widthRatio: type === "stack" ? 1.25 : 1,
          posX: base ? base.posX : posX!,
          depthRow: base ? base.depthRow ?? 1 : depthRow,
          stackOrder: base
            ? Math.max(...stackColumnItems(items, base).map((e) => e.stackOrder), -1) +
              1
            : 0,
          title: "",
          details: "",
          quantity: "",
          infoUpdatedAt: null,
          contents: [],
        };
        setItems((prev) => [...prev, created]);
        markShelfDirty();
        setPopup(null);
        setSelectedItemId(created.id);
        suppressDetailUntilRef.current = Date.now() + 1200;
        setDetailItemId(null);
        return;
      }

      const created = await createShelfItem(rack.id, {
        shelfIndex,
        type,
        depthRow,
        ...(type === "stack" ? { widthRatio: 1.25 } : {}),
        ...(stackOntoId ? { stackOntoId } : { posX: posX! }),
      });
      setItems((prev) => [...prev, created]);
      setPopup(null);
      setSelectedItemId(created.id);
      // Никогда не открываем карточку сразу после создания — на телефоне
      // клик из меню иначе «пробивает» в поле и поднимает клавиатуру.
      suppressDetailUntilRef.current = Date.now() + 1200;
      setDetailItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить");
    }
  };

  const removeItem = async (id: number) => {
    if (!canEditShelves) return;
    try {
      if (requireConfirmRef.current || id < 0) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        if (selectedItemId === id) setSelectedItemId(null);
        if (detailItemId === id) setDetailItemId(null);
        if (requireConfirmRef.current) markShelfDirty();
        else if (id > 0) await deleteShelfItem(id);
        return;
      }
      await deleteShelfItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      if (selectedItemId === id) setSelectedItemId(null);
      if (detailItemId === id) setDetailItemId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const saveItemInfo = async (
    id: number,
    patch: Partial<Pick<ShelfItem, "title" | "details" | "quantity">>,
    contents?: CatalogPick[],
  ) => {
    if (!canEditShelves) return;
    try {
      if (requireConfirmRef.current || id < 0) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...patch,
                  contents: contents
                    ? contents.map((c, index) => ({
                        id: index + 1,
                        shelfItemId: id,
                        kind: c.kind,
                        refId: c.refId,
                        nameSnapshot: c.nameSnapshot,
                        typeSnapshot: c.typeSnapshot,
                        quantity: c.quantity,
                      }))
                    : item.contents,
                  infoUpdatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        markShelfDirty();
        return;
      }
      const updated = await updateShelfItem(id, patch);
      let nextContents = updated.contents ?? [];
      if (contents) {
        const res = await setShelfItemContents(
          id,
          contents.map((c) => ({
            kind: c.kind,
            refId: c.refId,
            nameSnapshot: c.nameSnapshot,
            typeSnapshot: c.typeSnapshot,
            quantity: c.quantity,
          })),
        );
        nextContents = res.items;
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...updated, contents: nextContents } : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    }
  };

  const copySelectedItem = async () => {
    if (!canEditShelves || selectedItemId == null) return;
    const source = items.find((entry) => entry.id === selectedItemId);
    if (!source) return;
    const depthRow = source.depthRow ?? 1;
    const { height: shelfHeight, width: shelfWidth } = estimateShelfSize();
    const width = entityPixelWidth(source, shelfHeight);
    const sameRow = items.filter(
      (entry) =>
        entry.shelfIndex === source.shelfIndex &&
        (entry.depthRow ?? 1) === depthRow,
    );
    const others = groupShelfFootprints(sameRow, shelfHeight).map((print) => ({
      posX: print.posX,
      width: print.width,
    }));
    const preferred = (source.posX ?? 0) + width + ENTITY_GAP;
    const nextPos = findSeparatePosX(
      preferred,
      width,
      others,
      shelfWidth,
      shelfHeight,
    );
    if (nextPos == null) {
      setError("Нет места на полке — копировать нельзя");
      return;
    }

    try {
      if (requireConfirmRef.current) {
        const tempId = tempIdRef.current--;
        const created: ShelfItem = {
          ...source,
          id: tempId,
          posX: nextPos,
          stackOrder: 0,
          contents: (source.contents ?? []).map((c, index) => ({
            ...c,
            id: index + 1,
            shelfItemId: tempId,
          })),
        };
        setItems((prev) => [...prev, created]);
        markShelfDirty();
        setSelectedItemId(tempId);
        return;
      }

      const created = await createShelfItem(rack.id, {
        shelfIndex: source.shelfIndex,
        type: source.type,
        depthRow,
        widthRatio: source.widthRatio,
        posX: nextPos,
      });
      const updated = await updateShelfItem(created.id, {
        title: source.title,
        details: source.details,
        quantity: source.quantity,
        widthRatio: source.widthRatio,
        posX: nextPos,
      });
      let nextContents = updated.contents ?? [];
      if ((source.contents ?? []).length > 0) {
        const res = await setShelfItemContents(
          created.id,
          (source.contents ?? []).map((c) => ({
            kind: c.kind,
            refId: c.refId,
            nameSnapshot: c.nameSnapshot,
            typeSnapshot: c.typeSnapshot,
            quantity: c.quantity,
          })),
        );
        nextContents = res.items;
      }
      setItems((prev) => [...prev, { ...updated, contents: nextContents }]);
      setSelectedItemId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось скопировать");
    }
  };

  const setItemWidth = useCallback(
    (
      id: number,
      widthRatio: number,
      shelfHeight: number,
      side: "e" | "w",
      shelfWidth: number,
    ) => {
      setItems((prev) => {
        const item = prev.find((entry) => entry.id === id);
        if (!item) return prev;

        const sameRow = prev.filter(
          (entry) =>
            entry.shelfIndex === item.shelfIndex &&
            entry.depthRow === item.depthRow,
        );
        const footprints = groupShelfFootprints(sameRow, shelfHeight).filter(
          (print) => !print.ids.includes(id),
        );
        const others = footprints.map((print) => ({
          posX: print.posX,
          width: print.width,
        }));

        const heightFactor = item.type === "stack" ? 0.55 : 0.99;
        const minR = item.type === "stack" ? 0.6 : 1;
        const maxR = 2.5;
        let nextRatio = Math.min(
          maxR,
          Math.max(minR, Math.round(widthRatio * 100) / 100),
        );
        let nextPos = item.posX || 0;
        const oldWidth = entityPixelWidth(item, shelfHeight);
        const shelfLimit = Math.max(shelfWidth, oldWidth);

        if (side === "e") {
          const rightLimit = others
            .filter((o) => o.posX >= nextPos - 1)
            .reduce(
              (min, o) => Math.min(min, o.posX - ENTITY_GAP),
              shelfLimit,
            );
          const maxWidth = Math.max(20, rightLimit - nextPos);
          const maxRatio = maxWidth / Math.max(shelfHeight * heightFactor, 1);
          nextRatio = Math.min(nextRatio, Math.max(minR, maxRatio));
        } else {
          const leftNeighbor = others
            .filter((o) => o.posX + o.width <= nextPos + oldWidth + 1)
            .sort((a, b) => b.posX + b.width - (a.posX + a.width))[0];
          const leftLimit = leftNeighbor
            ? leftNeighbor.posX + leftNeighbor.width + ENTITY_GAP
            : 0;
          const rightEdge = Math.min(nextPos + oldWidth, shelfLimit);
          const maxWidth = Math.max(20, rightEdge - leftLimit);
          const maxRatio = maxWidth / Math.max(shelfHeight * heightFactor, 1);
          nextRatio = Math.min(nextRatio, Math.max(minR, maxRatio));
          const nextWidth = entityPixelWidth(
            { widthRatio: nextRatio, type: item.type },
            shelfHeight,
          );
          nextPos = Math.max(leftLimit, rightEdge - nextWidth);
        }

        const fittedWidth = entityPixelWidth(
          { widthRatio: nextRatio, type: item.type },
          shelfHeight,
        );
        nextPos = Math.round(
          Math.min(Math.max(0, nextPos), Math.max(0, shelfLimit - fittedWidth)),
        );
        if (nextRatio === item.widthRatio && nextPos === item.posX) return prev;

        const oldPos = item.posX;
        if (widthSaveTimer.current != null) {
          window.clearTimeout(widthSaveTimer.current);
        }
        widthSaveTimer.current = window.setTimeout(() => {
          void persistShelfPatch(id, {
            widthRatio: nextRatio,
            posX: nextPos,
          }).catch((err: Error) => setError(err.message));
        }, 180);

        return prev.map((entry) => {
          if (entry.id === id) {
            return { ...entry, widthRatio: nextRatio, posX: nextPos };
          }
          if (sameStackColumn(entry, item) && entry.posX === oldPos) {
            return { ...entry, widthRatio: nextRatio, posX: nextPos };
          }
          return entry;
        });
      });
    },
    [persistShelfPatch, rack.id],
  );

  const setItemPos = useCallback(
    (id: number, posX: number, shelfHeight: number, shelfWidth: number) => {
      setItems((prev) => {
        const item = prev.find((entry) => entry.id === id);
        if (!item) return prev;
        const sameRow = prev.filter(
          (entry) =>
            entry.shelfIndex === item.shelfIndex &&
            (entry.depthRow ?? 1) === (item.depthRow ?? 1),
        );
        const movingIds = new Set(
          sameRow
            .filter((entry) => entry.posX === item.posX)
            .map((entry) => entry.id),
        );
        const rawWidth = Math.max(
          ...sameRow
            .filter((entry) => movingIds.has(entry.id))
            .map((entry) => entityPixelWidth(entry, shelfHeight)),
          24,
        );
        const others = groupShelfFootprints(sameRow, shelfHeight)
          .filter((print) => !print.ids.some((printId) => movingIds.has(printId)))
          .map((print) => ({
            posX: print.posX,
            width: print.width,
          }));
        // Жёсткие границы + сетка: недоступно → остаёмся на месте
        const bounded = snapToShelfCell(
          clampToShelfBounds(posX, rawWidth, shelfWidth),
          shelfHeight,
        );
        const next = isFreeColumnPos(
          bounded,
          rawWidth,
          shelfWidth,
          others,
          shelfHeight,
        )
          ? bounded
          : item.posX;
        if (next === item.posX) return prev;

        if (posSaveTimer.current != null) {
          window.clearTimeout(posSaveTimer.current);
        }
        // Не перечитываем весь список во время драга — иначе позиция откатывается
        posSaveTimer.current = window.setTimeout(() => {
          void persistShelfPatch(id, {
            posX: next,
            moveStackGroup: movingIds.size > 1,
          }).catch((err: Error) => setError(err.message));
        }, 180);

        return prev.map((entry) =>
          movingIds.has(entry.id) ? { ...entry, posX: next } : entry,
        );
      });
    },
    [persistShelfPatch],
  );

  const [dropHover, setDropHover] = useState<ShelfDropTarget | null>(null);

  const stackGroupIds = useCallback((all: ShelfItem[], item: ShelfItem) => {
    return new Set(stackColumnItems(all, item).map((entry) => entry.id));
  }, []);

  const resolveDropTarget = useCallback(
    (clientX: number, clientY: number, itemId: number): ShelfDropTarget | null => {
      const item = items.find((entry) => entry.id === itemId);
      if (!item) return null;

      const elements = document.elementsFromPoint(clientX, clientY);
      for (const el of elements) {
        if (!(el instanceof HTMLElement)) continue;
        const zone = el.closest("[data-shelf-drop]") as HTMLElement | null;
        if (!zone) continue;

        const scroller = zone.querySelector(".shelf-items");
        if (!(scroller instanceof HTMLElement)) continue;

        const shelfIndex = Number(zone.dataset.shelfIndex);
        const depthRow = Math.min(
          MAX_SHELF_ROWS,
          Math.max(1, Number(zone.dataset.depthRow) || 1),
        );
        if (!Number.isFinite(shelfIndex) || shelfIndex < 1) continue;

        const shelfHeight = scroller.clientHeight || 120;
        const shelfWidth = scroller.clientWidth || 600;
        const width = entityPixelWidth(item, shelfHeight);
        const rect = scroller.getBoundingClientRect();
        const scale = Math.max(viewScaleRef.current, 0.01);
        const rawPos = (clientX - rect.left) / scale - width / 2;
        const movingStackIds = stackGroupIds(items, item);
        const targetRowItems = items.filter(
          (entry) =>
            entry.shelfIndex === shelfIndex &&
            (entry.depthRow ?? 1) === depthRow &&
            !movingStackIds.has(entry.id),
        );
        const others = groupShelfFootprints(targetRowItems, shelfHeight).map((print) => ({
          posX: print.posX,
          width: print.width,
        }));
        const posX = resolvePosNoOverlap(
          rawPos,
          width,
          others,
          shelfWidth,
          shelfHeight,
        );
        return {
          shelfIndex,
          depthRow,
          posX: posX == null ? null : Math.round(posX),
        };
      }
      return null;
    },
    [items, stackGroupIds],
  );

  const moveItemToShelf = useCallback(
    async (
      id: number,
      shelfIndex: number,
      depthRow: number,
      preferredPosX?: number,
    ) => {
      const { height: shelfHeight, width: shelfWidth } = estimateShelfSize();
      const prevItems = items;
      const current = prevItems.find((entry) => entry.id === id);
      if (!current) return;

      const movingStackIds = stackGroupIds(prevItems, current);
      const width = entityPixelWidth(current, shelfHeight);
      const targetRowItems = prevItems.filter(
        (entry) =>
          entry.shelfIndex === shelfIndex &&
          (entry.depthRow ?? 1) === depthRow &&
          !movingStackIds.has(entry.id),
      );
      const others = groupShelfFootprints(targetRowItems, shelfHeight).map((print) => ({
        posX: print.posX,
        width: print.width,
      }));
      const nextPosRaw = resolvePosNoOverlap(
        preferredPosX ?? current.posX ?? 0,
        width,
        others,
        shelfWidth,
        shelfHeight,
      );
      if (nextPosRaw == null) {
        setError("Нет места на этой полке");
        return;
      }
      const nextPos = Math.round(nextPosRaw);

      setItems((prev) =>
        prev.map((entry) => {
          if (movingStackIds.has(entry.id)) {
            return { ...entry, shelfIndex, depthRow, posX: nextPos };
          }
          return entry;
        }),
      );

      try {
        if (requireConfirmRef.current) {
          markShelfDirty();
          return;
        }
        await updateShelfItem(id, { shelfIndex, depthRow, posX: nextPos });
        const fresh = await listShelfItems(rack.id);
        setItems(fresh);
      } catch (err) {
        setItems(prevItems);
        setError(err instanceof Error ? err.message : "Не удалось переместить");
      }
    },
    [items, markShelfDirty, rack.id, stackGroupIds],
  );

  const stackOntoItem = useCallback(
    async (id: number, targetId: number) => {
      if (id === targetId) return;
      const prevItems = items;
      const current = prevItems.find((entry) => entry.id === id);
      const target = prevItems.find((entry) => entry.id === targetId);
      if (!current || !target) return;
      if (sameStackColumn(current, target)) return;

      const moving = stackColumnItems(prevItems, current);
      const targetColumn = stackColumnItems(prevItems, target);
      if (moving.length + targetColumn.length > MAX_STACK) {
        setError(`В стеке не больше ${MAX_STACK} сущностей`);
        return;
      }

      const maxOrder = Math.max(...targetColumn.map((entry) => entry.stackOrder), -1);
      let order = maxOrder + 1;
      const nextById = new Map<number, number>();
      for (const entry of moving) {
        nextById.set(entry.id, order);
        order += 1;
      }

      setItems((prev) =>
        prev.map((entry) => {
          const nextOrder = nextById.get(entry.id);
          if (nextOrder == null) return entry;
          return {
            ...entry,
            shelfIndex: target.shelfIndex,
            depthRow: target.depthRow,
            posX: target.posX,
            stackOrder: nextOrder,
          };
        }),
      );

      try {
        if (requireConfirmRef.current) {
          markShelfDirty();
          return;
        }
        await updateShelfItem(id, { stackOntoId: targetId });
        const fresh = await listShelfItems(rack.id);
        setItems(fresh);
      } catch (err) {
        setItems(prevItems);
        setError(err instanceof Error ? err.message : "Не удалось сложить в стек");
      }
    },
    [items, markShelfDirty, rack.id],
  );

  const unstackItem = useCallback(
    async (id: number) => {
      const prevItems = items;
      const current = prevItems.find((entry) => entry.id === id);
      if (!current) return;

      const column = stackColumnItems(prevItems, current);
      if (column.length <= 1) return;

      const shelfEl = viewportRef.current?.querySelector(
        `[data-shelf-drop][data-shelf-index="${current.shelfIndex}"][data-depth-row="${current.depthRow ?? 1}"] .shelf-items`,
      );
      const shelfHeight =
        shelfEl instanceof HTMLElement
          ? shelfEl.clientHeight
          : estimateShelfSize().height;
      const shelfWidth =
        shelfEl instanceof HTMLElement
          ? shelfEl.clientWidth
          : estimateShelfSize().width;

      const width = entityPixelWidth(current, shelfHeight);
      const sameRowOthers = prevItems.filter(
        (entry) =>
          entry.id !== id &&
          entry.shelfIndex === current.shelfIndex &&
          (entry.depthRow ?? 1) === (current.depthRow ?? 1),
      );
      const others = groupShelfFootprints(sameRowOthers, shelfHeight).map(
        (print) => ({
          posX: print.posX,
          width: print.width,
        }),
      );
      const stackPrint = others.find((print) => print.posX === (current.posX ?? 0));
      const stackWidth =
        stackPrint?.width ??
        Math.max(
          ...column
            .filter((entry) => entry.id !== id)
            .map((entry) => entityPixelWidth(entry, shelfHeight)),
          width,
        );
      const preferred = (current.posX ?? 0) + stackWidth + ENTITY_GAP;
      const nextPos = findSeparatePosX(
        preferred,
        width,
        others,
        shelfWidth,
        shelfHeight,
      );
      if (nextPos == null) {
        setError("Нет места на полке — отделить нельзя");
        return;
      }

      setItems((prev) =>
        prev.map((entry) =>
          entry.id === id
            ? { ...entry, posX: nextPos, stackOrder: 0 }
            : entry,
        ),
      );
      setSelectedItemId(id);
      setDetailItemId(null);

      try {
        if (requireConfirmRef.current) {
          markShelfDirty();
          return;
        }
        await updateShelfItem(id, {
          posX: nextPos,
          stackOrder: 0,
          moveStackGroup: false,
        });
        const fresh = await listShelfItems(rack.id);
        setItems(fresh);
        setSelectedItemId(id);
      } catch (err) {
        setItems(prevItems);
        setError(
          err instanceof Error ? err.message : "Не удалось отделить со стека",
        );
      }
    },
    [items, markShelfDirty, rack.id],
  );

  const clampViewScale = (v: number) =>
    Math.min(VIEW_SCALE_MAX, Math.max(0.08, v));

  const zoomAt = (nextScale: number, anchor?: { x: number; y: number }) => {
    const el = viewportRef.current;
    const point = anchor ?? {
      x: (el?.clientWidth ?? 0) / 2,
      y: (el?.clientHeight ?? 0) / 2,
    };
    const oldScale = viewScaleRef.current;
    const oldPos = viewPosRef.current;
    const clamped = clampViewScale(nextScale);
    const world = {
      x: (point.x - oldPos.x) / oldScale,
      y: (point.y - oldPos.y) / oldScale,
    };
    const nextPos = {
      x: point.x - world.x * clamped,
      y: point.y - world.y * clamped,
    };
    viewScaleRef.current = clamped;
    viewPosRef.current = nextPos;
    setViewScale(clamped);
    setViewPos(nextPos);
  };

  const fitRackToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rackEl = viewport.querySelector(".rack-assembly");
    if (!(rackEl instanceof HTMLElement)) return;

    const viewW = viewport.clientWidth;
    const viewH = viewport.clientHeight;
    // offsetWidth/Height are layout sizes (unaffected by CSS transform)
    const rackW = rackEl.offsetWidth;
    const rackH = rackEl.offsetHeight;
    if (viewW < 40 || viewH < 40 || rackW < 8 || rackH < 8) return;

    const pad = Math.min(28, Math.min(viewW, viewH) * 0.06);
    const scale = clampViewScale(
      Math.min((viewW - pad * 2) / rackW, (viewH - pad * 2) / rackH),
    );
    // absolute left/top 0 + transform-origin 0 0
    const nextPos = {
      x: (viewW - rackW * scale) / 2,
      y: (viewH - rackH * scale) / 2,
    };
    viewScaleRef.current = scale;
    viewPosRef.current = nextPos;
    setViewScale(scale);
    setViewPos(nextPos);
  }, []);

  const resetView = () => {
    fitRackToViewport();
  };

  const selectedItemHint = useMemo(() => {
    if (selectedItemId == null) return null;
    const item = items.find((entry) => entry.id === selectedItemId);
    return item ? itemDisplayName(item) : null;
  }, [items, selectedItemId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let raf = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(raf);
      // Double rAF: wait for layout after enter / resize
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => fitRackToViewport());
      });
    };

    scheduleFit();
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(viewport);
    const rackEl = viewport.querySelector(".rack-assembly");
    if (rackEl instanceof HTMLElement) ro.observe(rackEl);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fitRackToViewport, frameWidth, count, rack.id, items.length]);

  const canPanFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest(".rack-row-rail")) return false;
    if (target.closest(".shelf-row-switch")) return false;
    if (target.closest(".zoom-controls")) return false;
    if (target.closest(".rack-resize")) return false;
    if (target.closest(".entity-resize")) return false;
    if (target.closest(".shelf-popup")) return false;
    if (target.closest(".shelf-popup-backdrop")) return false;
    if (target.closest(".btn")) return false;
    // Выбранная коробка — драг; невыбранная отдаёт жест пану камеры.
    const wrap = target.closest(".shelf-entity-wrap:not(.inactive)");
    if (wrap?.classList.contains("selected")) return false;
    return Boolean(target.closest(".interior-stage"));
  };

  const beginViewPan = (clientX: number, clientY: number) => {
    panRef.current = {
      x: clientX,
      y: clientY,
      sx: viewPosRef.current.x,
      sy: viewPosRef.current.y,
    };
  };

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    document.body.classList.remove("long-pressing");
  };

  const startShelfLongPress = (
    shelf: number,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-entity-id]")) {
      // Коробка сама обрабатывает драг — не панорамируем стеллаж.
      return;
    }
    if (target.closest(".shelf-popup")) return;
    if (target.closest(".rack-resize")) return;
    if (e.button !== 0) return;

    clearDomSelection();
    clearLongPress();
    beginViewPan(e.clientX, e.clientY);
    document.body.classList.add("long-pressing");
    const x = e.clientX;
    const y = e.clientY;
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      document.body.classList.remove("long-pressing");
      clearDomSelection();
      panRef.current = null;
      setPopup({ shelf, x, y });
      setSelectedItemId(null);
    }, 480);
    longPressRef.current = { shelf, timer, x, y };
  };

  const onShelfPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPressRef.current;
    if (!lp) return;
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) {
      clearLongPress();
    }
  };

  const onViewportWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const direction = e.deltaY > 0 ? -1 : 1;
    const next =
      direction > 0
        ? viewScaleRef.current * 1.12
        : viewScaleRef.current / 1.12;
    zoomAt(next, anchor);
  };

  const onViewportPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      beginViewPan(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    if (canPanFromTarget(e.target)) {
      beginViewPan(e.clientX, e.clientY);
    }
  };

  const startFrameResize = (
    side: "e" | "w",
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    clearLongPress();
    panRef.current = null;
    frameResizeRef.current = {
      side,
      startX: e.clientX,
      startWidth: frameWidthRef.current,
    };
    document.body.classList.add("resizing-rack");
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = frameResizeRef.current;
      if (!state) return;
      const dx = (e.clientX - state.startX) / viewScaleRef.current;
      const signed = state.side === "e" ? dx : -dx;
      persistFrameWidth(state.startWidth + signed);
    };
    const onUp = () => {
      if (!frameResizeRef.current) return;
      frameResizeRef.current = null;
      document.body.classList.remove("resizing-rack");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [persistFrameWidth]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        clearLongPress();
        panRef.current = null;
        pinchGuardUntilRef.current = Date.now() + 60_000;
        window.dispatchEvent(new Event("stockmap-cancel-entity-drag"));
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { lastDist: Math.hypot(dx, dy) };
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if (canPanFromTarget(target)) {
          beginViewPan(t.clientX, t.clientY);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        pinchGuardUntilRef.current = Date.now() + 60_000;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const rect = el.getBoundingClientRect();
        const center = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        };
        if (pinchRef.current.lastDist > 0) {
          zoomAt(
            viewScaleRef.current * (dist / pinchRef.current.lastDist),
            center,
          );
        }
        pinchRef.current = { lastDist: dist };
        return;
      }
      if (panRef.current && e.touches.length === 1) {
        if (document.body.classList.contains("moving-entity")) return;
        if (document.body.classList.contains("resizing-entity")) return;
        e.preventDefault();
        clearLongPress();
        const dx = e.touches[0].clientX - panRef.current.x;
        const dy = e.touches[0].clientY - panRef.current.y;
        const next = {
          x: panRef.current.sx + dx,
          y: panRef.current.sy + dy,
        };
        viewPosRef.current = next;
        setViewPos(next);
      }
    };

    const onTouchEnd = () => {
      if (!window.TouchEvent) return;
      if (pinchRef.current) {
        pinchGuardUntilRef.current = Date.now() + 300;
      }
      pinchRef.current = null;
      panRef.current = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panRef.current) return;
      if (frameResizeRef.current) return;
      if (document.body.classList.contains("moving-entity")) return;
      if (document.body.classList.contains("resizing-entity")) return;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      if (Math.hypot(dx, dy) > 8) clearLongPress();
      const next = {
        x: panRef.current.sx + dx,
        y: panRef.current.sy + dy,
      };
      viewPosRef.current = next;
      setViewPos(next);
    };

    const onPointerUp = () => {
      panRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const detailItem =
    detailItemId == null
      ? null
      : (items.find((item) => item.id === detailItemId) ?? null);

  return (
    <div
      className="interior"
      onPointerDownCapture={() => {
        if (focusItemId != null) onClearFocus?.();
      }}
    >
      <div className="interior-bar">
        <button
          type="button"
          className="btn ghost btn-back-map"
          onClick={() => void requestLeaveInterior()}
        >
          <span className="btn-back-map-arrow" aria-hidden>
            ←
          </span>
          <span className="btn-back-map-text">На карту</span>
        </button>
        <span className="interior-hint">
          Долгий тап по полке — добавить · двойной тап — править · перетащить на
          полку или на сущность (стек до 4)
        </span>

        <div className="interior-bar-actions interior-bar-actions--desktop">
          {canEditShelves && (
            <button
              type="button"
              className="btn ghost"
              disabled={selectedItemId == null}
              onClick={() => void copySelectedItem()}
              title="Скопировать выбранную коробку"
            >
              Копировать
            </button>
          )}
          {requireShelfConfirm && canEditShelves && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={!shelfDirty || confirming}
                onClick={() => void commitShelfDraft()}
              >
                {confirming ? "Сохранение…" : "Подтвердить"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={!shelfDirty || confirming}
                onClick={() => void discardShelfDraft()}
              >
                Отменить правки
              </button>
            </>
          )}
          {canEditShelves && (
            <button
              type="button"
              className="btn danger interior-delete"
              disabled={selectedItemId == null}
              onClick={() => {
                if (selectedItemId != null) void removeItem(selectedItemId);
              }}
            >
              Удалить
            </button>
          )}
        </div>

        {canEditShelves && (
          <div className="interior-tools interior-tools--mobile">
            <button
              type="button"
              className="btn ghost interior-tools-toggle"
              aria-expanded={toolsOpen}
              aria-label="Правки"
              title="Правки"
              onClick={(e) => {
                e.stopPropagation();
                setToolsOpen((v) => !v);
              }}
            >
              <svg
                className="interior-tools-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M22.7 19.3 13.6 10.2a6 6 0 0 0-7.1-7.1L9.7 6.3 6.3 9.7 3.1 6.5a6 6 0 0 0 7.1 7.1l9.1 9.1a1 1 0 0 0 1.4 0l2-2a1 1 0 0 0 0-1.4Z"
                />
              </svg>
            </button>
            {toolsOpen && (
              <div
                className="interior-tools-menu"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="btn ghost"
                  disabled={selectedItemId == null}
                  onClick={() => {
                    setToolsOpen(false);
                    void copySelectedItem();
                  }}
                >
                  Копировать
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="btn danger"
                  disabled={selectedItemId == null}
                  onClick={() => {
                    setToolsOpen(false);
                    if (selectedItemId != null) void removeItem(selectedItemId);
                  }}
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="banner" role="alert">
          <span>{friendlyError(error)}</span>
          <button type="button" className="btn ghost" onClick={() => setError(null)}>
            Закрыть
          </button>
        </div>
      )}

      <div
        ref={viewportRef}
        className="interior-stage"
        onWheel={onViewportWheel}
        onPointerDown={onViewportPointerDown}
        onClick={() => {
          setSelectedItemId(null);
          setPopup(null);
          setRowMenuShelf(null);
          setToolsOpen(false);
        }}
      >
        <div
          className="interior-world"
          style={{
            transform: `translate(${viewPos.x}px, ${viewPos.y}px) scale(${viewScale})`,
          }}
        >
          <div className="rack-assembly">
            <p className="rack-side-name" title={rack.label.trim() || "Стеллаж"}>
              {rack.label.trim() || "Стеллаж"}
            </p>
            <div
              className={`rack-column rack-theme-${normalizeRackTheme(rack.rackTheme)}`}
              style={{ width: frameWidth }}
            >
              <div className="rack-frame">
              <div className="rack-width-ruler" aria-hidden>
                <span className="rack-width-ruler-line" />
                <span className="rack-width-ruler-label">
                  {Math.round(frameWidth)} px ·{" "}
                  {(frameWidth / GRID).toFixed(1)} кл.
                </span>
                <span className="rack-width-ruler-line" />
              </div>
              {canEditMap && (
                <>
                  <span
                    className="rack-resize rack-resize-w"
                    onPointerDown={(e) => startFrameResize("w", e)}
                    title="Ширина стеллажа"
                  />
                  <span
                    className="rack-resize rack-resize-e"
                    onPointerDown={(e) => startFrameResize("e", e)}
                    title="Ширина стеллажа"
                  />
                </>
              )}
              {levels.map((n) => {
                const depthRow = rowOf(n);
                const rowsOnShelf = rowCountOf(n);
                const otherRow =
                  depthRow > 1 ? depthRow - 1 : rowsOnShelf > 1 ? 2 : null;
                const shelfItems = items.filter(
                  (item) =>
                    item.shelfIndex === n && (item.depthRow ?? 1) === depthRow,
                );
                const backgroundItems =
                  otherRow == null
                    ? []
                    : items.filter(
                        (item) =>
                          item.shelfIndex === n &&
                          (item.depthRow ?? 1) === otherRow,
                      );
                return (
                  <div
                    key={n}
                    className={`shelf-level${rowMenuShelf === n ? " row-open" : ""}${
                      dropHover?.shelfIndex === n && dropHover.depthRow === depthRow
                        ? dropHover.posX == null
                          ? " shelf-drop-full"
                          : " shelf-drop-hover"
                        : ""
                    }`}
                    style={{ animationDelay: `${(n - 1) * 45}ms` }}
                    onPointerDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        !target.closest("[data-entity-id]") &&
                        !target.closest(".rack-resize")
                      ) {
                        setRowMenuShelf(n);
                      }
                      startShelfLongPress(n, e);
                    }}
                    onPointerMove={onShelfPointerMove}
                    onPointerUp={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <div
                      className="shelf-main"
                      data-shelf-drop
                      data-shelf-index={n}
                      data-depth-row={depthRow}
                    >
                      <ShelfItemsScroller
                        items={shelfItems}
                        backgroundItems={backgroundItems}
                        shelfIndex={n}
                        depthRow={depthRow}
                        selectedItemId={selectedItemId}
                        highlightItemId={focusItemId}
                        getScale={() => viewScaleRef.current}
                        viewScale={viewScale}
                        resolveDropTarget={resolveDropTarget}
                        onDragHover={setDropHover}
                        onSelect={(id) => {
                          setPopup(null);
                          setSelectedItemId(id);
                          onClearFocus?.();
                        }}
                        onOpenDetail={(id) => {
                          if (Date.now() < suppressDetailUntilRef.current) return;
                          setPopup(null);
                          setSelectedItemId(id);
                          setDetailItemId(id);
                          onClearFocus?.();
                        }}
                        onWidthChange={(
                          id,
                          ratio,
                          shelfHeight,
                          side,
                          shelfWidth,
                        ) =>
                          setItemWidth(
                            id,
                            ratio,
                            shelfHeight,
                            side,
                            shelfWidth,
                          )
                        }
                        onPosChange={(id, posX, shelfHeight, shelfWidth) =>
                          setItemPos(id, posX, shelfHeight, shelfWidth)
                        }
                        onMoveToShelf={(id, targetShelf, targetDepth, posX) =>
                          void moveItemToShelf(id, targetShelf, targetDepth, posX)
                        }
                        onStackOnto={(id, targetId) =>
                          void stackOntoItem(id, targetId)
                        }
                        onUnstack={(id) => void unstackItem(id)}
                        onBlocked={(message) => setError(message)}
                        onEntityDragStart={() => {
                          panRef.current = null;
                        }}
                        isDragCommitBlocked={() =>
                          Date.now() < pinchGuardUntilRef.current
                        }
                        showShelfGrid={canEditMap}
                        onPack={(packed) => {
                          setItems((prev) => {
                            const others = prev.filter(
                              (item) =>
                                !(
                                  item.shelfIndex === n &&
                                  item.depthRow === depthRow
                                ),
                            );
                            return [...others, ...packed];
                          });
                          if (requireConfirmRef.current) {
                            markShelfDirty();
                            return;
                          }
                          for (const item of packed) {
                            const original = shelfItems.find(
                              (entry) => entry.id === item.id,
                            );
                            if (original && original.posX !== item.posX) {
                              void persistShelfPatch(item.id, {
                                posX: item.posX,
                              });
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="shelf-plank" aria-hidden />
                  </div>
                );
              })}
              </div>
              {/* Только верхняя доска — без задней и боковых стенок */}
              {(() => {
                const n = topDeckIndex;
                const depthRow = rowOf(n);
                const rowsOnShelf = rowCountOf(n);
                const otherRow =
                  depthRow > 1 ? depthRow - 1 : rowsOnShelf > 1 ? 2 : null;
                const shelfItems = items.filter(
                  (item) =>
                    item.shelfIndex === n && (item.depthRow ?? 1) === depthRow,
                );
                const backgroundItems =
                  otherRow == null
                    ? []
                    : items.filter(
                        (item) =>
                          item.shelfIndex === n &&
                          (item.depthRow ?? 1) === otherRow,
                      );
                return (
                  <div
                    key="rack-top"
                    className={`rack-top-surface${rowMenuShelf === n ? " row-open" : ""}${
                      dropHover?.shelfIndex === n && dropHover.depthRow === depthRow
                        ? dropHover.posX == null
                          ? " shelf-drop-full"
                          : " shelf-drop-hover"
                        : ""
                    }`}
                    onPointerDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        !target.closest("[data-entity-id]") &&
                        !target.closest(".rack-resize")
                      ) {
                        setRowMenuShelf(n);
                      }
                      startShelfLongPress(n, e);
                    }}
                    onPointerMove={onShelfPointerMove}
                    onPointerUp={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <div
                      className="shelf-main"
                      data-shelf-drop
                      data-shelf-index={n}
                      data-depth-row={depthRow}
                    >
                      <ShelfItemsScroller
                        items={shelfItems}
                        backgroundItems={backgroundItems}
                        shelfIndex={n}
                        depthRow={depthRow}
                        selectedItemId={selectedItemId}
                        highlightItemId={focusItemId}
                        getScale={() => viewScaleRef.current}
                        viewScale={viewScale}
                        resolveDropTarget={resolveDropTarget}
                        onDragHover={setDropHover}
                        onSelect={(id) => {
                          setPopup(null);
                          setSelectedItemId(id);
                          onClearFocus?.();
                        }}
                        onOpenDetail={(id) => {
                          if (Date.now() < suppressDetailUntilRef.current) return;
                          setPopup(null);
                          setSelectedItemId(id);
                          setDetailItemId(id);
                          onClearFocus?.();
                        }}
                        onWidthChange={(
                          id,
                          ratio,
                          shelfHeight,
                          side,
                          shelfWidth,
                        ) =>
                          setItemWidth(
                            id,
                            ratio,
                            shelfHeight,
                            side,
                            shelfWidth,
                          )
                        }
                        onPosChange={(id, posX, shelfHeight, shelfWidth) =>
                          setItemPos(id, posX, shelfHeight, shelfWidth)
                        }
                        onMoveToShelf={(id, targetShelf, targetDepth, posX) =>
                          void moveItemToShelf(id, targetShelf, targetDepth, posX)
                        }
                        onStackOnto={(id, targetId) =>
                          void stackOntoItem(id, targetId)
                        }
                        onUnstack={(id) => void unstackItem(id)}
                        onBlocked={(message) => setError(message)}
                        onEntityDragStart={() => {
                          panRef.current = null;
                        }}
                        isDragCommitBlocked={() =>
                          Date.now() < pinchGuardUntilRef.current
                        }
                        showShelfGrid={canEditMap}
                        onPack={(packed) => {
                          setItems((prev) => {
                            const others = prev.filter(
                              (item) =>
                                !(
                                  item.shelfIndex === n &&
                                  item.depthRow === depthRow
                                ),
                            );
                            return [...others, ...packed];
                          });
                          if (requireConfirmRef.current) {
                            markShelfDirty();
                            return;
                          }
                          for (const item of packed) {
                            const original = shelfItems.find(
                              (entry) => entry.id === item.id,
                            );
                            if (original && original.posX !== item.posX) {
                              void persistShelfPatch(item.id, {
                                posX: item.posX,
                              });
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="shelf-plank" aria-hidden />
                  </div>
                );
              })()}
            </div>

            <div
              className="rack-row-rail"
              aria-label="Ряды полок"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {[...levels, topDeckIndex].map((n) => {
                const active = rowOf(n);
                const maxRows = rowCountOf(n);
                return (
                  <div
                    key={n}
                    className={`shelf-row-switch${n === topDeckIndex ? " shelf-row-top" : ""}`}
                    aria-label={`Ряд полки ${n}`}
                  >
                    <div className="shelf-row-grid">
                      {Array.from({ length: maxRows }, (_, i) => i + 1).map(
                        (row) => (
                          <button
                            key={row}
                            type="button"
                            className={`shelf-row-btn${active === row ? " active" : ""}${
                              maxRows === 1 ? " alone" : ""
                            }`}
                            onClick={() => setShelfRow(n, row)}
                          >
                            Ряд {row}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="shelf-row-actions">
                      <button
                        type="button"
                        className="shelf-row-add"
                        disabled={maxRows >= MAX_SHELF_ROWS}
                        title={
                          maxRows >= MAX_SHELF_ROWS
                            ? "Достигнут максимум рядов"
                            : "Добавить ряд"
                        }
                        onClick={() => addShelfRow(n)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="shelf-row-remove"
                        disabled={maxRows <= 1}
                        title={
                          maxRows <= 1
                            ? "Нельзя удалить единственный ряд"
                            : `Удалить ряд ${maxRows}`
                        }
                        onClick={() => removeShelfRow(n)}
                      >
                        −
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {selectedItemHint && (
          <div className="rack-selection-hint" title={selectedItemHint}>
            {selectedItemHint}
          </div>
        )}

        <div className="zoom-controls rack-zoom-controls" aria-label="Масштаб стеллажа">
          <div className="rack-zoom-btns">
            <button
              type="button"
              className="btn zoom-btn"
              disabled={viewScale >= VIEW_SCALE_MAX - 0.001}
              onClick={(e) => {
                e.stopPropagation();
                zoomAt(viewScaleRef.current * 1.12);
              }}
              title={
                viewScale >= VIEW_SCALE_MAX - 0.001
                  ? "Максимальный масштаб"
                  : "Приблизить"
              }
            >
              +
            </button>
            <button
              type="button"
              className="btn zoom-btn zoom-label"
              onClick={(e) => {
                e.stopPropagation();
                resetView();
              }}
              title="Сбросить вид"
            >
              {Math.round(viewScale * 100)}%
            </button>
            <button
              type="button"
              className="btn zoom-btn"
              onClick={(e) => {
                e.stopPropagation();
                zoomAt(viewScaleRef.current / 1.12);
              }}
              title="Отдалить"
            >
              −
            </button>
            <button
              type="button"
              className="btn zoom-btn zoom-center-btn"
              onClick={(e) => {
                e.stopPropagation();
                fitRackToViewport();
              }}
              title="Центрировать стеллаж"
              aria-label="Центрировать стеллаж"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                aria-hidden
              >
                <circle
                  cx="12"
                  cy="12"
                  r="3.25"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {popup && (
        <div
          className="shelf-popup-backdrop"
          onClick={() => setPopup(null)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="shelf-popup"
            role="menu"
            style={{
              left: Math.min(popup.x, window.innerWidth - 200),
              top: Math.min(popup.y, window.innerHeight - 220),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="shelf-popup-title">
              {shelfTitle(popup.shelf)} · ряд {rowOf(popup.shelf)}
            </p>
            {(
              [
                ["box", "Коробка"],
                ["container", "Контейнер"],
                ["cell", "Ячейка"],
                ["stack", "Мини-ячейка"],
              ] as const
            ).map(([type, title]) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="shelf-popup-item"
                onClick={() => void addItem(popup.shelf, type)}
              >
                <EntityGlyph type={type} />
                <span>{title}</span>
              </button>
            ))}
            <button
              type="button"
              className="shelf-popup-cancel"
              onClick={() => setPopup(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {detailItem && (
        <ItemDetailPanel
          item={detailItem}
          stackCount={stackColumnItems(items, detailItem).length}
          canEdit={canEditShelves}
          highlight={focusItemId === detailItem.id}
          onClose={() => setDetailItemId(null)}
          onSave={(patch, contents) =>
            void saveItemInfo(detailItem.id, patch, contents)
          }
          onDelete={() => void removeItem(detailItem.id)}
          onAddOnTop={(type) =>
            void addItem(detailItem.shelfIndex, type, detailItem.id)
          }
          onUnstack={() => void unstackItem(detailItem.id)}
        />
      )}

      {requireShelfConfirm && canEditShelves && (
        <div className="interior-confirm-dock" role="toolbar" aria-label="Сохранение правок">
          <button
            type="button"
            className="btn ghost"
            disabled={!shelfDirty || confirming}
            onClick={() => void discardShelfDraft()}
          >
            Отменить
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!shelfDirty || confirming}
            onClick={() => void commitShelfDraft()}
          >
            {confirming ? "Сохранение…" : "Подтвердить"}
          </button>
        </div>
      )}
    </div>
  );
}


function ShelfItemsScroller({
  items,
  backgroundItems = [],
  shelfIndex,
  depthRow,
  selectedItemId,
  highlightItemId = null,
  getScale,
  viewScale = 1,
  resolveDropTarget,
  onDragHover,
  onSelect,
  onOpenDetail,
  onWidthChange,
  onPosChange,
  onMoveToShelf,
  onStackOnto,
  onUnstack,
  onBlocked,
  onPack,
  onEntityDragStart,
  showShelfGrid = false,
  isDragCommitBlocked,
}: {
  items: ShelfItem[];
  backgroundItems?: ShelfItem[];
  shelfIndex: number;
  depthRow: number;
  selectedItemId: number | null;
  highlightItemId?: number | null;
  getScale: () => number;
  viewScale?: number;
  resolveDropTarget: (
    clientX: number,
    clientY: number,
    itemId: number,
  ) => ShelfDropTarget | null;
  onDragHover: (target: ShelfDropTarget | null) => void;
  onSelect: (id: number) => void;
  onOpenDetail: (id: number) => void;
  onWidthChange: (
    id: number,
    widthRatio: number,
    shelfHeight: number,
    side: "e" | "w",
    shelfWidth: number,
  ) => void;
  onPosChange: (
    id: number,
    posX: number,
    shelfHeight: number,
    shelfWidth: number,
  ) => void;
  onMoveToShelf: (
    id: number,
    shelfIndex: number,
    depthRow: number,
    posX: number,
  ) => void;
  onStackOnto: (id: number, targetId: number) => void;
  onUnstack: (id: number) => void;
  onBlocked: (message: string) => void;
  onPack: (packed: ShelfItem[]) => void;
  onEntityDragStart?: () => void;
  showShelfGrid?: boolean;
  isDragCommitBlocked?: () => boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [gridMeta, setGridMeta] = useState({ stride: 0, height: 120 });
  const packedRef = useRef(false);

  const shelfHeight = () => scrollerRef.current?.clientHeight ?? 120;
  const shelfWidth = () => scrollerRef.current?.clientWidth ?? 600;

  const syncTrack = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setTrackWidth(Math.max(scroller.clientWidth, 1));
    const h = scroller.clientHeight || 120;
    setGridMeta({ stride: shelfCellStride(h), height: h });
  }, []);

  const itemIdsKey = items.map((item) => item.id).join(",");

  useEffect(() => {
    packedRef.current = false;
  }, [itemIdsKey]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || items.length === 0 || packedRef.current) return;
    const height = scroller.clientHeight;
    if (height < 8) return;

    const packed = packShelfItems(items, height, scroller.clientWidth);
    const byId = new Map(items.map((item) => [item.id, item.posX]));
    const needsPack = packed.some((item) => byId.get(item.id) !== item.posX);
    packedRef.current = true;
    if (needsPack) onPack(packed);
  }, [items, onPack]);

  useEffect(() => {
    syncTrack();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(() => syncTrack());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [syncTrack]);

  const renderLayer = (layerItems: ShelfItem[], inactive: boolean) => {
    const columns = (() => {
      const map = new Map<number, ShelfItem[]>();
      for (const item of layerItems) {
        const list = map.get(item.posX) ?? [];
        list.push(item);
        map.set(item.posX, list);
      }
      return [...map.entries()].map(([posX, group]) => ({
        posX,
        group: group.sort((a, b) => a.stackOrder - b.stackOrder || a.id - b.id),
      }));
    })();

    return (
      <>
        {columns.map(({ posX, group }) => {
          const width = Math.max(
            ...group.map((item) => entityPixelWidth(item, shelfHeight())),
          );
          const stacked = group.length > 1;
          return (
            <div
              key={`${inactive ? "bg" : "fg"}-stack-${posX}-${group
                .map((g) => g.id)
                .join("-")}`}
              className={`${stacked ? "stack-column" : "shelf-single"}${
                inactive ? " inactive" : ""
              }`}
              style={{ left: posX, width }}
            >
              {group.map((item) => {
                return (
                <ShelfEntityCard
                  key={`${inactive ? "bg" : "fg"}-${item.id}`}
                  item={item}
                  shelfIndex={shelfIndex}
                  depthRow={depthRow}
                  selected={!inactive && item.id === selectedItemId}
                  highlighted={!inactive && item.id === highlightItemId}
                  stacked={stacked}
                  inactive={inactive}
                  getScale={getScale}
                  viewScale={viewScale}
                  getShelfHeight={shelfHeight}
                  resolveDropTarget={resolveDropTarget}
                  onDragHover={onDragHover}
                  onSelect={() => {
                    if (!inactive) onSelect(item.id);
                  }}
                  onOpenDetail={() => {
                    if (!inactive) onOpenDetail(item.id);
                  }}
                  onWidthChange={(ratio, side) => {
                    if (!inactive)
                      onWidthChange(
                        item.id,
                        ratio,
                        shelfHeight(),
                        side,
                        shelfWidth(),
                      );
                  }}
                  onPosChange={(nextPos) => {
                    if (inactive) return;
                    onPosChange(item.id, nextPos, shelfHeight(), shelfWidth());
                    requestAnimationFrame(syncTrack);
                  }}
                  onMoveToShelf={(targetShelf, targetDepth, nextPos) => {
                    if (inactive) return;
                    onMoveToShelf(item.id, targetShelf, targetDepth, nextPos);
                  }}
                  onStackOnto={(targetId) => {
                    if (inactive) return;
                    onStackOnto(item.id, targetId);
                  }}
                  onBlocked={(message) => {
                    if (!inactive) onBlocked(message);
                  }}
                  onEntityDragStart={onEntityDragStart}
                  canUnstack={stacked && !inactive}
                  onUnstack={() => onUnstack(item.id)}
                  isDragCommitBlocked={isDragCommitBlocked}
                />
                );
              })}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="shelf-items" ref={scrollerRef} onClick={(e) => e.stopPropagation()}>
      <div className="shelf-items-track" style={{ width: trackWidth || "100%" }}>
        {showShelfGrid && gridMeta.stride > 0 && (
          <div className="shelf-debug-grid" aria-hidden>
            {Array.from(
              {
                length: Math.max(
                  1,
                  Math.ceil((trackWidth || 600) / gridMeta.stride) + 1,
                ),
              },
              (_, i) => (
                <span
                  key={i}
                  className="shelf-debug-grid-line"
                  style={{ left: i * gridMeta.stride }}
                />
              ),
            )}
          </div>
        )}
        {backgroundItems.length > 0 && (
          <div className="shelf-depth-layer" aria-hidden>
            {renderLayer(backgroundItems, true)}
          </div>
        )}
        <div className="shelf-front-layer">{renderLayer(items, false)}</div>
      </div>
    </div>
  );
}
function ShelfEntityCard({
  item,
  shelfIndex,
  depthRow,
  selected,
  highlighted = false,
  stacked = false,
  inactive = false,
  getScale,
  viewScale = 1,
  getShelfHeight,
  resolveDropTarget,
  onDragHover,
  onSelect,
  onOpenDetail,
  onWidthChange,
  onPosChange,
  onMoveToShelf,
  onStackOnto,
  onUnstack,
  onBlocked,
  onEntityDragStart,
  canUnstack = false,
  isDragCommitBlocked,
}: {
  item: ShelfItem;
  shelfIndex: number;
  depthRow: number;
  selected: boolean;
  highlighted?: boolean;
  stacked?: boolean;
  inactive?: boolean;
  getScale: () => number;
  viewScale?: number;
  getShelfHeight: () => number;
  resolveDropTarget: (
    clientX: number,
    clientY: number,
    itemId: number,
  ) => ShelfDropTarget | null;
  onDragHover: (target: ShelfDropTarget | null) => void;
  onSelect: () => void;
  onOpenDetail: () => void;
  onWidthChange: (widthRatio: number, side: "e" | "w") => void;
  onPosChange: (posX: number) => void;
  onMoveToShelf: (shelfIndex: number, depthRow: number, posX: number) => void;
  onStackOnto: (targetId: number) => void;
  onUnstack?: () => void;
  onBlocked?: (message: string) => void;
  onEntityDragStart?: () => void;
  canUnstack?: boolean;
  isDragCommitBlocked?: () => boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLButtonElement>(null);
  const selectedSinceRef = useRef<number | null>(null);
  const unstackTimerRef = useRef<number | null>(null);
  const [showUnstack, setShowUnstack] = useState(false);
  const resizeRef = useRef<{
    side: "e" | "w";
    startX: number;
    startRatio: number;
    baseHeight: number;
  } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPos: number;
    startShelf: number;
    startDepth: number;
    livePos: number;
    moved: boolean;
    column: HTMLElement | null;
    shelfEl: HTMLElement | null;
    shelfW: number;
    shelfH: number;
    colW: number;
    others: { posX: number; width: number }[];
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selected || !canUnstack) {
      selectedSinceRef.current = null;
      setShowUnstack(false);
      if (unstackTimerRef.current != null) {
        window.clearTimeout(unstackTimerRef.current);
        unstackTimerRef.current = null;
      }
    }
  }, [selected, canUnstack, item.id]);

  useEffect(() => {
    return () => {
      if (unstackTimerRef.current != null) {
        window.clearTimeout(unstackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!highlighted || !wrapRef.current) return;
    if (document.body.classList.contains("moving-entity")) return;
    wrapRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [highlighted, item.id]);

  const armUnstackButton = () => {
    if (!canUnstack) return;
    setShowUnstack(false);
    selectedSinceRef.current = Date.now();
    if (unstackTimerRef.current != null) {
      window.clearTimeout(unstackTimerRef.current);
    }
    unstackTimerRef.current = window.setTimeout(() => {
      unstackTimerRef.current = null;
      setShowUnstack(true);
    }, UNSTACK_ARM_MS);
  };
  const armUnstackRef = useRef(armUnstackButton);
  armUnstackRef.current = armUnstackButton;

  // Стабильные колбэки — иначе useEffect срывает listeners на каждом кадре драга
  const getScaleRef = useRef(getScale);
  const resolveDropTargetRef = useRef(resolveDropTarget);
  const onDragHoverRef = useRef(onDragHover);
  const onSelectRef = useRef(onSelect);
  const onOpenDetailRef = useRef(onOpenDetail);
  const onWidthChangeRef = useRef(onWidthChange);
  const onPosChangeRef = useRef(onPosChange);
  const onMoveToShelfRef = useRef(onMoveToShelf);
  const onStackOntoRef = useRef(onStackOnto);
  const onBlockedRef = useRef(onBlocked);
  const onEntityDragStartRef = useRef(onEntityDragStart);
  const isDragCommitBlockedRef = useRef(isDragCommitBlocked);
  getScaleRef.current = getScale;
  resolveDropTargetRef.current = resolveDropTarget;
  onDragHoverRef.current = onDragHover;
  onSelectRef.current = onSelect;
  onOpenDetailRef.current = onOpenDetail;
  onWidthChangeRef.current = onWidthChange;
  onPosChangeRef.current = onPosChange;
  onMoveToShelfRef.current = onMoveToShelf;
  onStackOntoRef.current = onStackOnto;
  onBlockedRef.current = onBlocked;
  onEntityDragStartRef.current = onEntityDragStart;
  isDragCommitBlockedRef.current = isDragCommitBlocked;

  const columnEl = () =>
    wrapRef.current?.closest(".stack-column, .shelf-single") as HTMLElement | null;

  const measureDragContext = (column: HTMLElement | null) => {
    const shelf =
      (column?.closest(".shelf-items") as HTMLElement | null) ??
      (wrapRef.current?.closest(".shelf-items") as HTMLElement | null);
    const shelfW = shelf?.clientWidth || 600;
    const colW = Math.max(
      column?.offsetWidth ?? 0,
      entityPixelWidth(item, getShelfHeight()),
      24,
    );
    const layer = column?.closest(".shelf-front-layer");
    const others: { posX: number; width: number }[] = [];
    if (layer instanceof HTMLElement && column) {
      layer
        .querySelectorAll<HTMLElement>(".stack-column, .shelf-single")
        .forEach((el) => {
          if (el === column) return;
          others.push({
            posX: el.offsetLeft,
            width: Math.max(el.offsetWidth, 24),
          });
        });
    }
    return { shelfEl: shelf, shelfW, colW, others };
  };

  const clearLiveDragStyle = (
    column: HTMLElement | null,
    restorePos?: number,
  ) => {
    if (!column) return;
    // Нельзя ставить left="" — React может не перерисовать при том же posX,
    // и absolute-колонка без left уезжает (потом «телепорт» при клике).
    if (restorePos != null && Number.isFinite(restorePos)) {
      column.style.left = `${restorePos}px`;
    }
  };

  const tryDoubleTap = (clientX: number, clientY: number) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (
      last &&
      now - last.time < 400 &&
      Math.hypot(clientX - last.x, clientY - last.y) < 28
    ) {
      lastTapRef.current = null;
      onOpenDetailRef.current();
      return true;
    }
    lastTapRef.current = { time: now, x: clientX, y: clientY };
    return false;
  };

  useEffect(() => {
    const onCancel = () => {
      const state = dragRef.current;
      if (!state) return;
      clearLiveDragStyle(state.column, state.startPos);
      dragRef.current = null;
      onDragHoverRef.current(null);
      document.body.classList.remove("moving-entity");
    };
    window.addEventListener("stockmap-cancel-entity-drag", onCancel);
    return () => {
      window.removeEventListener("stockmap-cancel-entity-drag", onCancel);
    };
  }, [item.id]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const scale = Math.max(getScaleRef.current(), 0.01);

      if (resizeRef.current) {
        const state = resizeRef.current;
        const dx = (e.clientX - state.startX) / scale;
        const signed = state.side === "e" ? dx : -dx;
        onWidthChangeRef.current(
          state.startRatio + signed / state.baseHeight,
          state.side,
        );
        return;
      }

      if (dragRef.current) {
        const state = dragRef.current;
        const column = state.column ?? columnEl();
        state.column = column;

        const screenDx = e.clientX - state.startX;
        const screenDy = e.clientY - state.startY;
        // Порог в пикселях экрана: иначе при мелком scale клик = «драг»
        // и коробка уезжает от соседнего стека.
        if (Math.hypot(screenDx, screenDy) > 10) {
          if (!state.moved) onSelectRef.current();
          state.moved = true;
        }

        const dx = screenDx / scale;
        const shelfBox = state.shelfEl?.getBoundingClientRect();
        const pointerOverSourceShelf =
          !!shelfBox &&
          e.clientX >= shelfBox.left &&
          e.clientX <= shelfBox.right &&
          e.clientY >= shelfBox.top &&
          e.clientY <= shelfBox.bottom;

        // Двигаем по исходной полке только пока курсор над ней и это уже драг.
        if (state.moved && pointerOverSourceShelf) {
          const livePos = slideDragPos(
            state.startPos + dx,
            state.colW,
            state.shelfW,
            state.others,
            state.livePos,
            state.shelfH,
          );
          state.livePos = livePos;
          if (column) {
            column.style.left = `${livePos}px`;
          }
        }

        if (state.moved) {
          const target = resolveDropTargetRef.current(
            e.clientX,
            e.clientY,
            item.id,
          );
          onDragHoverRef.current(target);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const state = dragRef.current;
      const wasDrag = state?.moved ?? false;
      resizeRef.current = null;
      dragRef.current = null;
      onDragHoverRef.current(null);
      document.body.classList.remove("resizing-entity", "moving-entity");

      if (!state) {
        // Чужой жест (клик мимо этой коробки) — не считаем двойным тапом.
        return;
      }

      if (!wasDrag) {
        clearLiveDragStyle(state.column, state.startPos);
        if (e.pointerType === "touch") {
          const hit = document.elementFromPoint(e.clientX, e.clientY);
          if (
            hit instanceof Node &&
            wrapRef.current?.contains(hit) &&
            (hit as HTMLElement).closest?.(".shelf-entity")
          ) {
            tryDoubleTap(e.clientX, e.clientY);
          }
        }
        return;
      }

      if (isDragCommitBlockedRef.current?.()) {
        clearLiveDragStyle(state.column, state.startPos);
        return;
      }

      const under = document.elementsFromPoint(e.clientX, e.clientY);
      let stackedOnto: number | null = null;
      const myColumn = state.column;
      for (const el of under) {
        if (!(el instanceof HTMLElement)) continue;
        const wrap = el.closest("[data-entity-id]") as HTMLElement | null;
        if (!wrap) continue;
        const targetId = Number(wrap.dataset.entityId);
        if (!Number.isInteger(targetId) || targetId === item.id) continue;
        const theirColumn = wrap.closest(
          ".stack-column, .shelf-single",
        ) as HTMLElement | null;
        if (myColumn && theirColumn && myColumn === theirColumn) continue;
        stackedOnto = targetId;
        break;
      }

      if (stackedOnto != null) {
        clearLiveDragStyle(state.column, state.startPos);
        onStackOntoRef.current(stackedOnto);
      } else {
        const target = resolveDropTargetRef.current(
          e.clientX,
          e.clientY,
          item.id,
        );
        if (
          target &&
          (target.shelfIndex !== state.startShelf ||
            target.depthRow !== state.startDepth)
        ) {
          clearLiveDragStyle(state.column, state.startPos);
          if (target.posX == null) {
            onBlockedRef.current?.("Нет места на этой полке");
          } else {
            onMoveToShelfRef.current(
              target.shelfIndex,
              target.depthRow,
              target.posX,
            );
          }
        } else {
          const finalPos = isFreeColumnPos(
            state.livePos,
            state.colW,
            state.shelfW,
            state.others,
            state.shelfH,
          )
            ? state.livePos
            : state.startPos;
          clearLiveDragStyle(state.column, finalPos);
          if (finalPos !== state.startPos) {
            onPosChangeRef.current(finalPos);
          }
        }
      }

      (
        wrapRef.current as HTMLDivElement & { __skipClick?: boolean }
      ).__skipClick = true;
      armUnstackRef.current();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [item.id]);

  const startResize = (
    side: "e" | "w",
    e: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    if (inactive) return;
    e.preventDefault();
    e.stopPropagation();
    const cssHeight = bodyRef.current?.offsetHeight ?? getShelfHeight() * 0.99;
    resizeRef.current = {
      side,
      startX: e.clientX,
      startRatio: item.widthRatio,
      baseHeight: Math.max(cssHeight, 1),
    };
    document.body.classList.add("resizing-entity");
    onSelectRef.current();
  };

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (inactive || e.button !== 0) return;
    // Вариант D: двигаем только выбранную коробку; иначе жест уходит в пан.
    if (!selected) return;
    e.stopPropagation();
    // Не выбираем на pointerdown — иначе «Отделить» появляется под пальцем
    // и тот же клик отделяет коробку.
    onEntityDragStartRef.current?.();
    const column = columnEl();
    const shelfH = getShelfHeight();
    const startPos = snapToShelfCell(item.posX ?? 0, shelfH);
    const ctx = measureDragContext(column);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos,
      startShelf: shelfIndex,
      startDepth: depthRow,
      livePos: startPos,
      moved: false,
      column,
      shelfEl: ctx.shelfEl,
      shelfW: ctx.shelfW,
      shelfH,
      colW: ctx.colW,
      others: ctx.others,
    };
    document.body.classList.add("moving-entity");
  };

  return (
    <div
      ref={wrapRef}
      data-entity-id={inactive ? undefined : item.id}
      className={`shelf-entity-wrap${selected ? " selected" : ""}${
        highlighted ? " search-highlight" : ""
      }${stacked ? " stacked" : ""}${inactive ? " inactive" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={bodyRef}
        type="button"
        tabIndex={inactive ? -1 : 0}
        className={`shelf-entity shelf-entity-${item.type}${
          selected ? " selected" : ""
        }${highlighted ? " search-highlight" : ""}`}
        title={itemDisplayName(item)}
        style={
          stacked
            ? undefined
            : { aspectRatio: `${item.widthRatio} / 1` }
        }
        onPointerDown={startDrag}
        onDoubleClick={(e) => {
          if (inactive) return;
          // Только по самой коробке, не по соседним зонам / ручкам.
          if (!(e.target instanceof Element)) return;
          if (!e.target.closest(".shelf-entity")) return;
          if (e.target.closest(".entity-resize, .entity-unstack")) return;
          e.preventDefault();
          e.stopPropagation();
          lastTapRef.current = null;
          onOpenDetailRef.current();
        }}
        onClick={() => {
          if (inactive) return;
          const el = wrapRef.current as HTMLDivElement & {
            __skipClick?: boolean;
          };
          if (el?.__skipClick) {
            el.__skipClick = false;
            return;
          }
          onSelectRef.current();
          armUnstackButton();
        }}
      >
        <span className="shelf-entity-face" aria-hidden />
        {(item.title || (item.contents && item.contents.length > 0)) && (
          <ShelfEntityLabel text={itemFaceLabel(item)} viewScale={viewScale} />
        )}
      </button>
      {selected && !inactive && (
        <>
          <span
            className="entity-resize entity-resize-w"
            onPointerDown={(e) => startResize("w", e)}
          />
          <span
            className="entity-resize entity-resize-e"
            onPointerDown={(e) => startResize("e", e)}
          />
        </>
      )}
      {selected && !inactive && canUnstack && onUnstack && showUnstack && (
        <button
          type="button"
          className="entity-unstack"
          title="Отделить на полку"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const since = selectedSinceRef.current;
            if (since == null || Date.now() - since < UNSTACK_ARM_MS) return;
            onUnstack();
          }}
        >
          Отделить
        </button>
      )}
    </div>
  );
}

function ShelfEntityLabel({
  text,
  viewScale: _viewScale = 1,
}: {
  text: string;
  viewScale?: number;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(13);

  useEffect(() => {
    const el = ref.current;
    const host = hostRef.current;
    const parent = host?.parentElement;
    if (!el || !host || !parent) return;

    const fit = () => {
      const maxW = Math.max(24, Math.floor(parent.clientWidth * 0.9));
      const maxH = Math.max(18, Math.floor(parent.clientHeight * 0.86));
      const MIN = 7;
      const MAX = 16;
      const lines = text.split("\n").filter(Boolean).length;
      const pad =
        maxH < 32 ? "0.06rem 0.14rem" : maxH < 52 ? "0.1rem 0.18rem" : "0.14rem 0.22rem";

      host.style.width = `${maxW}px`;
      host.style.height = `${maxH}px`;
      host.style.maxWidth = "90%";
      host.style.maxHeight = "86%";

      el.style.width = "100%";
      el.style.height = "100%";
      el.style.maxWidth = "100%";
      el.style.maxHeight = "100%";
      el.style.transform = "none";
      el.style.lineHeight = lines >= 3 ? "1.05" : lines === 2 ? "1.1" : "1.15";
      el.style.whiteSpace = "pre-line";
      el.style.overflowWrap = "break-word";
      el.style.wordBreak = "normal";
      el.style.padding = pad;
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.webkitLineClamp = "unset";
      el.style.overflow = "hidden";

      const fits = () =>
        el.scrollWidth <= el.clientWidth + 1 &&
        el.scrollHeight <= el.clientHeight + 1;

      let lo = MIN;
      let hi = Math.min(MAX, Math.max(MIN, maxH * (lines >= 2 ? 0.28 : 0.4)));
      let best = MIN;

      while (lo <= hi) {
        const mid = Math.round(((lo + hi) / 2) * 10) / 10;
        el.style.fontSize = `${mid}px`;
        if (fits()) {
          best = mid;
          lo = mid + 0.25;
        } else {
          hi = mid - 0.25;
        }
      }

      el.style.fontSize = `${best}px`;

      // Если даже минимум не влезает — clamp по строкам, без обрезания середины букв.
      if (!fits()) {
        const cs = getComputedStyle(el);
        const padY =
          (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const linePx = best * (lines >= 3 ? 1.05 : 1.1);
        const maxLines = Math.max(1, Math.floor((maxH - padY) / Math.max(linePx, 1)));
        el.style.display = "-webkit-box";
        el.style.alignItems = "unset";
        el.style.justifyContent = "unset";
        el.style.webkitBoxOrient = "vertical";
        el.style.webkitLineClamp = String(maxLines);
        el.style.overflow = "hidden";
      }

      setFontSize(best);
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={hostRef} className="shelf-entity-label-host">
      <span
        ref={ref}
        className="shelf-entity-label"
        style={{ fontSize: `${fontSize}px` }}
        title={text}
      >
        {text}
      </span>
    </span>
  );
}

function formatInfoDate(value: string | null) {
  if (!value) return "ещё не изменялось";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ItemDetailPanel({
  item,
  stackCount = 0,
  canEdit = true,
  highlight = false,
  onClose,
  onSave,
  onDelete,
  onAddOnTop,
  onUnstack,
}: {
  item: ShelfItem;
  stackCount?: number;
  canEdit?: boolean;
  highlight?: boolean;
  onClose: () => void;
  onSave: (
    patch: Partial<Pick<ShelfItem, "title" | "details" | "quantity">>,
    contents: CatalogPick[],
  ) => void;
  onDelete: () => void;
  onAddOnTop?: (type: ShelfItemType) => void;
  onUnstack?: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [quantity, setQuantity] = useState(item.quantity);
  const [details, setDetails] = useState(item.details);
  const [contents, setContents] = useState<CatalogPick[]>(() =>
    (item.contents ?? []).map((c) => ({
      kind: c.kind,
      refId: c.refId,
      nameSnapshot: c.nameSnapshot,
      typeSnapshot: c.typeSnapshot ?? "",
      quantity: c.quantity ?? "",
    })),
  );
  const [contentsDirty, setContentsDirty] = useState(false);
  const [showStackTypes, setShowStackTypes] = useState(false);
  /** Поля только после явного тапа — иначе мобильная клавиатура всплывает сама. */
  const [fieldsEnabled, setFieldsEnabled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFieldsEnabled(false);
    const panel = panelRef.current;
    const blurFields = () => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        panel?.contains(active) &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        active.blur();
      }
      panel?.focus({ preventScroll: true });
    };

    blurFields();
    const raf = window.requestAnimationFrame(blurFields);
    const later = window.setTimeout(blurFields, 100);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(later);
    };
  }, [item.id]);

  const dirty =
    title !== item.title ||
    quantity !== item.quantity ||
    details !== item.details ||
    contentsDirty;

  useEffect(() => {
    setTitle(item.title);
    setQuantity(item.quantity);
    setDetails(item.details);
    setContents(
      (item.contents ?? []).map((c) => ({
        kind: c.kind,
        refId: c.refId,
        nameSnapshot: c.nameSnapshot,
        typeSnapshot: c.typeSnapshot ?? "",
        quantity: c.quantity ?? "",
      })),
    );
    setContentsDirty(false);
    setShowStackTypes(false);
    setFieldsEnabled(false);
  }, [item.id, item.title, item.quantity, item.details, item.contents]);

  const enableFields = () => {
    if (!canEdit) return;
    setFieldsEnabled(true);
  };

  const save = () => {
    onSave(
      {
        title: contents.length > 0 ? "" : title.trim(),
        quantity: quantity.trim(),
        details: details.trim(),
      },
      contents,
    );
    setContentsDirty(false);
  };

  const headingText = detailPanelHeading(contents, title);
  const headingMultiline = headingText.includes("\n");

  return (
    <div
      className="item-detail-backdrop"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={panelRef}
        className={`item-detail${highlight ? " item-detail-highlight" : ""}${
          !fieldsEnabled ? " item-detail-locked" : ""
        }`}
        role="dialog"
        aria-label={`Содержимое: ${entityTitle(item.type)}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="item-detail-head">
          <div className="item-detail-type">
            <EntityGlyph type={item.type} />
            <div>
              <p className="item-detail-kicker">{entityTitle(item.type)}</p>
              <h2
                className={`item-detail-heading${
                  headingMultiline ? " is-multiline" : ""
                }`}
              >
                {headingText}
              </h2>
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {!fieldsEnabled && canEdit && (
          <button
            type="button"
            className="btn item-detail-enable"
            onClick={enableFields}
          >
            Редактировать содержимое
          </button>
        )}

        {fieldsEnabled && canEdit && (
          <CatalogContentsPicker
            key={`picker-${item.id}`}
            initial={item.contents ?? []}
            canEdit
            onChange={(next) => {
              setContents(next);
              setContentsDirty(true);
              if (next.length > 0) setTitle("");
            }}
          />
        )}

        {!canEdit && contents.length > 0 && (
          <div className="catalog-picker catalog-picker-readonly">
            <div className="catalog-picker-head">
              <span>Из справочника</span>
              <span className="catalog-picker-count">
                Выбрано: {contents.length}
              </span>
            </div>
            <ul className="catalog-readonly-list">
              {contents.map((c) => (
                <li key={`${c.kind}:${c.refId}`}>{c.nameSnapshot}</li>
              ))}
            </ul>
          </div>
        )}

        {contents.length === 0 && (
          <label className="field item-detail-field">
            <span>Название</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Введите название вручную"
              disabled={!canEdit}
              readOnly={!fieldsEnabled}
              inputMode={fieldsEnabled ? "text" : "none"}
              tabIndex={fieldsEnabled ? undefined : -1}
              onPointerDown={() => enableFields()}
            />
          </label>
        )}

        <label className="field item-detail-field">
          <span>Количество (общее)</span>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Например: 24 шт"
            disabled={!canEdit}
            readOnly={!fieldsEnabled}
            inputMode={fieldsEnabled ? "text" : "none"}
            tabIndex={fieldsEnabled ? undefined : -1}
            onPointerDown={() => enableFields()}
          />
        </label>

        <label className="field item-detail-field">
          <span>Дополнительно</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Заметки, партия, место…"
            rows={3}
            disabled={!canEdit}
            readOnly={!fieldsEnabled}
            inputMode={fieldsEnabled ? "text" : "none"}
            tabIndex={fieldsEnabled ? undefined : -1}
            onPointerDown={() => enableFields()}
          />
        </label>

        <p className="item-detail-meta">
          Изменено: {formatInfoDate(item.infoUpdatedAt)}
        </p>

        <div className="item-detail-actions">
          {canEdit && (
            <button
              type="button"
              className="btn primary"
              disabled={!dirty}
              onClick={save}
            >
              Сохранить
            </button>
          )}
          {canEdit && onAddOnTop && stackCount < MAX_STACK && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => setShowStackTypes((v) => !v)}
              >
                Положить сверху ({stackCount}/4)
              </button>
              {showStackTypes && (
                <div className="item-stack-types">
                  {(
                    [
                      ["box", "Коробка"],
                      ["container", "Контейнер"],
                      ["cell", "Ячейка"],
                      ["stack", "Мини-ячейка"],
                    ] as const
                  ).map(([type, label]) => (
                    <button
                      key={type}
                      type="button"
                      className="btn"
                      onClick={() => {
                        onAddOnTop(type);
                        setShowStackTypes(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {canEdit && onUnstack && stackCount > 1 && (
            <button type="button" className="btn" onClick={onUnstack}>
              Отделить на полку
            </button>
          )}
          {stackCount >= MAX_STACK && (
            <span className="item-detail-meta">
              Стек полный ({MAX_STACK}/{MAX_STACK})
            </span>
          )}
          {canEdit && (
            <button type="button" className="btn danger" onClick={onDelete}>
              Удалить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EntityGlyph({ type }: { type: ShelfItemType }) {
  return (
    <span className={`entity-swatch entity-swatch-${type}`} aria-hidden>
      <span className="entity-swatch-face" />
    </span>
  );
}

function entityTitle(type: ShelfItemType) {
  switch (type) {
    case "box":
      return "Коробка";
    case "container":
      return "Контейнер";
    case "cell":
      return "Ячейка";
    case "stack":
      return "Мини-ячейка";
  }
}

/** Заголовок карточки ячейки/коробки: только имена позиций. */
function detailPanelHeading(
  contents: {
    nameSnapshot: string;
    typeSnapshot?: string;
  }[],
  title: string,
): string {
  if (contents.length === 0) return title.trim() || "Без названия";
  const lines = contents.map((c) => c.nameSnapshot.trim() || "—");
  if (contents.length === 1) return lines[0]!;
  const longest = Math.max(...lines.map((line) => line.length));
  // Длинные имена — в одну строку через « / », чтобы не раздувать шапку.
  if (contents.length > 4 || longest > 48) {
    return lines.join(" / ");
  }
  return lines.join("\n");
}

/** Подпись для подсказки и UI: только имя (без типа комплектующего). */
function itemDisplayName(item: ShelfItem): string {
  const contents = item.contents ?? [];
  if (contents.length >= 1) {
    return contents.map((c) => c.nameSnapshot.trim() || "—").join("\n");
  }
  const title = item.title?.trim();
  if (title) return title;
  return entityTitle(item.type);
}

function shortenFaceLine(value: string, maxLen = 72): string {
  const t = value.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(1, maxLen - 1))}…`;
}

/** Подпись на лице коробки: имена по строкам, длинные — укорачиваем. */
function itemFaceLabel(item: ShelfItem): string {
  const contents = item.contents ?? [];
  if (contents.length >= 1) {
    const maxLen = contents.length >= 3 ? 28 : contents.length === 2 ? 36 : 48;
    const line = (c: (typeof contents)[number]) =>
      shortenFaceLine((c.nameSnapshot || "—").trim(), maxLen);
    if (contents.length <= 3) {
      return contents.map(line).join("\n");
    }
    return `${line(contents[0]!)}\n${line(contents[1]!)}\n+ ещё ${contents.length - 2}`;
  }
  const title = item.title?.trim();
  if (title) return shortenFaceLine(title, 80);
  return entityTitle(item.type);
}

type AppMode = "build" | "use";

function detectDefaultMode(): AppMode {
  try {
    const saved = localStorage.getItem("stockmap-mode");
    if (saved === "build" || saved === "use") return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches) {
    return "use";
  }
  return "build";
}

export default function App() {
  const { confirm, prompt } = useDialog();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [focusItemId, setFocusItemId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<WarehouseSearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tool, setTool] = useState<ObjectType | null>(null);
  const [rackCopyMode, setRackCopyMode] = useState(false);
  const [rackCopyIds, setRackCopyIds] = useState<number[]>([]);
  const [nextRackLabel, setNextRackLabel] = useState("A-01");
  const [rackForm, setRackForm] = useState<{
    world: WorldPoint;
    label: string;
    shelvesCount: number;
    width: number;
    length: number;
    rackTheme: RackTheme;
  } | null>(null);
  const [rackEdit, setRackEdit] = useState<{
    id: number;
    label: string;
    shelvesCount: number;
    initialShelvesCount: number;
    width: number;
    length: number;
    rackTheme: RackTheme;
  } | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const [lineStart, setLineStart] = useState<WorldPoint | null>(null);
  const [cursorPos, setCursorPos] = useState<WorldPoint | null>(null);
  const [showGrid, setShowGrid] = useState(() => {
    try {
      return localStorage.getItem("stockmap-grid") !== "off";
    } catch {
      return true;
    }
  });
  const [spawnMenu, setSpawnMenu] = useState<{
    left: number;
    top: number;
    world: WorldPoint;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [appMode, setAppMode] = useState<AppMode>(() => detectDefaultMode());
  const draftRef = useRef<DraftRect | null>(null);
  const lineStartRef = useRef<WorldPoint | null>(null);
  const lastWorldRef = useRef<WorldPoint | null>(null);
  const wallPlaceLockRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const pendingPanRef = useRef<{
    x: number;
    y: number;
    sx: number;
    sy: number;
  } | null>(null);
  const pinchRef = useRef<{
    lastDist: number;
    lastCenter: { x: number; y: number };
  } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const panningRef = useRef(false);
  const scaleRef = useRef(1);
  const stagePosRef = useRef({ x: 0, y: 0 });
  const stageCommitRafRef = useRef<number | null>(null);
  const initialFitDoneRef = useRef(false);
  const lastFitKeyRef = useRef("");

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    stagePosRef.current = stagePos;
  }, [stagePos]);

  const setPanningClass = useCallback((on: boolean) => {
    panningRef.current = on;
    containerRef.current?.classList.toggle("panning", on);
  }, []);

  /** Двигает Stage без React-ререндера (плавный pan/zoom). */
  const applyStageView = useCallback(
    (pos: { x: number; y: number }, nextScale?: number) => {
      stagePosRef.current = pos;
      if (typeof nextScale === "number") {
        scaleRef.current = nextScale;
      }
      const stage = stageRef.current;
      if (!stage) return;
      stage.position(pos);
      if (typeof nextScale === "number") {
        stage.scale({ x: nextScale, y: nextScale });
      }
      stage.batchDraw();
    },
    [],
  );

  /** Синхронизирует React-состояние с фактическим видом Stage. */
  const commitStageView = useCallback(() => {
    if (stageCommitRafRef.current != null) {
      window.cancelAnimationFrame(stageCommitRafRef.current);
      stageCommitRafRef.current = null;
    }
    setStagePos({ ...stagePosRef.current });
    setScale(scaleRef.current);
  }, []);

  const scheduleCommitStageView = useCallback(() => {
    if (stageCommitRafRef.current != null) return;
    stageCommitRafRef.current = window.requestAnimationFrame(() => {
      stageCommitRafRef.current = null;
      setStagePos({ ...stagePosRef.current });
      setScale(scaleRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (stageCommitRafRef.current != null) {
        window.cancelAnimationFrame(stageCommitRafRef.current);
      }
    };
  }, []);

  const canEdit = appMode === "build" && Boolean(authUser?.canEditMap ?? authUser?.role === "admin");
  const isAdmin = Boolean(authUser?.canEditMap ?? authUser?.role === "admin");
  const canEditShelves = Boolean(
    authUser?.canEditShelves ?? (authUser?.role === "admin" || authUser?.role === "user")
  );
  const drawMode = canEdit && tool !== null;

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (!cancelled) setAuthUser(user);
      })
      .catch(() => {
        if (!cancelled) setAuthUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authUser?.role === "user") {
      setAppMode("use");
      setTool(null);
    }
  }, [authUser]);

  const centerOnDrawn = useCallback(
    (list: MapObject[] = objects) => {
      const next = fitStageToObjects(list, size.width, size.height);
      if (!next) {
        applyStageView({ x: 0, y: 0 }, 1);
        commitStageView();
        return;
      }
      applyStageView({ x: next.x, y: next.y }, next.scale);
      commitStageView();
    },
    [applyStageView, commitStageView, objects, size.height, size.width],
  );

  const setDraftBoth = (next: DraftRect | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const setLineStartBoth = (next: WorldPoint | null) => {
    lineStartRef.current = next;
    setLineStart(next);
  };

  const stopWallDrawing = useCallback(() => {
    setTool(null);
    setLineStartBoth(null);
    setCursorPos(null);
    setDraftBoth(null);
    setSpawnMenu(null);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("stockmap-grid", showGrid ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, [showGrid]);

  useEffect(() => {
    try {
      localStorage.setItem("stockmap-mode", appMode);
    } catch {
      /* ignore */
    }
    if (appMode === "use") {
      stopWallDrawing();
      setRackCopyMode(false);
      setRackCopyIds([]);
    }
  }, [appMode, stopWallDrawing]);

  const zoomAt = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const stage = stageRef.current;
      const clamped = clampScale(nextScale);
      const oldScale = scaleRef.current;
      const oldPos = stagePosRef.current;
      const point =
        anchor ??
        (stage
          ? { x: stage.width() / 2, y: stage.height() / 2 }
          : { x: size.width / 2, y: size.height / 2 });

      const world = {
        x: (point.x - oldPos.x) / oldScale,
        y: (point.y - oldPos.y) / oldScale,
      };
      const nextPos = {
        x: point.x - world.x * clamped,
        y: point.y - world.y * clamped,
      };
      applyStageView(nextPos, clamped);
      scheduleCommitStageView();
    },
    [applyStageView, scheduleCommitStageView, size.height, size.width],
  );

  const resetView = () => {
    applyStageView({ x: 0, y: 0 }, 1);
    commitStageView();
  };

  const onCenterMap = () => {
    centerOnDrawn();
  };

  useEffect(() => {
    if (!authReady || !authUser) {
      setLoading(true);
      return;
    }
    setLoading(true);
    listObjects()
      .then(setObjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authReady, authUser]);

  useEffect(() => {
    // After login the map shell mounts; must re-bind (openedId alone is not enough).
    if (!authReady || !authUser || openedId != null) return;

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const rafIds: number[] = [];

    const attach = () => {
      const el = containerRef.current;
      if (!el || cancelled) return;
      observer?.disconnect();
      const sync = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w < 2 || h < 2) return;
        setSize((prev) =>
          prev.width === w && prev.height === h ? prev : { width: w, height: h },
        );
      };
      sync();
      observer = new ResizeObserver(sync);
      observer.observe(el);
      rafIds.push(
        requestAnimationFrame(() => {
          sync();
          rafIds.push(requestAnimationFrame(sync));
        }),
      );
    };

    attach();

    return () => {
      cancelled = true;
      for (const id of rafIds) cancelAnimationFrame(id);
      observer?.disconnect();
    };
  }, [authReady, authUser, openedId, loading]);

  const drawnBoundsKey = useMemo(() => {
    if (objects.length === 0) return "empty";
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
    return [
      objects.length,
      Math.round(minX),
      Math.round(minY),
      Math.round(maxX),
      Math.round(maxY),
    ].join(":");
  }, [objects]);

  // Центрировать карту по нарисованному при входе / на телефоне.
  useEffect(() => {
    if (loading || openedId != null) return;
    if (size.width < 50 || size.height < 50) return;
    if (drawnBoundsKey === "empty") return;

    const fitKey = `${appMode}|${drawnBoundsKey}|${Math.round(size.width)}x${Math.round(size.height)}`;

    if (appMode === "use") {
      if (lastFitKeyRef.current === fitKey) return;
      centerOnDrawn(objects);
      lastFitKeyRef.current = fitKey;
      initialFitDoneRef.current = true;
      return;
    }

    if (!initialFitDoneRef.current) {
      centerOnDrawn(objects);
      lastFitKeyRef.current = fitKey;
      initialFitDoneRef.current = true;
    }
  }, [
    appMode,
    centerOnDrawn,
    drawnBoundsKey,
    loading,
    objects,
    openedId,
    size.height,
    size.width,
  ]);

  const selected = objects.find((s) => s.id === selectedId) ?? null;
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void searchWarehouse(q)
        .then((res) => {
          if (cancelled) return;
          setSearchHits(res.items);
          setSearchError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setSearchHits([]);
          setSearchError(err.message);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const openSearchHit = (hit: WarehouseSearchHit) => {
    setSearchOpen(false);
    setSelectedId(hit.rackId);
    setFocusItemId(hit.shelfItemId);
    setOpenedId(hit.rackId);
  };

  const deepLinkHandled = useRef(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q?.trim()) {
        setSearchQuery(q.trim());
        setSearchOpen(true);
        deepLinkHandled.current = false;
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (deepLinkHandled.current) return;
    const q = searchQuery.trim();
    if (!q || searchLoading) return;
    if (searchHits.length === 1) {
      deepLinkHandled.current = true;
      openSearchHit(searchHits[0]!);
    } else if (searchHits.length > 1 || (q && !searchLoading)) {
      deepLinkHandled.current = true;
    }
  }, [searchHits, searchLoading, searchQuery]);

  const opened =
    objects.find(
      (s) =>
        s.id === openedId && (s.type === "rack" || s.type === "pallet"),
    ) ?? null;

  const grid = useMemo(
    () => buildVisibleGrid(size.width, size.height, scale, stagePos),
    [size.width, size.height, scale, stagePos],
  );
  const gridStroke = 1 / scale;

  const persistPatch = useCallback(async (id: number, patch: Partial<MapObject>) => {
    setObjects((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    try {
      const updated = await updateObject(id, patch);
      setObjects((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
      setObjects(await listObjects());
    }
  }, []);

  const finishDraft = useCallback(
    async (
      rect: DraftRect,
      opts?: { keepWallTool?: boolean; continueFrom?: WorldPoint },
    ): Promise<boolean> => {
      if (!tool && !opts?.keepWallTool) {
        setDraftBoth(null);
        return false;
      }
      const activeTool = tool;
      if (!activeTool) {
        setDraftBoth(null);
        return false;
      }

      let width = Math.abs(rect.width);
      let height = Math.abs(rect.height);
      let x = rect.width < 0 ? rect.x + rect.width : rect.x;
      let y = rect.height < 0 ? rect.y + rect.height : rect.y;

      const normalized = normalizeDrawnSize(activeTool, width, height);
      width = normalized.width;
      height = normalized.height;

      if (activeTool === "chair" && Math.abs(rect.width) < 8 && Math.abs(rect.height) < 8) {
        x = rect.x - width / 2;
        y = rect.y - height / 2;
      }

      if (
        activeTool === "wall" ||
        activeTool === "door" ||
        activeTool === "window"
      ) {
        const snapped = snapSegmentRect(activeTool, { x, y, width, height });
        x = snapped.x;
        y = snapped.y;
        width = snapped.width;
        height = snapped.height;
      }

      const limits = minSize(activeTool);
      if (
        Math.min(width, height) < limits.minSide ||
        Math.max(width, height) < limits.minLong
      ) {
        setDraftBoth(null);
        return false;
      }

      try {
        const created = await createObject({
          type: activeTool,
          label:
            activeTool === "rack"
              ? nextRackLabel.trim() || "Стеллаж"
              : defaultLabel(activeTool),
          x: snapsToMapGrid(activeTool) ? snapToGridValue(x) : Math.round(x),
          y: snapsToMapGrid(activeTool) ? snapToGridValue(y) : Math.round(y),
          width: snapsToMapGrid(activeTool)
            ? snapRackSize(Math.round(width))
            : Math.round(width),
          height: snapsToMapGrid(activeTool)
            ? snapRackSize(Math.round(height))
            : Math.round(height),
          shelvesCount: activeTool === "rack" ? 5 : null,
          frameWidth: activeTool === "rack" ? DEFAULT_FRAME_WIDTH : null,
          rackTheme: "blue",
          rotation: 0,
        });
        setObjects((prev) => [...prev, created]);
        setSelectedId(created.id);
        if (activeTool === "rack") {
          setNextRackLabel(nextLabel(created.label));
        }

        if (
          (activeTool === "wall" ||
            activeTool === "door" ||
            activeTool === "window") &&
          opts?.continueFrom
        ) {
          setLineStartBoth(opts.continueFrom);
          setCursorPos(opts.continueFrom);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось создать");
        return false;
      } finally {
        setDraftBoth(null);
      }
    },
    [nextRackLabel, tool],
  );

  const placeAtPoint = useCallback(
    async (
      type: ObjectType,
      world: WorldPoint,
      opts?: {
        label?: string;
        shelvesCount?: number;
        width?: number;
        length?: number;
        rackTheme?: RackTheme;
      },
    ) => {
      setTool(type);
      const rect =
        type === "rack" && opts?.width != null && opts?.length != null
          ? {
              x: world.x - opts.width / 2,
              y: world.y - opts.length / 2,
              width: opts.width,
              height: opts.length,
            }
          : defaultDraftAt(type, snapToGrid(world, showGrid));
      let width = Math.abs(rect.width);
      let height = Math.abs(rect.height);
      let x = rect.width < 0 ? rect.x + rect.width : rect.x;
      let y = rect.height < 0 ? rect.y + rect.height : rect.y;
      const normalized = normalizeDrawnSize(type, width, height);
      width = normalized.width;
      height = normalized.height;
      const label =
        type === "rack"
          ? opts?.label?.trim() || nextRackLabel.trim() || "Стеллаж"
          : opts?.label?.trim() || defaultLabel(type);
      const rackShelves =
        type === "rack" ? (opts?.shelvesCount ?? 5) : null;
      try {
        const created = await createObject({
          type,
          label,
          x: snapsToMapGrid(type) ? snapToGridValue(x) : Math.round(x),
          y: snapsToMapGrid(type) ? snapToGridValue(y) : Math.round(y),
          width:
            snapsToMapGrid(type)
              ? snapRackSize(Math.round(width))
              : Math.round(width),
          height:
            snapsToMapGrid(type)
              ? snapRackSize(Math.round(height))
              : Math.round(height),
          shelvesCount: rackShelves,
          frameWidth: type === "rack" ? DEFAULT_FRAME_WIDTH : null,
          rackTheme:
            type === "rack"
              ? normalizeRackTheme(opts?.rackTheme)
              : "blue",
          rotation: 0,
        });
        setObjects((prev) => [...prev, created]);
        setSelectedId(created.id);
        if (type === "rack") {
          setNextRackLabel(nextLabel(label));
        }
        setTool(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось создать");
        setTool(null);
      }
    },
    [nextRackLabel, showGrid],
  );

  const confirmRackForm = useCallback(() => {
    if (!rackForm) return;
    const width = snapRackSize(rackForm.width);
    const length = snapRackSize(rackForm.length);
    const shelvesCount = Math.max(
      1,
      Math.min(40, Math.round(rackForm.shelvesCount) || 5),
    );
    const form = rackForm;
    setRackForm(null);
    void placeAtPoint("rack", form.world, {
      label: form.label.trim() || "Стеллаж",
      shelvesCount,
      width,
      length,
      rackTheme: form.rackTheme,
    });
  }, [placeAtPoint, rackForm]);

  const confirmRackEdit = useCallback(() => {
    if (!rackEdit) return;
    const width = snapRackSize(rackEdit.width);
    const length = snapRackSize(rackEdit.length);
    const shelvesCount = Math.max(
      1,
      Math.min(40, Math.round(rackEdit.shelvesCount) || 5),
    );
    const id = rackEdit.id;
    const prevShelves = rackEdit.initialShelvesCount;
    const patch = {
      label: rackEdit.label.trim() || "Стеллаж",
      shelvesCount,
      width,
      height: length,
      rackTheme: rackEdit.rackTheme,
    };

    void (async () => {
      if (shelvesCount < prevShelves) {
        const ok = await confirm({
          title: "Уменьшить число полок?",
          description:
            "Объекты на верхних полках (выше нового числа) будут удалены безвозвратно.",
          confirmLabel: "Уменьшить",
        });
        if (!ok) return;
      }
      setRackEdit(null);
      void persistPatch(id, patch);
    })();
  }, [confirm, persistPatch, rackEdit]);

  const startWallDraw = useCallback((type: "wall" | "door" | "window") => {
    setTool(type);
    setLineStartBoth(null);
    setCursorPos(null);
    setSelectedId(null);
    setSpawnMenu(null);
  }, []);

  const onPickSpawnType = useCallback(
    (type: ObjectType) => {
      if (!spawnMenu) return;
      const world = spawnMenu.world;
      setSpawnMenu(null);
      if (type === "wall" || type === "door" || type === "window") {
        startWallDraw(type);
        return;
      }
      if (type === "zone") {
        void (async () => {
          const label = await prompt({
            title: "Название жёлтой зоны",
            description: "Это имя будет в центре зоны поверх стеллажей и паллет.",
            defaultValue: "Зона",
            placeholder: "Например: Приёмка",
            confirmLabel: "Создать",
            variant: "accent",
          });
          if (label == null) return;
          void placeAtPoint("zone", world, {
            label: label.trim() || "Зона",
          });
        })();
        return;
      }
      if (type === "rack") {
        setRackForm({
          world,
          label: nextRackLabel,
          shelvesCount: 5,
          width: RACK_DEFAULT_WIDTH,
          length: RACK_DEFAULT_LENGTH,
          rackTheme: "blue",
        });
        return;
      }
      void placeAtPoint(type, world);
    },
    [nextRackLabel, placeAtPoint, prompt, spawnMenu, startWallDraw],
  );

  const onEmptyTarget = (target: Konva.Node, stage: Konva.Stage) =>
    target === stage ||
    target.name() === "floor" ||
    target.getParent()?.name() === "floor";

  const findMapObjectGroup = (target: Konva.Node, stage: Konva.Stage) => {
    let node: Konva.Node | null = target;
    while (node && node !== stage) {
      if (node.name() === "map-object") return node;
      node = node.getParent();
    }
    return null;
  };

  /** Пан можно начинать с объекта, кроме уже выбранного (его двигают драгом). */
  const canStartMapPanFromTarget = (target: Konva.Node, stage: Konva.Stage) => {
    if (drawMode) return false;
    const group = findMapObjectGroup(target, stage);
    if (!group) return true;
    if (!canEdit || selectedId == null) return true;
    return group.id() !== `mo-${selectedId}`;
  };

  const stopMapObjectDrags = (stage: Konva.Stage) => {
    for (const node of stage.find(".map-object")) {
      if (typeof (node as Konva.Node & { isDragging?: () => boolean }).isDragging === "function") {
        if ((node as Konva.Node & { isDragging: () => boolean }).isDragging()) {
          (node as Konva.Node & { stopDrag: () => void }).stopDrag();
        }
      }
    }
  };

  const openSpawnMenu = useCallback(
    (stage: Konva.Stage, clientX: number, clientY: number) => {
      if (!canEdit) return;
      const wrap = containerRef.current;
      if (!wrap) return;
      const raw = getWorldPointer(stage);
      if (!raw) return;
      const world = snapToGrid(raw, showGrid);
      const rect = wrap.getBoundingClientRect();
      const menuW = 148;
      const menuH = TOOLS.length * 40 + 12;
      const left = Math.min(
        Math.max(8, clientX - rect.left),
        Math.max(8, wrap.clientWidth - menuW - 8),
      );
      const top = Math.min(
        Math.max(8, clientY - rect.top),
        Math.max(8, wrap.clientHeight - menuH - 8),
      );
      setSpawnMenu({ left, top, world });
      setSelectedId(null);
    },
    [canEdit, showGrid],
  );

  const handleWallClick = useCallback(
    (raw: WorldPoint) => {
      if (tool !== "wall" && tool !== "door" && tool !== "window") return;
      if (wallPlaceLockRef.current) return;
      const pos = snapWallPoint(raw);
      const start = lineStartRef.current;
      if (!start) {
        setLineStartBoth(pos);
        setCursorPos(pos);
        return;
      }
      const segment = wallSegmentFromPoints(tool, start, pos);
      if (!segment) {
        // слишком короткий клик — не сбрасываем начало цепочки
        setCursorPos(orthogonalWallEnd(start, pos));
        return;
      }
      // сразу продолжаем от конца поставленной стены (до ответа сервера)
      wallPlaceLockRef.current = true;
      setLineStartBoth(segment.end);
      setCursorPos(segment.end);
      void finishDraft(segment.rect, {
        keepWallTool: true,
        continueFrom: segment.end,
      })
        .then((ok) => {
          if (!ok) {
            setLineStartBoth(start);
            setCursorPos(start);
          }
        })
        .finally(() => {
          wallPlaceLockRef.current = false;
        });
    },
    [finishDraft, tool],
  );

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const isMiddle = e.evt.button === 1;
    const isLeft = e.evt.button === 0;

    if (isMiddle) {
      e.evt.preventDefault();
      setSpawnMenu(null);
      pendingPanRef.current = null;
      panRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        sx: stagePosRef.current.x,
        sy: stagePosRef.current.y,
      };
      setPanningClass(true);
      return;
    }

    if (isLeft && !drawMode && canStartMapPanFromTarget(e.target, stage)) {
      e.evt.preventDefault();
      setSpawnMenu(null);
      pendingPanRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        sx: stagePosRef.current.x,
        sy: stagePosRef.current.y,
      };
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (pendingPanRef.current && !panRef.current) {
      const dx = e.evt.clientX - pendingPanRef.current.x;
      const dy = e.evt.clientY - pendingPanRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        panRef.current = pendingPanRef.current;
        pendingPanRef.current = null;
        setPanningClass(true);
        const stage = e.target.getStage();
        if (stage) stopMapObjectDrags(stage);
      } else {
        return;
      }
    }

    if (panRef.current) {
      const dx = e.evt.clientX - panRef.current.x;
      const dy = e.evt.clientY - panRef.current.y;
      applyStageView({
        x: panRef.current.sx + dx,
        y: panRef.current.sy + dy,
      });
      return;
    }

    if (!drawMode) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const raw = getWorldPointer(stage);
    if (!raw) return;
    const pos =
      tool === "wall" || tool === "door" || tool === "window"
        ? snapWallPoint(raw)
        : snapToGrid(raw, showGrid);
    lastWorldRef.current = pos;
    setCursorPos(pos);
  };

  const onMouseUp = (e?: Konva.KonvaEventObject<MouseEvent>) => {
    pendingPanRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanningClass(false);
      commitStageView();
      return;
    }
    if (!drawMode) return;
    const stage = e?.target.getStage() ?? stageRef.current;
    if (!stage) return;
    const raw = getWorldPointer(stage) ?? lastWorldRef.current;
    if (!raw) return;
    handleWallClick(raw);
  };

  const getTouchDistance = (t: TouchList) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };

  const getTouchCenter = (t: TouchList, stage: Konva.Stage) => {
    const rect = stage.container().getBoundingClientRect();
    return {
      x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
      y: (t[0].clientY + t[1].clientY) / 2 - rect.top,
    };
  };

  const onTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const touches = e.evt.touches;

    if (touches.length === 2) {
      e.evt.preventDefault();
      panRef.current = null;
      pendingPanRef.current = null;
      setPanningClass(false);
      setSpawnMenu(null);
      stopMapObjectDrags(stage);
      pinchRef.current = {
        lastDist: getTouchDistance(touches),
        lastCenter: getTouchCenter(touches, stage),
      };
      return;
    }

    if (touches.length === 1) {
      if (!drawMode && canStartMapPanFromTarget(e.target, stage)) {
        e.evt.preventDefault();
        setSpawnMenu(null);
        pendingPanRef.current = {
          x: touches[0].clientX,
          y: touches[0].clientY,
          sx: stagePosRef.current.x,
          sy: stagePosRef.current.y,
        };
        return;
      }
      if (drawMode && onEmptyTarget(e.target, stage)) {
        const raw = getWorldPointer(stage);
        if (raw) {
          const pos =
            tool === "wall" || tool === "door" || tool === "window"
              ? snapWallPoint(raw)
              : snapToGrid(raw, showGrid);
          lastWorldRef.current = pos;
          setCursorPos(pos);
        }
      }
    }
  };

  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const touches = e.evt.touches;

    if (touches.length === 2 && pinchRef.current) {
      e.evt.preventDefault();
      pendingPanRef.current = null;
      const dist = getTouchDistance(touches);
      const center = getTouchCenter(touches, stage);
      if (pinchRef.current.lastDist > 0) {
        const oldScale = scaleRef.current;
        const oldPos = stagePosRef.current;
        const nextScale = clampScale(
          oldScale * (dist / pinchRef.current.lastDist),
        );
        const world = {
          x: (center.x - oldPos.x) / oldScale,
          y: (center.y - oldPos.y) / oldScale,
        };
        const nextPos = {
          x: center.x - world.x * nextScale,
          y: center.y - world.y * nextScale,
        };
        applyStageView(nextPos, nextScale);
      }
      pinchRef.current = { lastDist: dist, lastCenter: center };
      return;
    }

    if (pendingPanRef.current && !panRef.current && touches.length === 1) {
      const dx = touches[0].clientX - pendingPanRef.current.x;
      const dy = touches[0].clientY - pendingPanRef.current.y;
      if (Math.hypot(dx, dy) > 8) {
        panRef.current = pendingPanRef.current;
        pendingPanRef.current = null;
        setPanningClass(true);
        stopMapObjectDrags(stage);
      } else {
        return;
      }
    }

    if (panRef.current && touches.length === 1) {
      e.evt.preventDefault();
      const dx = touches[0].clientX - panRef.current.x;
      const dy = touches[0].clientY - panRef.current.y;
      applyStageView({
        x: panRef.current.sx + dx,
        y: panRef.current.sy + dy,
      });
      return;
    }

    if (!drawMode || touches.length !== 1) return;
    const raw = getWorldPointer(stage);
    if (!raw) return;
    const pos =
      tool === "wall" || tool === "door" || tool === "window"
        ? snapWallPoint(raw)
        : snapToGrid(raw, showGrid);
    lastWorldRef.current = pos;
    setCursorPos(pos);
  };

  const onTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const hadPinch = pinchRef.current != null;
    if (e.evt.touches.length < 2) {
      pinchRef.current = null;
    }
    if (e.evt.touches.length !== 0) return;

    pendingPanRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanningClass(false);
      commitStageView();
      return;
    }
    if (hadPinch) {
      commitStageView();
      return;
    }

    if (!drawMode) return;
    const raw = lastWorldRef.current ?? cursorPos;
    if (!raw) return;
    handleWallClick(raw);
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const current = scaleRef.current;
    const next = direction > 0 ? current * SCALE_STEP : current / SCALE_STEP;
    zoomAt(next, pointer);
  };

  const copySelectedRacks = async () => {
    if (!canEdit || rackCopyIds.length === 0) return;
    setError(null);
    try {
      const createdAll: MapObject[] = [];
      for (const sourceId of rackCopyIds) {
        const src = objects.find((o) => o.id === sourceId);
        if (!src || src.type !== "rack") continue;
        const gap = GRID;
        let x = src.x + src.width + gap;
        let y = src.y;
        const overlaps = (nx: number, ny: number) =>
          [...objects, ...createdAll].some(
            (o) =>
              o.type === "rack" &&
              nx < o.x + o.width &&
              nx + src.width > o.x &&
              ny < o.y + o.height &&
              ny + src.height > o.y,
          );
        let guard = 0;
        while (overlaps(x, y) && guard < 40) {
          x += src.width + gap;
          guard += 1;
        }
        const created = await createObject({
          type: "rack",
          label: src.label,
          x,
          y,
          width: src.width,
          height: src.height,
          shelvesCount: src.shelvesCount,
          rotation: src.rotation ?? 0,
          frameWidth: src.frameWidth,
          rackTheme: src.rackTheme,
        });
        createdAll.push(created);

        const sourceItems = await listShelfItems(src.id);
        const sorted = [...sourceItems].sort(
          (a, b) =>
            a.shelfIndex - b.shelfIndex ||
            (a.depthRow ?? 1) - (b.depthRow ?? 1) ||
            (a.posX ?? 0) - (b.posX ?? 0) ||
            (a.stackOrder ?? 0) - (b.stackOrder ?? 0),
        );
        const idMap = new Map<number, number>();
        for (const item of sorted) {
          const below =
            (item.stackOrder ?? 0) > 0
              ? sorted.find(
                  (candidate) =>
                    candidate.shelfIndex === item.shelfIndex &&
                    (candidate.depthRow ?? 1) === (item.depthRow ?? 1) &&
                    (candidate.posX ?? 0) === (item.posX ?? 0) &&
                    (candidate.stackOrder ?? 0) === (item.stackOrder ?? 0) - 1,
                )
              : null;
          const stackOntoId = below ? idMap.get(below.id) : undefined;
          const createdItem = await createShelfItem(created.id, {
            shelfIndex: item.shelfIndex,
            type: item.type,
            depthRow: item.depthRow ?? 1,
            widthRatio: item.widthRatio,
            ...(stackOntoId != null
              ? { stackOntoId }
              : { posX: item.posX ?? 0 }),
          });
          idMap.set(item.id, createdItem.id);
          const needsInfo =
            Boolean(item.title) ||
            Boolean(item.details) ||
            Boolean(item.quantity) ||
            (item.contents ?? []).length > 0;
          if (needsInfo) {
            await updateShelfItem(createdItem.id, {
              title: item.title,
              details: item.details,
              quantity: item.quantity,
              widthRatio: item.widthRatio,
              posX: item.posX ?? 0,
            });
          }
          if ((item.contents ?? []).length > 0) {
            await setShelfItemContents(
              createdItem.id,
              (item.contents ?? []).map((c) => ({
                kind: c.kind,
                refId: c.refId,
                nameSnapshot: c.nameSnapshot,
                typeSnapshot: c.typeSnapshot,
                quantity: c.quantity,
              })),
            );
          }
        }
      }
      if (createdAll.length > 0) {
        setObjects((prev) => [...prev, ...createdAll]);
        setSelectedId(createdAll[createdAll.length - 1]!.id);
      }
      setRackCopyMode(false);
      setRackCopyIds([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось скопировать стеллажи",
      );
    }
  };

  const removeSelected = async () => {
    if (!selectedId) return;
    try {
      await deleteObject(selectedId);
      setObjects((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      setRackCopyIds((prev) => prev.filter((id) => id !== selectedId));
      if (openedId === selectedId) setOpenedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const wallDrawing =
    tool === "wall" || tool === "door" || tool === "window";
  const previewSegment =
    lineStart && cursorPos && wallDrawing
      ? { a: lineStart, b: orthogonalWallEnd(lineStart, cursorPos) }
      : null;
  const previewDoorDraft =
    previewSegment && tool === "door"
      ? segmentToDraft("door", previewSegment.a, previewSegment.b)
      : null;
  const previewWindowDraft =
    previewSegment && tool === "window"
      ? segmentToDraft("window", previewSegment.a, previewSegment.b)
      : null;

  if (!authReady) {
    return (
      <div className="login-screen">
        <p className="login-loading">Проверка входа…</p>
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen />;
  }

  if (opened) {
    if (opened.type === "pallet") {
      return (
        <div className={`app mode-${appMode}`}>
          <PalletInterior
            pallet={opened}
            canEdit={canEditShelves}
            onBack={() => {
              setOpenedId(null);
              setFocusItemId(null);
            }}
            onLabelChange={(label) =>
              void persistPatch(opened.id, { label })
            }
          />
        </div>
      );
    }
    return (
      <div className={`app mode-${appMode}`}>
        <RackInterior
          rack={opened}
          canEditMap={isAdmin}
          canEditShelves={canEditShelves}
          requireShelfConfirm={Boolean(authUser.requireShelfConfirm)}
          focusItemId={focusItemId}
          onClearFocus={() => setFocusItemId(null)}
          onBack={() => {
            setOpenedId(null);
            setFocusItemId(null);
          }}
          onRackChange={(patch) => void persistPatch(opened.id, patch)}
        />
      </div>
    );
  }

  return (
    <div className={`app mode-${appMode}`}>
      <div className="map-shell">
        <header className="chrome">
          <div className="chrome-row chrome-brand-row">
            <button
              type="button"
              className="btn ghost chrome-hub"
              onClick={() => {
                const target = "/";
                if (window.top && window.top !== window) {
                  window.top.location.href = target;
                  return;
                }
                window.location.href = target;
              }}
              aria-label="На главный экран TaskMaster"
              title="На главный экран TaskMaster"
            >
              TaskMaster
            </button>
            <p className="brand">
              <svg
                className="brand-icon"
                viewBox="0 0 24 24"
                width="1em"
                height="1em"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M3.6 7.2 12 3.1l8.4 4.1v9.6L12 20.9 3.6 16.8V7.2zm1.7 1.55v6.7L11.1 19v-6.75L5.3 8.75zm13.4 0L12.9 12.25V19l5.8-2.85v-6.7zM12 4.95 7.15 7.35 12 9.75l4.85-2.4L12 4.95z"
                />
              </svg>
              Карта склада
            </p>
            {isAdmin && (
              <div className="mode-switch" role="group" aria-label="Режим">
                <button
                  type="button"
                  className={appMode === "build" ? "btn mode active" : "btn mode"}
                  onClick={() => setAppMode("build")}
                >
                  Редактирование
                </button>
                <button
                  type="button"
                  className={appMode === "use" ? "btn mode active" : "btn mode"}
                  onClick={() => setAppMode("use")}
                >
                  Просмотр
                </button>
              </div>
            )}
          </div>

          <div className="chrome-row chrome-search-row">
            <div className="warehouse-search">
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (searchHits[0]) openSearchHit(searchHits[0]);
                    else setSearchOpen(true);
                  }
                }}
                placeholder="Найти на складе…"
                aria-label="Поиск по складу"
              />
              {searchOpen && searchQuery.trim() && (
                <div className="warehouse-search-panel" role="listbox">
                  {searchLoading ? (
                    <p className="warehouse-search-empty">Поиск…</p>
                  ) : searchError ? (
                    <p className="warehouse-search-empty">{searchError}</p>
                  ) : searchHits.length === 0 ? (
                    <p className="warehouse-search-empty">Ничего не найдено</p>
                  ) : (
                    searchHits.map((hit) => {
                      const matchLabel =
                        hit.matchedContents[0]?.nameSnapshot ||
                        hit.title ||
                        entityTitle(hit.itemType);
                      const typeLabel = hit.matchedContents[0]?.typeSnapshot;
                      return (
                        <button
                          key={hit.shelfItemId}
                          type="button"
                          className="warehouse-search-hit"
                          onClick={() => openSearchHit(hit)}
                        >
                          <strong>
                            {typeLabel ? `${typeLabel}: ` : ""}
                            {matchLabel}
                          </strong>
                          <span>
                            {hit.rackLabel}
                            {" · "}
                            {hit.shelfIndex >
                            (objects.find((o) => o.id === hit.rackId)?.shelvesCount ?? 0)
                              ? "Верх стеллажа"
                              : `Полка ${hit.shelfIndex}`}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn primary search-go-btn"
              disabled={!searchQuery.trim() || searchLoading}
              onClick={() => {
                if (searchHits[0]) openSearchHit(searchHits[0]);
                else setSearchOpen(true);
              }}
              aria-label="Найти"
              title="Найти"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M16.2 16.2 20 20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="search-go-label">Найти</span>
            </button>
          </div>

          {(canEdit || appMode === "build") && (
            <div className="toolbar">
              {canEdit && (
                <div className="grid-toggle" role="group" aria-label="Сетка">
                  <button
                    type="button"
                    className={showGrid ? "btn grid-btn active" : "btn grid-btn"}
                    onClick={() => setShowGrid(true)}
                  >
                    Сетка
                  </button>
                  <button
                    type="button"
                    className={!showGrid ? "btn grid-btn active" : "btn grid-btn"}
                    onClick={() => setShowGrid(false)}
                  >
                    Без сетки
                  </button>
                </div>
              )}

              {canEdit && (
                <button
                  type="button"
                  className="btn danger stop-draw-btn"
                  disabled={!wallDrawing}
                  aria-hidden={!wallDrawing}
                  tabIndex={wallDrawing ? 0 : -1}
                  onClick={stopWallDrawing}
                >
                  Стоп
                </button>
              )}

              {canEdit && (
                <>
                  <button
                    type="button"
                    className={rackCopyMode ? "btn mode active" : "btn mode"}
                    onClick={() => {
                      setTool(null);
                      setSpawnMenu(null);
                      setRackCopyMode((prev) => {
                        if (prev) setRackCopyIds([]);
                        return !prev;
                      });
                    }}
                    title="Выделить стеллажи и скопировать"
                  >
                    Копия стеллажей
                  </button>
                  {rackCopyMode && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={rackCopyIds.length === 0}
                      onClick={() => void copySelectedRacks()}
                    >
                      Скопировать ({rackCopyIds.length})
                    </button>
                  )}
                </>
              )}

              {appMode === "build" && (
                <button
                  type="button"
                  className="btn primary enter-btn"
                  disabled={selected?.type !== "rack" && selected?.type !== "pallet"}
                  onClick={() => {
                    if (!selected) return;
                    setFocusItemId(null);
                    setOpenedId(selected.id);
                  }}
                >
                  Войти
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  className="btn danger"
                  disabled={!selectedId}
                  onClick={() => void removeSelected()}
                >
                  Удалить
                </button>
              )}
            </div>
          )}
        </header>

        {error && (
          <div className="banner" role="alert">
            <span>{friendlyError(error)}</span>
            <button type="button" className="btn ghost" onClick={() => setError(null)}>
              Закрыть
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          className={`canvas-wrap ${drawMode ? "drawing" : ""}`}
        >
          {loading ? (
            <p className="status">Загрузка карты…</p>
          ) : (
            <Stage
              ref={stageRef}
              width={size.width}
              height={size.height}
              scaleX={scale}
              scaleY={scale}
              x={stagePos.x}
              y={stagePos.y}
              perfectDrawEnabled={false}
              onMouseDown={onMouseDown}
              onMousemove={onMouseMove}
              onMouseup={onMouseUp}
              onMouseLeave={() => {
                pendingPanRef.current = null;
                if (panRef.current) {
                  panRef.current = null;
                  setPanningClass(false);
                  commitStageView();
                }
              }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
              onWheel={onWheel}
              onContextMenu={(e) => e.evt.preventDefault()}
              onDblClick={(e) => {
                if (panningRef.current || wallDrawing || !canEdit) return;
                const stage = e.target.getStage();
                if (!stage || !onEmptyTarget(e.target, stage)) return;
                openSpawnMenu(stage, e.evt.clientX, e.evt.clientY);
              }}
              onDblTap={(e) => {
                if (panningRef.current || wallDrawing || !canEdit) return;
                const stage = e.target.getStage();
                if (!stage || !onEmptyTarget(e.target, stage)) return;
                const touch = e.evt.changedTouches?.[0];
                if (!touch) return;
                openSpawnMenu(stage, touch.clientX, touch.clientY);
              }}
              onClick={(e) => {
                if (panningRef.current || drawMode) return;
                if (
                  e.target === e.target.getStage() ||
                  e.target.name() === "floor"
                ) {
                  setSelectedId(null);
                  setSpawnMenu(null);
                }
              }}
              onTap={(e) => {
                if (panningRef.current || drawMode) return;
                if (
                  e.target === e.target.getStage() ||
                  e.target.name() === "floor"
                ) {
                  setSelectedId(null);
                  setSpawnMenu(null);
                }
              }}
            >
              <Layer perfectDrawEnabled={false} listening>
                <Rect
                  name="floor"
                  x={grid.floor.x}
                  y={grid.floor.y}
                  width={grid.floor.width}
                  height={grid.floor.height}
                  fill="#c8d2db"
                />
                {showGrid &&
                  grid.vertical.map((points, i) => (
                    <Line
                      key={`vx-${points[0]}-${i}`}
                      points={points}
                      stroke="#aeb9c4"
                      strokeWidth={gridStroke}
                      opacity={0.5}
                      listening={false}
                    />
                  ))}
                {showGrid &&
                  grid.horizontal.map((points, i) => (
                    <Line
                      key={`hy-${points[1]}-${i}`}
                      points={points}
                      stroke="#aeb9c4"
                      strokeWidth={gridStroke}
                      opacity={0.5}
                      listening={false}
                    />
                  ))}

                {[...objects]
                  .sort((a, b) => {
                    const order = mapObjectDrawOrder(a.type) - mapObjectDrawOrder(b.type);
                    if (order !== 0) return order;
                    return a.y + a.height - (b.y + b.height) || a.x - b.x;
                  })
                  .map((obj) => (
                  <MapObjectShape
                    key={obj.id}
                    obj={obj}
                    selected={
                      rackCopyMode
                        ? rackCopyIds.includes(obj.id)
                        : obj.id === selectedId
                    }
                    drawMode={drawMode}
                    canEdit={canEdit && !rackCopyMode}
                    stageScale={scale}
                    onSelect={() => {
                      if (rackCopyMode) {
                        if (obj.type !== "rack") return;
                        setRackCopyIds((prev) =>
                          prev.includes(obj.id)
                            ? prev.filter((id) => id !== obj.id)
                            : [...prev, obj.id],
                        );
                        return;
                      }
                      setSelectedId(obj.id);
                    }}
                    onOpen={() => {
                      if (rackCopyMode) return;
                      setFocusItemId(null);
                      setOpenedId(obj.id);
                    }}
                    onEdit={
                      canEdit &&
                      !rackCopyMode &&
                      (obj.type === "rack" || obj.type === "zone")
                        ? () => {
                            if (obj.type === "zone") {
                              void (async () => {
                                const next = await prompt({
                                  title: "Название жёлтой зоны",
                                  defaultValue: obj.label || "Зона",
                                  placeholder: "Например: Приёмка",
                                  confirmLabel: "Сохранить",
                                  variant: "accent",
                                });
                                if (next == null) return;
                                void persistPatch(obj.id, {
                                  label: next.trim() || obj.label || "Зона",
                                });
                              })();
                              return;
                            }
                            setRackEdit({
                              id: obj.id,
                              label: obj.label,
                              shelvesCount: obj.shelvesCount ?? 5,
                              initialShelvesCount: obj.shelvesCount ?? 5,
                              width: obj.width,
                              length: obj.height,
                              rackTheme: normalizeRackTheme(obj.rackTheme),
                            });
                          }
                        : undefined
                    }
                    onChange={(patch) => void persistPatch(obj.id, patch)}
                  />
                ))}

                {objects
                  .filter((obj) => obj.type === "zone" && obj.label.trim())
                  .map((obj) => {
                    const zoneLabel = obj.label.trim();
                    return (
                      <Text
                        key={`zone-label-${obj.id}`}
                        x={obj.x}
                        y={obj.y}
                        width={obj.width}
                        height={obj.height}
                        text={zoneLabel}
                        align="center"
                        verticalAlign="middle"
                        fontSize={mapLabelFontSize(
                          obj.width,
                          obj.height,
                          scale,
                          zoneLabel,
                          {
                            targetScreenPx: 16,
                            maxShareH: 0.5,
                            padding: 6,
                          },
                        )}
                        fontStyle="bold"
                        fill="#854d0e"
                        listening={false}
                        padding={6}
                        wrap="none"
                      />
                    );
                  })}

                {previewSegment && tool === "wall" && (
                  <Line
                    points={[
                      previewSegment.a.x,
                      previewSegment.a.y,
                      previewSegment.b.x,
                      previewSegment.b.y,
                    ]}
                    stroke="#2f6f8f"
                    strokeWidth={4 / scale}
                    dash={[8 / scale, 5 / scale]}
                    lineCap="square"
                    lineJoin="miter"
                    listening={false}
                  />
                )}
                {previewSegment && tool === "door" && (
                  <>
                    <Line
                      points={[
                        previewSegment.a.x,
                        previewSegment.a.y,
                        previewSegment.b.x,
                        previewSegment.b.y,
                      ]}
                      stroke="#2f6f8f"
                      strokeWidth={3 / scale}
                      dash={[8 / scale, 5 / scale]}
                      listening={false}
                    />
                    {previewDoorDraft && (
                      <Rect
                        x={
                          previewDoorDraft.width < 0
                            ? previewDoorDraft.x + previewDoorDraft.width
                            : previewDoorDraft.x
                        }
                        y={
                          previewDoorDraft.height < 0
                            ? previewDoorDraft.y + previewDoorDraft.height
                            : previewDoorDraft.y
                        }
                        width={Math.abs(previewDoorDraft.width)}
                        height={Math.abs(previewDoorDraft.height)}
                        fill="rgba(47, 111, 143, 0.22)"
                        stroke="#2f6f8f"
                        strokeWidth={1.5 / scale}
                        listening={false}
                      />
                    )}
                  </>
                )}
                {previewSegment && tool === "window" && (
                  <>
                    <Line
                      points={[
                        previewSegment.a.x,
                        previewSegment.a.y,
                        previewSegment.b.x,
                        previewSegment.b.y,
                      ]}
                      stroke="#5b9bb8"
                      strokeWidth={3 / scale}
                      dash={[8 / scale, 5 / scale]}
                      listening={false}
                    />
                    {previewWindowDraft && (
                      <Rect
                        x={
                          previewWindowDraft.width < 0
                            ? previewWindowDraft.x + previewWindowDraft.width
                            : previewWindowDraft.x
                        }
                        y={
                          previewWindowDraft.height < 0
                            ? previewWindowDraft.y + previewWindowDraft.height
                            : previewWindowDraft.y
                        }
                        width={Math.abs(previewWindowDraft.width)}
                        height={Math.abs(previewWindowDraft.height)}
                        fill="rgba(14, 165, 233, 0.75)"
                        stroke="#e0f2fe"
                        strokeWidth={3 / scale}
                        listening={false}
                      />
                    )}
                  </>
                )}
                {lineStart && wallDrawing && (
                  <Circle
                    x={lineStart.x}
                    y={lineStart.y}
                    radius={5 / scale}
                    fill="#2f6f8f"
                    listening={false}
                  />
                )}
              </Layer>
            </Stage>
          )}

          {spawnMenu && canEdit && (
            <div
              className="spawn-menu"
              style={{ left: spawnMenu.left, top: spawnMenu.top }}
              role="menu"
              aria-label="Создать объект"
            >
              {TOOLS.map(({ type, title }) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  className="spawn-menu-item"
                  onClick={() => onPickSpawnType(type)}
                >
                  {title}
                </button>
              ))}
            </div>
          )}

          {rackForm && (
            <div
              className="item-detail-backdrop"
              role="presentation"
              onClick={() => setRackForm(null)}
            >
              <form
                className="item-detail rack-create"
                role="dialog"
                aria-labelledby="rack-create-title"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmRackForm();
                }}
              >
                <div className="item-detail-head">
                  <div className="item-detail-type">
                    <div>
                      <p className="item-detail-kicker">Новый объект</p>
                      <h2
                        id="rack-create-title"
                        className="item-detail-heading"
                      >
                        Стеллаж
                      </h2>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setRackForm(null)}
                  >
                    Закрыть
                  </button>
                </div>

                <label className="field item-detail-field">
                  <span>Имя</span>
                  <input
                    value={rackForm.label}
                    onChange={(e) =>
                      setRackForm((prev) =>
                        prev ? { ...prev, label: e.target.value } : prev,
                      )
                    }
                    autoFocus
                    aria-label="Имя стеллажа"
                  />
                </label>
                <label className="field item-detail-field">
                  <span>Число полок</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={rackForm.shelvesCount}
                    onChange={(e) =>
                      setRackForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              shelvesCount: Math.max(
                                1,
                                Number(e.target.value) || 1,
                              ),
                            }
                          : prev,
                      )
                    }
                    aria-label="Число полок"
                  />
                </label>
                <div className="rack-create-sizes">
                  <label className="field item-detail-field">
                    <span>Ширина (клеток)</span>
                    <input
                      type="number"
                      min={1}
                      max={RACK_SIZE_MAX / GRID}
                      step={1}
                      value={Math.round(rackForm.width / GRID)}
                      onChange={(e) =>
                        setRackForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                width: snapRackSize(
                                  (Number(e.target.value) || 1) * GRID,
                                ),
                              }
                            : prev,
                        )
                      }
                      aria-label="Ширина стеллажа в клетках"
                    />
                  </label>
                  <label className="field item-detail-field">
                    <span>Длина (клеток)</span>
                    <input
                      type="number"
                      min={1}
                      max={RACK_SIZE_MAX / GRID}
                      step={1}
                      value={Math.round(rackForm.length / GRID)}
                      onChange={(e) =>
                        setRackForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                length: snapRackSize(
                                  (Number(e.target.value) || 1) * GRID,
                                ),
                              }
                            : prev,
                        )
                      }
                      aria-label="Длина стеллажа в клетках"
                    />
                  </label>
                </div>

                <fieldset className="field item-detail-field rack-theme-field">
                  <legend>Тема стеллажа</legend>
                  <p className="field-hint">
                    Свои цвета карты склада, не зависят от темы TaskMaster.
                  </p>
                  <div className="rack-theme-picks" role="radiogroup">
                    <button
                      type="button"
                      className={
                        rackForm.rackTheme === "blue"
                          ? "rack-theme-pick active"
                          : "rack-theme-pick"
                      }
                      aria-pressed={rackForm.rackTheme === "blue"}
                      onClick={() =>
                        setRackForm((prev) =>
                          prev ? { ...prev, rackTheme: "blue" } : prev,
                        )
                      }
                    >
                      <span className="rack-theme-swatch rack-theme-swatch-blue" />
                      Синий
                    </button>
                    <button
                      type="button"
                      className={
                        rackForm.rackTheme === "black"
                          ? "rack-theme-pick active"
                          : "rack-theme-pick"
                      }
                      aria-pressed={rackForm.rackTheme === "black"}
                      onClick={() =>
                        setRackForm((prev) =>
                          prev ? { ...prev, rackTheme: "black" } : prev,
                        )
                      }
                    >
                      <span className="rack-theme-swatch rack-theme-swatch-black" />
                      Чёрный
                    </button>
                  </div>
                </fieldset>

                <div className="item-detail-actions">
                  <button type="submit" className="btn primary">
                    Создать
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setRackForm(null)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          {rackEdit && (
            <div
              className="item-detail-backdrop"
              role="presentation"
              onClick={() => setRackEdit(null)}
            >
              <form
                className="item-detail rack-create"
                role="dialog"
                aria-labelledby="rack-edit-title"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmRackEdit();
                }}
              >
                <div className="item-detail-head">
                  <div className="item-detail-type">
                    <div>
                      <p className="item-detail-kicker">Параметры</p>
                      <h2
                        id="rack-edit-title"
                        className="item-detail-heading"
                      >
                        Стеллаж
                      </h2>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setRackEdit(null)}
                  >
                    Закрыть
                  </button>
                </div>

                <label className="field item-detail-field">
                  <span>Имя</span>
                  <input
                    value={rackEdit.label}
                    onChange={(e) =>
                      setRackEdit((prev) =>
                        prev ? { ...prev, label: e.target.value } : prev,
                      )
                    }
                    autoFocus
                    aria-label="Имя стеллажа"
                  />
                </label>
                <label className="field item-detail-field">
                  <span>Число полок</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={rackEdit.shelvesCount}
                    onChange={(e) =>
                      setRackEdit((prev) =>
                        prev
                          ? {
                              ...prev,
                              shelvesCount: Math.max(
                                1,
                                Number(e.target.value) || 1,
                              ),
                            }
                          : prev,
                      )
                    }
                    aria-label="Число полок"
                  />
                  <p className="field-hint">
                    Уменьшение удалит объекты с верхних полок. Ряды глубины
                    меняются внутри стеллажа.
                  </p>
                </label>
                <div className="rack-create-sizes">
                  <label className="field item-detail-field">
                    <span>Ширина (клеток)</span>
                    <input
                      type="number"
                      min={1}
                      max={RACK_SIZE_MAX / GRID}
                      step={1}
                      value={Math.round(rackEdit.width / GRID)}
                      onChange={(e) =>
                        setRackEdit((prev) =>
                          prev
                            ? {
                                ...prev,
                                width: snapRackSize(
                                  (Number(e.target.value) || 1) * GRID,
                                ),
                              }
                            : prev,
                        )
                      }
                      aria-label="Ширина стеллажа в клетках"
                    />
                  </label>
                  <label className="field item-detail-field">
                    <span>Длина (клеток)</span>
                    <input
                      type="number"
                      min={1}
                      max={RACK_SIZE_MAX / GRID}
                      step={1}
                      value={Math.round(rackEdit.length / GRID)}
                      onChange={(e) =>
                        setRackEdit((prev) =>
                          prev
                            ? {
                                ...prev,
                                length: snapRackSize(
                                  (Number(e.target.value) || 1) * GRID,
                                ),
                              }
                            : prev,
                        )
                      }
                      aria-label="Длина стеллажа в клетках"
                    />
                  </label>
                </div>

                <fieldset className="field item-detail-field rack-theme-field">
                  <legend>Тема стеллажа</legend>
                  <p className="field-hint">
                    Свои цвета карты склада, не зависят от темы TaskMaster.
                  </p>
                  <div className="rack-theme-picks" role="radiogroup">
                    <button
                      type="button"
                      className={
                        rackEdit.rackTheme === "blue"
                          ? "rack-theme-pick active"
                          : "rack-theme-pick"
                      }
                      aria-pressed={rackEdit.rackTheme === "blue"}
                      onClick={() =>
                        setRackEdit((prev) =>
                          prev ? { ...prev, rackTheme: "blue" } : prev,
                        )
                      }
                    >
                      <span className="rack-theme-swatch rack-theme-swatch-blue" />
                      Синий
                    </button>
                    <button
                      type="button"
                      className={
                        rackEdit.rackTheme === "black"
                          ? "rack-theme-pick active"
                          : "rack-theme-pick"
                      }
                      aria-pressed={rackEdit.rackTheme === "black"}
                      onClick={() =>
                        setRackEdit((prev) =>
                          prev ? { ...prev, rackTheme: "black" } : prev,
                        )
                      }
                    >
                      <span className="rack-theme-swatch rack-theme-swatch-black" />
                      Чёрный
                    </button>
                  </div>
                </fieldset>

                <div className="item-detail-actions">
                  <button type="submit" className="btn primary">
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      const id = rackEdit.id;
                      void (async () => {
                        const ok = await confirm({
                          title: "Удалить стеллаж?",
                          description:
                            "Стеллаж и все объекты на полках будут удалены.",
                          confirmLabel: "Удалить",
                        });
                        if (!ok) return;
                        setRackEdit(null);
                        try {
                          await deleteObject(id);
                          setObjects((prev) =>
                            prev.filter((entry) => entry.id !== id),
                          );
                          setSelectedId((cur) => (cur === id ? null : cur));
                          if (openedId === id) setOpenedId(null);
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Не удалось удалить",
                          );
                        }
                      })();
                    }}
                  >
                    Удалить стеллаж
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setRackEdit(null)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="zoom-controls" aria-label="Масштаб">
            <button
              type="button"
              className="btn zoom-btn"
              onClick={() => zoomAt(scale * SCALE_STEP)}
              title="Приблизить"
            >
              +
            </button>
            <button
              type="button"
              className="btn zoom-btn zoom-label"
              onClick={resetView}
              title="Масштаб 100%"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="btn zoom-btn"
              onClick={() => zoomAt(scale / SCALE_STEP)}
              title="Отдалить"
            >
              −
            </button>
            <button
              type="button"
              className="btn zoom-btn zoom-center-btn"
              onClick={onCenterMap}
              disabled={objects.length === 0}
              title="Центрировать карту"
              aria-label="Центрировать карту"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                aria-hidden
              >
                <circle
                  cx="12"
                  cy="12"
                  r="3.25"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="7.25"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  opacity="0.9"
                />
              </svg>
            </button>
          </div>

          {wallDrawing && (
            <div className="hud has-selection">
              <p>
                Рисуем: <strong>{toolTitle(tool!)}</strong>
                <span className="dot">·</span>
                {lineStart
                  ? "веди направление · клик — поставить · дальше сразу"
                  : "клик — начало · веди направление · клик — поставить"}
                <span className="dot">·</span>
                «Стоп» — закончить
              </p>
            </div>
          )}

          {appMode === "use" && (
            <div className="mobile-dock">
              <button
                type="button"
                className="btn primary enter-btn"
                disabled={selected?.type !== "rack"}
                onClick={() => {
                  if (!selected) return;
                  setFocusItemId(null);
                  setOpenedId(selected.id);
                }}
              >
                Войти в стеллаж
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function nextLabel(current: string) {
  const match = current.match(/^(.*?)(\d+)$/);
  if (!match) return current;
  const num = String(Number(match[2]) + 1).padStart(match[2].length, "0");
  return `${match[1]}${num}`;
}

function pluralShelves(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "полка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "полки";
  return "полок";
}

function toolTitle(type: ObjectType) {
  return TOOLS.find((t) => t.type === type)?.title ?? type;
}

function defaultLabel(type: ObjectType) {
  return toolTitle(type);
}

function friendlyError(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    if (parsed.message) return parsed.message;
    if (parsed.error) return parsed.error;
  } catch {
    /* plain text */
  }
  return raw;
}
