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
import { useDialog } from "./DialogContext";
import { readAccentColor } from "./uiTheme";

type DraftRect = { x: number; y: number; width: number; height: number };
type WorldPoint = { x: number; y: number };
type ShelfDropTarget = {
  shelfIndex: number;
  depthRow: number;
  posX: number;
};

const MAX_SHELF_ROWS = 8;

const WALL_THICKNESS = 14;
const DOOR_THICKNESS = 16;

/** Базовый шаг сетки. Для длины/ширины стеллажа = одна клетка. */
const GRID = 50;
const RACK_SIZE_MIN = GRID; // минимум 1 клетка
const RACK_SIZE_MAX = GRID * 20; // максимум 20 клеток
const RACK_DEFAULT_WIDTH = GRID * 2; // 2 клетки
const RACK_DEFAULT_LENGTH = GRID * 2;

function normalizeRackTheme(value: unknown): RackTheme {
  if (value === "black") return "black";
  // legacy "orange" theme → black frame + orange shelves
  if (value === "orange") return "black";
  return "blue";
}

function rackMapColors(theme: RackTheme, selected: boolean) {
  const accent = readAccentColor();
  switch (theme) {
    case "black":
      return {
        shadow: "#0a0c0e",
        fill: selected ? "#2a2e34" : "#1a1d22",
        stroke: selected ? accent : "#0d0f12",
        top: accent,
        text: "#f2f4f6",
        ring: accent,
      };
    case "blue":
    default:
      return {
        shadow: "#1a2a34",
        fill: selected ? "#2f6f8f" : "#3a5568",
        stroke: selected ? accent : "#243846",
        top: accent,
        text: "#f4f8fb",
        ring: accent,
      };
  }
}
const SCALE_MIN = 0.08;
const SCALE_MAX = 3;
const SCALE_STEP = 1.12;
const ENTITY_GAP = 8;
const DEFAULT_FRAME_WIDTH = 720;
const FRAME_WIDTH_MIN = 360;
const FRAME_WIDTH_MAX = 1600;

function snapToGridValue(value: number, enabled = true) {
  if (!enabled) return Math.round(value);
  return Math.round(value / GRID) * GRID;
}

/** Ширина/длина стеллажа — только целые клетки сетки. */
function snapRackSize(value: number) {
  const snapped = Math.round(value / GRID) * GRID;
  return Math.min(
    RACK_SIZE_MAX,
    Math.max(RACK_SIZE_MIN, snapped || RACK_SIZE_MIN),
  );
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
  { type: "wall", title: "Стена" },
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

function resolvePosNoOverlap(
  desired: number,
  width: number,
  others: { posX: number; width: number }[],
  maxRight?: number,
): number {
  const limit =
    maxRight != null && Number.isFinite(maxRight)
      ? Math.max(0, maxRight - width)
      : Number.POSITIVE_INFINITY;

  const sorted = [...others].sort((a, b) => a.posX - b.posX);
  type Gap = { start: number; end: number };
  const gaps: Gap[] = [];
  let cursor = 0;

  for (const other of sorted) {
    const end = Math.min(limit, other.posX - ENTITY_GAP - width);
    if (end >= cursor) gaps.push({ start: cursor, end });
    cursor = Math.max(cursor, other.posX + other.width + ENTITY_GAP);
  }
  if (limit >= cursor) {
    gaps.push({ start: cursor, end: limit });
  }

  const clampToShelf = (value: number) =>
    Math.min(limit === Number.POSITIVE_INFINITY ? value : limit, Math.max(0, value));

  for (const gap of gaps) {
    if (desired >= gap.start && desired <= gap.end) return clampToShelf(desired);
  }

  let best = clampToShelf(desired);
  let bestDist = Number.POSITIVE_INFINITY;
  for (const gap of gaps) {
    const clamped = Math.min(Math.max(desired, gap.start), gap.end);
    const dist = Math.abs(clamped - desired);
    if (dist < bestDist) {
      best = clamped;
      bestDist = dist;
    }
  }
  return clampToShelf(best);
}

/** Свободная позиция отдельно от любых существующих столбцов (нельзя совпасть по posX). */
function findSeparatePosX(
  preferred: number,
  width: number,
  others: { posX: number; width: number }[],
  shelfWidth: number,
): number {
  const occupied = new Set(others.map((entry) => entry.posX));
  const maxLeft = Math.max(0, shelfWidth - width);

  const fits = (pos: number) => {
    if (pos < 0 || pos > maxLeft) return false;
    if (occupied.has(pos)) return false;
    return others.every(
      (other) =>
        pos + width + ENTITY_GAP <= other.posX ||
        other.posX + other.width + ENTITY_GAP <= pos,
    );
  };

  const candidates: number[] = [
    Math.round(preferred),
    Math.round(resolvePosNoOverlap(preferred, width, others, shelfWidth)),
    0,
  ];
  for (const other of [...others].sort((a, b) => a.posX - b.posX)) {
    candidates.push(Math.round(other.posX + other.width + ENTITY_GAP));
    candidates.push(Math.round(other.posX - width - ENTITY_GAP));
  }

  for (const raw of candidates) {
    const pos = Math.min(maxLeft, Math.max(0, Math.round(raw)));
    if (fits(pos)) return pos;
  }

  for (let pos = 0; pos <= maxLeft; pos += 1) {
    if (fits(pos)) return pos;
  }

  // Крайний случай: уникальный posX без точного совпадения со стеком
  for (let pos = 0; pos <= maxLeft; pos += 1) {
    if (!occupied.has(pos)) return pos;
  }
  let pos = Math.round(preferred);
  while (occupied.has(pos)) pos += 1;
  return Math.min(maxLeft, Math.max(0, pos));
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

function overlapsColumn(
  pos: number,
  width: number,
  other: { posX: number; width: number },
) {
  return (
    pos + width + ENTITY_GAP > other.posX &&
    pos < other.posX + other.width + ENTITY_GAP
  );
}

function isFreeColumnPos(
  pos: number,
  columnWidth: number,
  shelfWidth: number,
  others: { posX: number; width: number }[],
) {
  const width = Math.max(columnWidth, 24);
  const maxLeft = shelfMaxLeft(width, shelfWidth);
  if (pos < 0 || pos > maxLeft) return false;
  return others.every((other) => !overlapsColumn(pos, width, other));
}

/**
 * Драг: жёсткие границы полки + скольжение до препятствия.
 * Никогда не телепортирует (раньше stayLeft&lt;0 сжимался в 0 — прыжок влево).
 */
function slideDragPos(
  desired: number,
  columnWidth: number,
  shelfWidth: number,
  others: { posX: number; width: number }[],
  lastGood: number,
) {
  const width = Math.max(columnWidth, 24);
  const origin = clampToShelfBounds(lastGood, width, shelfWidth);
  const target = clampToShelfBounds(desired, width, shelfWidth);
  if (target === origin) return origin;
  if (isFreeColumnPos(target, width, shelfWidth, others)) return target;

  // Идём от origin к target по 1px — останавливаемся перед препятствием
  const step = target > origin ? 1 : -1;
  let best = origin;
  for (let p = origin + step; step > 0 ? p <= target : p >= target; p += step) {
    if (!isFreeColumnPos(p, width, shelfWidth, others)) break;
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
  let cursor = 0;
  const posById = new Map<number, number>();
  for (const print of footprints) {
    let posX = Math.max(print.posX, cursor);
    if (shelfWidth != null) {
      posX = Math.min(posX, Math.max(0, shelfWidth - print.width));
    }
    cursor = posX + print.width + ENTITY_GAP;
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
): number {
  const others = groupShelfFootprints(shelfItems, shelfHeight).map((print) => ({
    posX: print.posX,
    width: print.width,
  }));
  return resolvePosNoOverlap(0, width, others, shelfWidth);
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

/** Ось стены: строго горизонталь или вертикаль от точки a. */
function orthogonalWallEnd(a: WorldPoint, b: WorldPoint): WorldPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: b.x, y: a.y };
  }
  return { x: a.x, y: b.y };
}

/** Отрезок → объект на карте (стены/двери — тонкая полоса по оси от старта). */
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

  if (type === "wall" || type === "door") {
    const end = orthogonalWallEnd(a, b);
    const dx = end.x - a.x;
    const dy = end.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return null;
    const thickness = type === "door" ? DOOR_THICKNESS : WALL_THICKNESS;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        x: Math.min(a.x, end.x),
        y: a.y - thickness / 2,
        width: Math.max(Math.abs(dx), 24),
        height: thickness,
      };
    }
    return {
      x: a.x - thickness / 2,
      y: Math.min(a.y, end.y),
      width: thickness,
      height: Math.max(Math.abs(dy), 24),
    };
  }

  // стеллаж / стол — прямоугольник по двум углам
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
  return { x: a.x, y: a.y, width: dx, height: dy };
}

function wallSegmentFromPoints(
  type: "wall" | "door",
  a: WorldPoint,
  b: WorldPoint,
): { rect: DraftRect; end: WorldPoint } | null {
  const end = orthogonalWallEnd(a, b);
  const rect = segmentToDraft(type, a, end);
  if (!rect) return null;
  return { rect, end };
}

/** Объект по двойному клику/тапу в одной точке (размер по умолчанию). */
function defaultDraftAt(type: ObjectType, pos: WorldPoint): DraftRect {
  switch (type) {
    case "wall":
      return {
        x: pos.x - 50,
        y: pos.y - WALL_THICKNESS / 2,
        width: 100,
        height: WALL_THICKNESS,
      };
    case "door":
      return {
        x: pos.x - 40,
        y: pos.y - DOOR_THICKNESS / 2,
        width: 80,
        height: DOOR_THICKNESS,
      };
    case "rack":
      return {
        x: pos.x - RACK_DEFAULT_WIDTH / 2,
        y: pos.y - RACK_DEFAULT_LENGTH / 2,
        width: RACK_DEFAULT_WIDTH,
        height: RACK_DEFAULT_LENGTH,
      };
    case "table":
      return { x: pos.x - 30, y: pos.y - 30, width: 60, height: 60 };
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
  const pad = GRID * 6;
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
    case "door":
      return { minSide: 6, minLong: 24 };
    case "chair":
      return { minSide: 18, minLong: 18 };
    case "table":
      return { minSide: 24, minLong: 24 };
    case "rack":
    default:
      return { minSide: RACK_SIZE_MIN, minLong: RACK_SIZE_MIN };
  }
}

function normalizeDrawnSize(type: ObjectType, width: number, height: number) {
  let w = width;
  let h = height;

  // Стена — только длина отрезка, толщина фиксирована (не редактируется)
  if (type === "wall") {
    if (w >= h) return { width: Math.max(w, 24), height: WALL_THICKNESS };
    return { width: WALL_THICKNESS, height: Math.max(h, 24) };
  }

  if (type === "door" && Math.max(w, h) >= 24) {
    if (w >= h * 2) h = Math.max(10, Math.min(h, DOOR_THICKNESS));
    else if (h >= w * 2) w = Math.max(10, Math.min(w, DOOR_THICKNESS));
  }

  if (type === "chair") {
    const side = Math.max(28, Math.min(Math.max(w, h), 44));
    return { width: side, height: side };
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
    const horizontal = w >= h;
    const points = horizontal
      ? [0, h / 2, w, h / 2]
      : [w / 2, 0, w / 2, h];
    return (
      <Line
        points={points}
        stroke={selected ? "#0f161c" : "#2a333c"}
        strokeWidth={selected ? 5 : 4}
        hitStrokeWidth={18}
        lineCap="round"
        lineJoin="round"
      />
    );
  }

  if (type === "door") {
    const horizontal = w >= h;
    return (
      <Group>
        <Rect
          width={w}
          height={h}
          fill={selected ? "#8aa4b5" : "#6f8796"}
          stroke={selected ? "#2f6f8f" : "#455864"}
          strokeWidth={1.5}
          dash={[6, 4]}
        />
        {horizontal ? (
          <Arc
            x={0}
            y={h / 2}
            innerRadius={0}
            outerRadius={Math.max(w * 0.85, 20)}
            angle={90}
            rotation={-90}
            stroke="#5a7382"
            strokeWidth={1.5}
            listening={false}
          />
        ) : (
          <Arc
            x={w / 2}
            y={0}
            innerRadius={0}
            outerRadius={Math.max(h * 0.85, 20)}
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
  const fontSize = Math.min(
    labelH * 0.42,
    labelW * 0.28,
    Math.min(36, Math.max(9, 12 / Math.max(stageScale, 0.08))),
  );
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
        text={obj.label || "Стеллаж"}
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
        ellipsis
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
  const canResize = obj.type !== "wall";
  const isRack = obj.type === "rack";
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
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        rotation={obj.rotation ?? 0}
        listening={!drawMode}
        draggable={canEdit && !drawMode}
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
          if (drawMode || obj.type !== "rack") return;
          clearLongPress();
          onOpen();
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          if (drawMode || obj.type !== "rack") return;
          clearLongPress();
          onOpen();
        }}
        onPointerDown={(e) => {
          if (!canEdit || drawMode || !isRack || !onEdit) return;
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
          const x = isRack
            ? snapToGridValue(e.target.x(), true)
            : Math.round(e.target.x());
          const y = isRack
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
          if (isRack) {
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
            if (isRack) {
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
  focusItemId = null,
  onClearFocus,
}: {
  rack: MapObject;
  onBack: () => void;
  onRackChange: (patch: Partial<MapObject>) => void;
  canEditMap?: boolean;
  canEditShelves?: boolean;
  focusItemId?: number | null;
  onClearFocus?: () => void;
}) {
  const { confirm } = useDialog();
  const count = rack.shelvesCount ?? 1;
  const levels = Array.from({ length: count }, (_, i) => i + 1);
  /** Верх корпуса стеллажа (не отдельная полка) */
  const topDeckIndex = count + 1;
  const shelfTitle = (n: number) =>
    n === topDeckIndex ? "Верх стеллажа" : `Полка ${n}`;
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const [activeRows, setActiveRows] = useState<Record<number, number>>({});
  const [rowCounts, setRowCounts] = useState<Record<number, number>>({});
  const [rowMenuShelf, setRowMenuShelf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{
    shelf: number;
    x: number;
    y: number;
  } | null>(null);
  const [viewScale, setViewScale] = useState(1);
  const [viewPos, setViewPos] = useState({ x: 0, y: 0 });
  const [frameWidth, setFrameWidth] = useState(
    () => rack.frameWidth ?? DEFAULT_FRAME_WIDTH,
  );
  const widthSaveTimer = useRef<number | null>(null);
  const posSaveTimer = useRef<number | null>(null);
  const frameSaveTimer = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewScaleRef = useRef(1);
  const viewPosRef = useRef({ x: 0, y: 0 });
  const frameWidthRef = useRef(frameWidth);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const pinchRef = useRef<{ lastDist: number } | null>(null);
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
        await Promise.all(onRow.map((item) => deleteShelfItem(item.id)));
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
      const created = await createShelfItem(rack.id, {
        shelfIndex,
        type,
        depthRow,
        ...(type === "stack" ? { widthRatio: 1.25 } : {}),
        ...(stackOntoId ? { stackOntoId } : { posX }),
      });
      setItems((prev) => [...prev, created]);
      setPopup(null);
      setSelectedItemId(created.id);
      setDetailItemId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить");
    }
  };

  const removeItem = async (id: number) => {
    if (!canEditShelves) return;
    try {
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
          void updateShelfItem(id, {
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
    [rack.id],
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
        // Жёсткие границы + без телепорта: недоступно → остаёмся на месте
        const bounded = clampToShelfBounds(posX, rawWidth, shelfWidth);
        const next = isFreeColumnPos(bounded, rawWidth, shelfWidth, others)
          ? bounded
          : item.posX;
        if (next === item.posX) return prev;

        if (posSaveTimer.current != null) {
          window.clearTimeout(posSaveTimer.current);
        }
        // Не перечитываем весь список во время драга — иначе позиция откатывается
        posSaveTimer.current = window.setTimeout(() => {
          void updateShelfItem(id, {
            posX: next,
            moveStackGroup: movingIds.size > 1,
          }).catch((err: Error) => setError(err.message));
        }, 180);

        return prev.map((entry) =>
          movingIds.has(entry.id) ? { ...entry, posX: next } : entry,
        );
      });
    },
    [],
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
        const posX = Math.round(
          resolvePosNoOverlap(rawPos, width, others, shelfWidth),
        );
        return { shelfIndex, depthRow, posX };
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
      const nextPos = Math.round(
        resolvePosNoOverlap(
          preferredPosX ?? current.posX ?? 0,
          width,
          others,
          shelfWidth,
        ),
      );

      setItems((prev) =>
        prev.map((entry) => {
          if (movingStackIds.has(entry.id)) {
            return { ...entry, shelfIndex, depthRow, posX: nextPos };
          }
          return entry;
        }),
      );

      try {
        await updateShelfItem(id, { shelfIndex, depthRow, posX: nextPos });
        const fresh = await listShelfItems(rack.id);
        setItems(fresh);
      } catch (err) {
        setItems(prevItems);
        setError(err instanceof Error ? err.message : "Не удалось переместить");
      }
    },
    [items, rack.id, stackGroupIds],
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
      if (moving.length + targetColumn.length > 4) {
        setError("В стеке не больше 4 сущностей");
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
        await updateShelfItem(id, { stackOntoId: targetId });
        const fresh = await listShelfItems(rack.id);
        setItems(fresh);
      } catch (err) {
        setItems(prevItems);
        setError(err instanceof Error ? err.message : "Не удалось сложить в стек");
      }
    },
    [items, rack.id],
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
      );

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
    [items, rack.id],
  );

  const persistFrameWidth = useCallback(
    (next: number) => {
      const clamped = clampFrameWidth(next);
      setFrameWidth(clamped);
      frameWidthRef.current = clamped;
      if (frameSaveTimer.current != null) {
        window.clearTimeout(frameSaveTimer.current);
      }
      frameSaveTimer.current = window.setTimeout(() => {
        onRackChange({ frameWidth: clamped });
      }, 120);
    },
    [onRackChange],
  );

  const clampViewScale = (v: number) => Math.min(8, Math.max(0.08, v));

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
    if (target.closest(".shelf-entity-wrap:not(.inactive)")) return false;
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
      if (canPanFromTarget(target)) beginViewPan(e.clientX, e.clientY);
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
        <button type="button" className="btn ghost" onClick={onBack}>
          ← На карту
        </button>
        <span className="interior-hint">
          Долгий тап по полке — добавить · двойной тап — править · перетащить на
          полку или на сущность (стек до 4)
        </span>
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
        }}
      >
        <div
          className="interior-world"
          style={{
            transform: `translate(${viewPos.x}px, ${viewPos.y}px) scale(${viewScale})`,
          }}
        >
          <div className="rack-assembly">
            <div
              className={`rack-column rack-theme-${normalizeRackTheme(rack.rackTheme)}`}
              style={{ width: frameWidth }}
            >
              <div className="rack-frame">
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
                        ? " shelf-drop-hover"
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
                        resolveDropTarget={resolveDropTarget}
                        onDragHover={setDropHover}
                        onSelect={(id) => {
                          setPopup(null);
                          setSelectedItemId(id);
                          onClearFocus?.();
                        }}
                        onOpenDetail={(id) => {
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
                          for (const item of packed) {
                            const original = shelfItems.find(
                              (entry) => entry.id === item.id,
                            );
                            if (original && original.posX !== item.posX) {
                              void updateShelfItem(item.id, {
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
                        ? " shelf-drop-hover"
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
                        resolveDropTarget={resolveDropTarget}
                        onDragHover={setDropHover}
                        onSelect={(id) => {
                          setPopup(null);
                          setSelectedItemId(id);
                          onClearFocus?.();
                        }}
                        onOpenDetail={(id) => {
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
                          for (const item of packed) {
                            const original = shelfItems.find(
                              (entry) => entry.id === item.id,
                            );
                            if (original && original.posX !== item.posX) {
                              void updateShelfItem(item.id, {
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

        <div className="zoom-controls" aria-label="Масштаб стеллажа">
          <button
            type="button"
            className="btn zoom-btn"
            onClick={(e) => {
              e.stopPropagation();
              zoomAt(viewScaleRef.current * 1.12);
            }}
            title="Приблизить"
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
  resolveDropTarget,
  onDragHover,
  onSelect,
  onOpenDetail,
  onWidthChange,
  onPosChange,
  onMoveToShelf,
  onStackOnto,
  onUnstack,
  onPack,
}: {
  items: ShelfItem[];
  backgroundItems?: ShelfItem[];
  shelfIndex: number;
  depthRow: number;
  selectedItemId: number | null;
  highlightItemId?: number | null;
  getScale: () => number;
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
  onPack: (packed: ShelfItem[]) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const packedRef = useRef(false);

  const shelfHeight = () => scrollerRef.current?.clientHeight ?? 120;
  const shelfWidth = () => scrollerRef.current?.clientWidth ?? 600;

  const syncTrack = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setTrackWidth(Math.max(scroller.clientWidth, 1));
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
              {group.map((item) => (
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
                  onUnstack={
                    stacked && !inactive
                      ? () => onUnstack(item.id)
                      : undefined
                  }
                />
              ))}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="shelf-items" ref={scrollerRef} onClick={(e) => e.stopPropagation()}>
      <div className="shelf-items-track" style={{ width: trackWidth || "100%" }}>
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
}: {
  item: ShelfItem;
  shelfIndex: number;
  depthRow: number;
  selected: boolean;
  highlighted?: boolean;
  stacked?: boolean;
  inactive?: boolean;
  getScale: () => number;
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
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLButtonElement>(null);
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
    colW: number;
    others: { posX: number; width: number }[];
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!highlighted || !wrapRef.current) return;
    wrapRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [highlighted, item.id]);

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
  getScaleRef.current = getScale;
  resolveDropTargetRef.current = resolveDropTarget;
  onDragHoverRef.current = onDragHover;
  onSelectRef.current = onSelect;
  onOpenDetailRef.current = onOpenDetail;
  onWidthChangeRef.current = onWidthChange;
  onPosChangeRef.current = onPosChange;
  onMoveToShelfRef.current = onMoveToShelf;
  onStackOntoRef.current = onStackOnto;

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
        if (!wasDrag && e.pointerType === "touch") {
          tryDoubleTap(e.clientX, e.clientY);
        }
        return;
      }

      if (!wasDrag) {
        clearLiveDragStyle(state.column, state.startPos);
        if (e.pointerType === "touch") {
          tryDoubleTap(e.clientX, e.clientY);
        }
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
          onMoveToShelfRef.current(
            target.shelfIndex,
            target.depthRow,
            target.posX,
          );
        } else {
          const finalPos = isFreeColumnPos(
            state.livePos,
            state.colW,
            state.shelfW,
            state.others,
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
    e.stopPropagation();
    onSelectRef.current();
    const column = columnEl();
    const startPos = item.posX ?? 0;
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
        title={item.title || entityTitle(item.type)}
        style={
          stacked
            ? undefined
            : { aspectRatio: `${item.widthRatio} / 1` }
        }
        onPointerDown={startDrag}
        onDoubleClick={(e) => {
          if (inactive) return;
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
        }}
      >
        <span className="shelf-entity-face" aria-hidden />
        {item.title ? (
          <ShelfEntityLabel text={item.title} />
        ) : item.contents && item.contents.length > 0 ? (
          <ShelfEntityLabel
            text={
              item.contents.length === 1
                ? item.contents[0]!.nameSnapshot
                : `${item.contents.length} поз.`
            }
          />
        ) : null}
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
          {onUnstack && (
            <button
              type="button"
              className="entity-unstack"
              title="Отделить на полку"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onUnstack();
              }}
            >
              Отделить
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ShelfEntityLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(16);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const fit = () => {
      const maxW = Math.max(24, parent.clientWidth - 10);
      const maxH = Math.max(24, parent.clientHeight * 0.78);
      let lo = 8;
      let hi = Math.min(22, Math.max(12, maxW / 3.2));
      let best = lo;

      el.style.width = `${maxW}px`;
      el.style.maxHeight = `${maxH}px`;

      while (lo <= hi) {
        const mid = Math.round(((lo + hi) / 2) * 10) / 10;
        el.style.fontSize = `${mid}px`;
        const fits =
          el.scrollWidth <= maxW + 1 && el.scrollHeight <= maxH + 1;
        if (fits) {
          best = mid;
          lo = mid + 0.5;
        } else {
          hi = mid - 0.5;
        }
      }

      el.style.fontSize = `${best}px`;
      setFontSize(best);
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      className="shelf-entity-label"
      style={{ fontSize: `${fontSize}px` }}
    >
      {text}
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
  }, [item.id, item.title, item.quantity, item.details, item.contents]);

  const save = () => {
    onSave(
      {
        title: title.trim(),
        quantity: quantity.trim(),
        details: details.trim(),
      },
      contents,
    );
    setContentsDirty(false);
  };

  const headingFromContents =
    contents.length === 1
      ? `${contents[0]!.typeSnapshot ? `${contents[0]!.typeSnapshot} ` : ""}${contents[0]!.nameSnapshot}`
      : contents.length > 1
        ? `${contents.length} позиции`
        : "";

  return (
    <div
      className="item-detail-backdrop"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`item-detail${highlight ? " item-detail-highlight" : ""}`}
        role="dialog"
        aria-label={`Содержимое: ${entityTitle(item.type)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="item-detail-head">
          <div className="item-detail-type">
            <EntityGlyph type={item.type} />
            <div>
              <p className="item-detail-kicker">{entityTitle(item.type)}</p>
              <h2 className="item-detail-heading">
                {title.trim() || headingFromContents || "Без названия"}
              </h2>
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <CatalogContentsPicker
          initial={item.contents ?? []}
          canEdit={canEdit}
          onChange={(next) => {
            setContents(next);
            setContentsDirty(true);
          }}
        />

        <label className="field item-detail-field">
          <span>Заметка / подпись</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Свободный текст (опционально)"
            disabled={!canEdit}
            autoFocus
          />
        </label>

        <label className="field item-detail-field">
          <span>Количество (общее)</span>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Например: 24 шт"
            disabled={!canEdit}
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
          {canEdit && onAddOnTop && stackCount < 4 && (
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
          {stackCount >= 4 && (
            <span className="item-detail-meta">Стек полный (4/4)</span>
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
  const [panning, setPanning] = useState(false);
  const scaleRef = useRef(1);
  const stagePosRef = useRef({ x: 0, y: 0 });
  const initialFitDoneRef = useRef(false);
  const lastFitKeyRef = useRef("");

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    stagePosRef.current = stagePos;
  }, [stagePos]);

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
        setScale(1);
        setStagePos({ x: 0, y: 0 });
        scaleRef.current = 1;
        stagePosRef.current = { x: 0, y: 0 };
        return;
      }
      setScale(next.scale);
      setStagePos({ x: next.x, y: next.y });
      scaleRef.current = next.scale;
      stagePosRef.current = { x: next.x, y: next.y };
    },
    [objects, size.height, size.width],
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
    }
  }, [appMode, stopWallDrawing]);

  const zoomAt = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const stage = stageRef.current;
      const clamped = clampScale(nextScale);
      const point =
        anchor ??
        (stage
          ? { x: stage.width() / 2, y: stage.height() / 2 }
          : { x: size.width / 2, y: size.height / 2 });

      const world = {
        x: (point.x - stagePos.x) / scale,
        y: (point.y - stagePos.y) / scale,
      };

      setScale(clamped);
      setStagePos({
        x: point.x - world.x * clamped,
        y: point.y - world.y * clamped,
      });
    },
    [scale, stagePos.x, stagePos.y, size.height, size.width],
  );

  const resetView = () => {
    setScale(1);
    setStagePos({ x: 0, y: 0 });
    scaleRef.current = 1;
    stagePosRef.current = { x: 0, y: 0 };
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

  const opened = objects.find((s) => s.id === openedId && s.type === "rack") ?? null;

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
          x: Math.round(x),
          y: Math.round(y),
          width:
            activeTool === "rack" ? snapRackSize(Math.round(width)) : Math.round(width),
          height:
            activeTool === "rack"
              ? snapRackSize(Math.round(height))
              : Math.round(height),
          shelvesCount: activeTool === "rack" ? 5 : null,
          frameWidth: activeTool === "rack" ? DEFAULT_FRAME_WIDTH : null,
          rackTheme: activeTool === "rack" ? "blue" : null,
          rotation: 0,
        });
        setObjects((prev) => [...prev, created]);
        if (activeTool !== "wall" && activeTool !== "door") {
          setSelectedId(created.id);
        }
        if (activeTool === "rack") {
          setNextRackLabel(nextLabel(created.label));
        }

        if (
          (activeTool === "wall" || activeTool === "door") &&
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
      rackOpts?: {
        label: string;
        shelvesCount: number;
        width: number;
        length: number;
        rackTheme?: RackTheme;
      },
    ) => {
      setTool(type);
      const rect =
        type === "rack" && rackOpts
          ? {
              x: world.x - rackOpts.width / 2,
              y: world.y - rackOpts.length / 2,
              width: rackOpts.width,
              height: rackOpts.length,
            }
          : defaultDraftAt(type, snapToGrid(world, showGrid));
      let width = Math.abs(rect.width);
      let height = Math.abs(rect.height);
      let x = rect.width < 0 ? rect.x + rect.width : rect.x;
      let y = rect.height < 0 ? rect.y + rect.height : rect.y;
      const normalized = normalizeDrawnSize(type, width, height);
      width = normalized.width;
      height = normalized.height;
      const rackLabel =
        type === "rack"
          ? rackOpts?.label.trim() || nextRackLabel.trim() || "Стеллаж"
          : defaultLabel(type);
      const rackShelves =
        type === "rack" ? (rackOpts?.shelvesCount ?? 5) : null;
      try {
        const created = await createObject({
          type,
          label: rackLabel,
          x: Math.round(x),
          y: Math.round(y),
          width:
            type === "rack"
              ? snapRackSize(Math.round(width))
              : Math.round(width),
          height:
            type === "rack"
              ? snapRackSize(Math.round(height))
              : Math.round(height),
          shelvesCount: rackShelves,
          frameWidth: type === "rack" ? DEFAULT_FRAME_WIDTH : null,
          rackTheme:
            type === "rack"
              ? normalizeRackTheme(rackOpts?.rackTheme)
              : null,
          rotation: 0,
        });
        setObjects((prev) => [...prev, created]);
        setSelectedId(created.id);
        if (type === "rack") {
          setNextRackLabel(nextLabel(rackLabel));
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
    const patch = {
      label: rackEdit.label.trim() || "Стеллаж",
      shelvesCount,
      width,
      height: length,
      rackTheme: rackEdit.rackTheme,
    };
    setRackEdit(null);
    void persistPatch(id, patch);
  }, [persistPatch, rackEdit]);

  const startWallDraw = useCallback((type: "wall" | "door") => {
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
      if (type === "wall" || type === "door") {
        startWallDraw(type);
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
    [nextRackLabel, placeAtPoint, spawnMenu, startWallDraw],
  );

  const onEmptyTarget = (target: Konva.Node, stage: Konva.Stage) =>
    target === stage ||
    target.name() === "floor" ||
    target.getParent()?.name() === "floor";

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
      if (tool !== "wall" && tool !== "door") return;
      if (wallPlaceLockRef.current) return;
      const pos = snapToGrid(raw, showGrid);
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
    [finishDraft, showGrid, tool],
  );

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const isMiddle = e.evt.button === 1;
    const isLeft = e.evt.button === 0;
    const empty = onEmptyTarget(e.target, stage);

    if (isMiddle) {
      e.evt.preventDefault();
      setSpawnMenu(null);
      pendingPanRef.current = null;
      panRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        sx: stagePos.x,
        sy: stagePos.y,
      };
      setPanning(true);
      return;
    }

    if (isLeft && empty && !drawMode) {
      e.evt.preventDefault();
      setSpawnMenu(null);
      pendingPanRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        sx: stagePos.x,
        sy: stagePos.y,
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
        setPanning(true);
      } else {
        return;
      }
    }

    if (panRef.current) {
      const dx = e.evt.clientX - panRef.current.x;
      const dy = e.evt.clientY - panRef.current.y;
      setStagePos({
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
    const pos = snapToGrid(raw, showGrid);
    lastWorldRef.current = pos;
    setCursorPos(pos);
  };

  const onMouseUp = (e?: Konva.KonvaEventObject<MouseEvent>) => {
    pendingPanRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
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
      setPanning(false);
      setSpawnMenu(null);
      pinchRef.current = {
        lastDist: getTouchDistance(touches),
        lastCenter: getTouchCenter(touches, stage),
      };
      return;
    }

    if (touches.length === 1) {
      const empty = onEmptyTarget(e.target, stage);
      if (!drawMode && empty) {
        e.evt.preventDefault();
        setSpawnMenu(null);
        pendingPanRef.current = {
          x: touches[0].clientX,
          y: touches[0].clientY,
          sx: stagePos.x,
          sy: stagePos.y,
        };
        return;
      }
      if (drawMode && empty) {
        const raw = getWorldPointer(stage);
        if (raw) {
          const pos = snapToGrid(raw, showGrid);
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
        scaleRef.current = nextScale;
        stagePosRef.current = nextPos;
        setScale(nextScale);
        setStagePos(nextPos);
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
        setPanning(true);
      } else {
        return;
      }
    }

    if (panRef.current && touches.length === 1) {
      e.evt.preventDefault();
      const dx = touches[0].clientX - panRef.current.x;
      const dy = touches[0].clientY - panRef.current.y;
      setStagePos({
        x: panRef.current.sx + dx,
        y: panRef.current.sy + dy,
      });
      return;
    }

    if (!drawMode || touches.length !== 1) return;
    const raw = getWorldPointer(stage);
    if (!raw) return;
    const pos = snapToGrid(raw, showGrid);
    lastWorldRef.current = pos;
    setCursorPos(pos);
  };

  const onTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) {
      pinchRef.current = null;
    }
    if (e.evt.touches.length !== 0) return;

    pendingPanRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
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
    const next = direction > 0 ? scale * SCALE_STEP : scale / SCALE_STEP;
    zoomAt(next, pointer);
  };

  const removeSelected = async () => {
    if (!selectedId) return;
    try {
      await deleteObject(selectedId);
      setObjects((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      if (openedId === selectedId) setOpenedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  };

  const wallDrawing = tool === "wall" || tool === "door";
  const previewSegment =
    lineStart && cursorPos && wallDrawing
      ? { a: lineStart, b: orthogonalWallEnd(lineStart, cursorPos) }
      : null;
  const previewDoorDraft =
    previewSegment && tool === "door"
      ? segmentToDraft("door", previewSegment.a, previewSegment.b)
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
    return (
      <div className={`app mode-${appMode}`}>
        <RackInterior
          rack={opened}
          canEditMap={isAdmin}
          canEditShelves={canEditShelves}
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
                  Сборка
                </button>
                <button
                  type="button"
                  className={appMode === "use" ? "btn mode active" : "btn mode"}
                  onClick={() => setAppMode("use")}
                >
                  Обход
                </button>
              </div>
            )}
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

              {appMode === "build" && (
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
          className={`canvas-wrap ${drawMode ? "drawing" : ""} ${panning ? "panning" : ""}`}
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
              onMouseDown={onMouseDown}
              onMousemove={onMouseMove}
              onMouseup={onMouseUp}
              onMouseLeave={() => {
                pendingPanRef.current = null;
                if (panRef.current) {
                  panRef.current = null;
                  setPanning(false);
                }
              }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
              onWheel={onWheel}
              onContextMenu={(e) => e.evt.preventDefault()}
              onDblClick={(e) => {
                if (panning || wallDrawing || !canEdit) return;
                const stage = e.target.getStage();
                if (!stage || !onEmptyTarget(e.target, stage)) return;
                openSpawnMenu(stage, e.evt.clientX, e.evt.clientY);
              }}
              onDblTap={(e) => {
                if (panning || wallDrawing || !canEdit) return;
                const stage = e.target.getStage();
                if (!stage || !onEmptyTarget(e.target, stage)) return;
                const touch = e.evt.changedTouches?.[0];
                if (!touch) return;
                openSpawnMenu(stage, touch.clientX, touch.clientY);
              }}
              onClick={(e) => {
                if (panning || drawMode) return;
                if (
                  e.target === e.target.getStage() ||
                  e.target.name() === "floor"
                ) {
                  setSelectedId(null);
                  setSpawnMenu(null);
                }
              }}
              onTap={(e) => {
                if (panning || drawMode) return;
                if (
                  e.target === e.target.getStage() ||
                  e.target.name() === "floor"
                ) {
                  setSelectedId(null);
                  setSpawnMenu(null);
                }
              }}
            >
              <Layer>
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
                  .sort(
                    (a, b) =>
                      a.y + a.height - (b.y + b.height) || a.x - b.x,
                  )
                  .map((obj) => (
                  <MapObjectShape
                    key={obj.id}
                    obj={obj}
                    selected={obj.id === selectedId}
                    drawMode={drawMode}
                    canEdit={canEdit}
                    stageScale={scale}
                    onSelect={() => setSelectedId(obj.id)}
                    onOpen={() => {
                      setFocusItemId(null);
                      setOpenedId(obj.id);
                    }}
                    onEdit={
                      canEdit && obj.type === "rack"
                        ? () =>
                            setRackEdit({
                              id: obj.id,
                              label: obj.label,
                              shelvesCount: obj.shelvesCount ?? 5,
                              width: obj.width,
                              length: obj.height,
                              rackTheme: normalizeRackTheme(obj.rackTheme),
                            })
                        : undefined
                    }
                    onChange={(patch) => void persistPatch(obj.id, patch)}
                  />
                ))}

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
                    lineCap="round"
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

                <div className="item-detail-actions">
                  <button type="submit" className="btn primary">
                    Сохранить
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
