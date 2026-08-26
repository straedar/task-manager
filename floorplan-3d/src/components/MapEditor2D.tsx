import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Transformer, Line, Group, Circle, Ellipse } from "react-konva";
import type Konva from "konva";
import type { MapObject, MapSettings, ObjectType, RackTheme } from "../api";
import {
  GRID,
  LABELED_TYPES,
  OBJECT_FILL,
  TOOL_LABELS,
  clampScale,
  defaultObjectAt,
  fitStageToObjects,
  deskPose,
  flipRackFront,
  minSize,
  rackPose,
  rotateMapObject90,
  snapToGrid,
  snapsToMapGrid,
  wallRectFromPoints,
  wallSegmentFromPoints,
} from "../world";
import "../rack/rack-interior.css";

type Props = {
  objects: MapObject[];
  canEdit: boolean;
  selectedIds: number[];
  settings: MapSettings;
  onSelect: (ids: number[]) => void;
  onCreate: (draft: Omit<MapObject, "id">) => void;
  onPatch: (id: number, patch: Partial<MapObject>) => void;
  onDelete: (ids: number[]) => void;
  onCopyRacks: (ids: number[]) => void;
  onFloorUpload: (file: File) => void;
  onFloorClear: () => void;
  onOpenRack: (id: number) => void;
};

type ContextMenuState = {
  kind: "add";
  clientX: number;
  clientY: number;
  world: { x: number; y: number };
};

type RackEditState = {
  id: number;
  label: string;
  shelvesCount: number;
  initialShelvesCount: number;
  width: number;
  length: number;
  rackTheme: RackTheme;
};

type MarqueeState = { x: number; y: number; width: number; height: number };

const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_PX = 12;
const MARQUEE_MIN_PX = 4;
const CLICK_MOVE_PX = 6;
const RACK_SIZE_MIN = GRID;
const RACK_SIZE_MAX = GRID * 200;

function normalizeRackTheme(value: unknown): RackTheme {
  return value === "black" ? "black" : "blue";
}

function snapRackSize(value: number) {
  const snapped = Math.round(value / GRID) * GRID;
  return Math.min(RACK_SIZE_MAX, Math.max(RACK_SIZE_MIN, snapped || RACK_SIZE_MIN));
}

/** Ресайз по сетке: неподвижный край остаётся на месте. */
function snapGridBox(
  start: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number },
  anchor?: string | null,
  minSide = RACK_SIZE_MIN,
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
    right = snapToGrid(startRight);
    left = right - snapRackSize(right - next.x);
  } else if (doRight && !doLeft) {
    left = snapToGrid(start.x);
    right = left + snapRackSize(nextRight - left);
  } else if (doLeft && doRight) {
    left = snapToGrid(next.x);
    right = left + snapRackSize(nextRight - next.x);
  } else {
    left = snapToGrid(start.x);
    right = left + snapRackSize(start.width);
  }

  if (doTop && !doBottom) {
    bottom = snapToGrid(startBottom);
    top = bottom - snapRackSize(bottom - next.y);
  } else if (doBottom && !doTop) {
    top = snapToGrid(start.y);
    bottom = top + snapRackSize(nextBottom - top);
  } else if (doTop && doBottom) {
    top = snapToGrid(next.y);
    bottom = top + snapRackSize(nextBottom - next.y);
  } else {
    top = snapToGrid(start.y);
    bottom = top + snapRackSize(start.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(minSide, right - left),
    height: Math.max(minSide, bottom - top),
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

function aabbIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function ObjectVisual({
  obj,
  selected,
}: {
  obj: MapObject;
  selected: boolean;
}) {
  const fill = OBJECT_FILL[obj.type];
  const stroke = selected ? "#f08a2e" : "rgba(255,255,255,0.25)";
  const strokeWidth = selected ? 2 : 1;

  if (obj.type === "zone") {
    return (
      <>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={selected ? "rgba(250, 204, 21, 0.42)" : fill}
          stroke={selected ? "#ca8a04" : "#eab308"}
          strokeWidth={selected ? 2 : 1.5}
          dash={[10, 6]}
        />
        {obj.label ? (
          <Text
            text={obj.label}
            width={obj.width}
            height={obj.height}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(10, Math.min(14, obj.width / 6))}
            fill="#3d2a12"
            fontStyle="bold"
            listening={false}
          />
        ) : null}
      </>
    );
  }

  if (obj.type === "computer_desk") {
    const pad = Math.max(3, Math.min(obj.width, obj.height) * 0.05);
    return (
      <>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={selected ? "#dcc7a0" : "#d2b88a"}
          stroke={selected ? "#f08a2e" : "#9a8050"}
          strokeWidth={selected ? 2 : 1.5}
          cornerRadius={3}
        />
        <Rect
          x={pad}
          y={pad}
          width={obj.width - pad * 2}
          height={obj.height - pad * 2}
          fill="rgba(255,255,255,0.14)"
          cornerRadius={2}
          listening={false}
        />
        {obj.label ? (
          <Text
            text={obj.label}
            width={obj.width}
            height={obj.height}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(
              11,
              Math.min(16, Math.min(obj.width, obj.height) / 5),
            )}
            fill="#3d2a12"
            fontStyle="bold"
            listening={false}
          />
        ) : null}
      </>
    );
  }

  if (obj.type === "table") {
    const pad = Math.max(3, Math.min(obj.width, obj.height) * 0.05);
    const divider = Math.max(6, pad * 1.6);
    const side = deskPose(obj).partitionOn;
    const partitionFill = selected ? "#6b4e2e" : "#5a3f24";
    const partition =
      side === "n" ? (
        <Rect
          x={0}
          y={0}
          width={obj.width}
          height={divider}
          fill={partitionFill}
          listening={false}
        />
      ) : side === "s" ? (
        <Rect
          x={0}
          y={obj.height - divider}
          width={obj.width}
          height={divider}
          fill={partitionFill}
          listening={false}
        />
      ) : side === "w" ? (
        <Rect
          x={0}
          y={0}
          width={divider}
          height={obj.height}
          fill={partitionFill}
          listening={false}
        />
      ) : (
        <Rect
          x={obj.width - divider}
          y={0}
          width={divider}
          height={obj.height}
          fill={partitionFill}
          listening={false}
        />
      );
    return (
      <>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={selected ? "#dcc7a0" : "#d2b88a"}
          stroke={selected ? "#f08a2e" : "#9a8050"}
          strokeWidth={selected ? 2 : 1.5}
          cornerRadius={3}
        />
        <Rect
          x={pad}
          y={pad}
          width={obj.width - pad * 2}
          height={obj.height - pad * 2}
          fill="rgba(255,255,255,0.14)"
          cornerRadius={2}
          listening={false}
        />
        {partition}
        {obj.label ? (
          <Text
            text={obj.label}
            width={obj.width}
            height={obj.height}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(11, Math.min(16, Math.min(obj.width, obj.height) / 5))}
            fill="#3d2a12"
            fontStyle="bold"
            listening={false}
          />
        ) : null}
      </>
    );
  }

  if (obj.type === "chair") {
    const w = obj.width;
    const h = obj.height;
    const rot = obj.rotation ?? 0;
    return (
      <Group x={w / 2} y={h / 2} offsetX={w / 2} offsetY={h / 2} rotation={rot}>
        <Ellipse
          x={w / 2}
          y={h * 0.58}
          radiusX={w * 0.34}
          radiusY={h * 0.28}
          fill={selected ? "#3a3f48" : "#2a2e34"}
          stroke={selected ? "#f08a2e" : "#c0c6ce"}
          strokeWidth={selected ? 2 : 1.25}
        />
        <Rect
          x={w * 0.22}
          y={h * 0.12}
          width={w * 0.56}
          height={h * 0.38}
          fill={selected ? "#454b56" : "#1a1d22"}
          cornerRadius={w * 0.08}
          stroke={selected ? "#f08a2e" : "#8a929c"}
          strokeWidth={1}
        />
        <Circle
          x={w / 2}
          y={h * 0.72}
          radius={Math.min(w, h) * 0.07}
          fill="#b8c0c8"
          listening={false}
        />
        {[0, 72, 144, 216, 288].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const len = Math.min(w, h) * 0.32;
          return (
            <Line
              key={deg}
              points={[
                w / 2,
                h * 0.72,
                w / 2 + Math.cos(rad) * len,
                h * 0.72 + Math.sin(rad) * len,
              ]}
              stroke="#b8c0c8"
              strokeWidth={2}
              lineCap="round"
              listening={false}
            />
          );
        })}
      </Group>
    );
  }

  if (obj.type === "rack") {
    const pose = rackPose(obj);
    const backSide =
      pose.front === "s"
        ? "n"
        : pose.front === "n"
          ? "s"
          : pose.front === "e"
            ? "w"
            : "e";
    const divider = Math.max(5, Math.min(obj.width, obj.height) * 0.12);
    const backFill = selected ? "#1a3a6e" : obj.rackTheme === "black" ? "#1a1d22" : "#1e3a6e";
    const backWall =
      backSide === "n" ? (
        <Rect
          x={0}
          y={0}
          width={obj.width}
          height={divider}
          fill={backFill}
          listening={false}
        />
      ) : backSide === "s" ? (
        <Rect
          x={0}
          y={obj.height - divider}
          width={obj.width}
          height={divider}
          fill={backFill}
          listening={false}
        />
      ) : backSide === "w" ? (
        <Rect
          x={0}
          y={0}
          width={divider}
          height={obj.height}
          fill={backFill}
          listening={false}
        />
      ) : (
        <Rect
          x={obj.width - divider}
          y={0}
          width={divider}
          height={obj.height}
          fill={backFill}
          listening={false}
        />
      );
    return (
      <>
        <Rect
          width={obj.width}
          height={obj.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          cornerRadius={4}
        />
        {backWall}
        {obj.label ? (
          <Text
            text={obj.label}
            width={obj.width}
            height={obj.height}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(10, Math.min(14, obj.width / 6))}
            fill="#f5f5f5"
            fontStyle="bold"
            listening={false}
          />
        ) : null}
      </>
    );
  }

  const showLabel = LABELED_TYPES.has(obj.type) && Boolean(obj.label);

  return (
    <>
      <Rect
        width={obj.width}
        height={obj.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={obj.type === "pallet" ? 4 : 0}
      />
      {showLabel ? (
        <Text
          text={obj.label}
          width={obj.width}
          height={obj.height}
          align="center"
          verticalAlign="middle"
          fontSize={Math.max(10, Math.min(14, obj.width / 6))}
          fill={obj.type === "pallet" ? "#3d2a12" : "#f5f5f5"}
          fontStyle="bold"
          listening={false}
        />
      ) : null}
    </>
  );
}

function MapObjectShape({
  obj,
  selected,
  soloSelected,
  canEdit,
  locked,
  onSelect,
  onChange,
  onGroupDragEnd,
  onOpen,
  onRackMenu,
}: {
  obj: MapObject;
  selected: boolean;
  soloSelected: boolean;
  canEdit: boolean;
  locked: boolean;
  onSelect: (additive: boolean) => void;
  onChange: (patch: Partial<MapObject>) => void;
  onGroupDragEnd: (dx: number, dy: number) => void;
  onOpen?: () => void;
  onRackMenu?: () => void;
}) {
  const shapeRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
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
  const limits = minSize(obj.type);
  const canRotateHandle = obj.type === "door";
  const canResize =
    obj.type !== "wall" && obj.type !== "window" && obj.type !== "chair";
  const gridSnap = snapsToMapGrid(obj.type);
  const showTransform = soloSelected && !locked && canEdit && canResize;

  useEffect(() => {
    if (showTransform && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [showTransform, canRotateHandle]);

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  return (
    <>
      <Group
        ref={shapeRef}
        name="map-object"
        x={obj.x}
        y={obj.y}
        width={obj.width}
        height={obj.height}
        rotation={canRotateHandle ? obj.rotation ?? 0 : 0}
        listening={!locked}
        draggable={canEdit && !locked && selected}
        onClick={(e) => {
          e.cancelBubble = true;
          if (!locked) onSelect(e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          if (!locked) onSelect(false);
        }}
        onDblClick={(e) => {
          e.cancelBubble = true;
          if (!locked) onOpen?.();
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          if (!locked) onOpen?.();
        }}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
          if (canEdit && !locked && obj.type === "rack" && onRackMenu) {
            onRackMenu();
          }
        }}
        onTouchStart={(e) => {
          if (!canEdit || locked || obj.type !== "rack" || !onRackMenu) return;
          const t = e.evt.touches[0];
          if (!t) return;
          clearLongPress();
          longPressRef.current = {
            x: t.clientX,
            y: t.clientY,
            timer: window.setTimeout(() => {
              longPressRef.current = null;
              onRackMenu();
            }, LONG_PRESS_MS),
          };
        }}
        onTouchMove={(e) => {
          const t = e.evt.touches[0];
          if (!t || !longPressRef.current) return;
          if (
            Math.hypot(t.clientX - longPressRef.current.x, t.clientY - longPressRef.current.y) >
            LONG_PRESS_MOVE_PX
          ) {
            clearLongPress();
          }
        }}
        onTouchEnd={() => clearLongPress()}
        onTouchCancel={() => clearLongPress()}
        onDragStart={() => {
          clearLongPress();
          dragStart.current = { x: obj.x, y: obj.y };
        }}
        onDragEnd={(e) => {
          if (!canEdit) return;
          const x = gridSnap ? snapToGrid(e.target.x()) : Math.round(e.target.x());
          const y = gridSnap ? snapToGrid(e.target.y()) : Math.round(e.target.y());
          e.target.position({ x, y });
          const start = dragStart.current;
          dragStart.current = null;
          if (start) {
            onGroupDragEnd(x - start.x, y - start.y);
          } else {
            onChange({ x, y });
          }
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
          // Берём исходный размер объекта — у Group width()/height() часто 0.
          const baseW = Math.max(1, obj.width);
          const baseH = Math.max(1, obj.height);
          let nextW = Math.max(
            limits.minSide,
            Math.round(Math.abs(baseW * scaleX)),
          );
          let nextH = Math.max(
            limits.minSide,
            Math.round(Math.abs(baseH * scaleY)),
          );
          let nextX = node.x();
          let nextY = node.y();
          if (scaleX < 0) nextX += baseW * scaleX;
          if (scaleY < 0) nextY += baseH * scaleY;
          if (gridSnap) {
            const start = transformStartRef.current ?? {
              x: obj.x,
              y: obj.y,
              width: obj.width,
              height: obj.height,
            };
            const snapped = snapGridBox(
              start,
              { x: nextX, y: nextY, width: nextW, height: nextH },
              transformAnchorRef.current,
              limits.minSide,
            );
            nextX = snapped.x;
            nextY = snapped.y;
            nextW = snapped.width;
            nextH = snapped.height;
          } else {
            nextX = Math.round(nextX);
            nextY = Math.round(nextY);
          }
          // Для стола — длинная сторона не короче minLong (как на сервере).
          if (obj.type === "table" || obj.type === "computer_desk") {
            const short = Math.min(nextW, nextH);
            const long = Math.max(nextW, nextH);
            if (long < limits.minLong) {
              if (nextW >= nextH) nextW = limits.minLong;
              else nextH = limits.minLong;
            }
            if (short < limits.minSide) {
              if (nextW <= nextH) nextW = limits.minSide;
              else nextH = limits.minSide;
            }
          }
          transformStartRef.current = null;
          transformAnchorRef.current = null;
          node.width(nextW);
          node.height(nextH);
          node.position({ x: nextX, y: nextY });
          const rotation = canRotateHandle
            ? Math.round(((((node.rotation() % 360) + 360) % 360) / 90)) * 90
            : 0;
          node.rotation(rotation);
          onChange({
            x: nextX,
            y: nextY,
            width: nextW,
            height: nextH,
            ...(canRotateHandle ? { rotation } : {}),
          });
        }}
      >
        {/* Невидимая плоскость задаёт размер для Transformer */}
        <Rect
          width={obj.width}
          height={obj.height}
          fill="rgba(0,0,0,0)"
          listening
        />
        <ObjectVisual obj={obj} selected={selected} />
      </Group>
      {showTransform && (
        <Transformer
          ref={trRef}
          rotateEnabled={canRotateHandle}
          rotationSnaps={[0, 90, 180, 270]}
          flipEnabled={false}
          borderStroke="#f08a2e"
          anchorStroke="#f08a2e"
          anchorFill="#1a1c20"
          anchorSize={10}
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
            const stage = shapeRef.current?.getStage();
            if (!stage) return oldBox;
            if (newBox.width < 0 || newBox.height < 0) return oldBox;
            const sx = Math.abs(stage.scaleX() || 1);
            const sy = Math.abs(stage.scaleY() || 1);

            if (gridSnap) {
              const start =
                transformStartRef.current ?? absBoxToWorld(oldBox, stage);
              const next = absBoxToWorld(newBox, stage);
              if (
                next.width < limits.minSide * 0.35 ||
                next.height < limits.minSide * 0.35
              ) {
                return oldBox;
              }
              const anchor =
                trRef.current?.getActiveAnchor() ??
                transformAnchorRef.current;
              if (anchor) transformAnchorRef.current = anchor;
              const snapped = snapGridBox(
                start,
                next,
                anchor,
                limits.minSide,
              );
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
              Math.min(newBox.width / sx, newBox.height / sy) <
                limits.minSide ||
              Math.max(newBox.width / sx, newBox.height / sy) < limits.minLong
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

function buildGridLines(
  objects: MapObject[],
  viewW: number,
  viewH: number,
  scale: number,
  stagePos: { x: number; y: number },
) {
  const worldLeft = -stagePos.x / scale;
  const worldTop = -stagePos.y / scale;
  const worldRight = worldLeft + viewW / scale;
  const worldBottom = worldTop + viewH / scale;
  const pad = GRID * 20;
  let minX = worldLeft - pad;
  let minY = worldTop - pad;
  let maxX = worldRight + pad;
  let maxY = worldBottom + pad;
  for (const obj of objects) {
    minX = Math.min(minX, obj.x - GRID * 4);
    minY = Math.min(minY, obj.y - GRID * 4);
    maxX = Math.max(maxX, obj.x + obj.width + GRID * 4);
    maxY = Math.max(maxY, obj.y + obj.height + GRID * 4);
  }
  minX = Math.floor(minX / GRID) * GRID;
  minY = Math.floor(minY / GRID) * GRID;
  maxX = Math.ceil(maxX / GRID) * GRID;
  maxY = Math.ceil(maxY / GRID) * GRID;

  const lines: number[][] = [];
  for (let x = minX; x <= maxX; x += GRID) {
    lines.push([x, minY, x, maxY]);
  }
  for (let y = minY; y <= maxY; y += GRID) {
    lines.push([minX, y, maxX, y]);
  }
  return lines;
}

export function MapEditor2D({
  objects,
  canEdit,
  selectedIds,
  settings,
  onSelect,
  onCreate,
  onPatch,
  onDelete,
  onCopyRacks,
  onFloorUpload,
  onFloorClear,
  onOpenRack,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const floorInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [rackEdit, setRackEdit] = useState<RackEditState | null>(null);
  const [drawTool, setDrawTool] = useState<"wall" | "window" | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [wallPreview, setWallPreview] = useState<MarqueeState | null>(null);
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(
    null,
  );
  const pinchRef = useRef<{
    lastDist: number;
    lastCenter: { x: number; y: number };
  } | null>(null);
  const lineStartRef = useRef<{ x: number; y: number } | null>(null);
  const wallPlaceLockRef = useRef(false);
  const marqueeRef = useRef<{ start: { x: number; y: number } } | null>(null);
  /** После короткого клика по пустому — следующий зажим начинает рамку. */
  const marqueeArmedRef = useRef(false);
  const [marqueeArmed, setMarqueeArmed] = useState(false);
  const emptyClickRef = useRef<{
    x: number;
    y: number;
    world: { x: number; y: number };
  } | null>(null);
  const longPressRef = useRef<{
    timer: number;
    x: number;
    y: number;
    world: { x: number; y: number };
  } | null>(null);
  /** Пока пользователь не двигал вид — подгоняем центр при появлении/смене размера холста. */
  const userAdjustedView = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const didInitialFit = useRef(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const soloId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const soloObj = soloId != null ? objects.find((o) => o.id === soloId) : null;
  const selectedRackIds = useMemo(
    () =>
      selectedIds.filter((id) =>
        objects.some((o) => o.id === id && o.type === "rack"),
      ),
    [selectedIds, objects],
  );
  const spacePanRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const applySize = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    const ro = new ResizeObserver(() => applySize());
    ro.observe(el);
    applySize();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (userAdjustedView.current) return;
    if (size.width < 40 || size.height < 40) return;
    if (objects.length === 0) return;
    // После первой подгонки ещё коротко пересчитываем — холст дорастает после тулбара.
    if (didInitialFit.current && Date.now() - mountedAtRef.current > 900) {
      return;
    }
    const next = fitStageToObjects(objects, size.width, size.height);
    if (next) {
      setScale(next.scale);
      setStagePos({ x: next.x, y: next.y });
      didInitialFit.current = true;
    }
  }, [objects, size.width, size.height]);

  useEffect(() => {
    if (objects.length === 0) return;
    let cancelled = false;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled || userAdjustedView.current) return;
        const el = wrapRef.current;
        if (!el) return;
        const width = el.clientWidth;
        const height = el.clientHeight;
        if (width < 40 || height < 40) return;
        const next = fitStageToObjects(objects, width, height);
        if (!next) return;
        setSize((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height },
        );
        setScale(next.scale);
        setStagePos({ x: next.x, y: next.y });
        didInitialFit.current = true;
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
    // Только при маунте редактора (переключение с 3D).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLineStartBoth = (next: { x: number; y: number } | null) => {
    lineStartRef.current = next;
    setLineStart(next);
  };

  const stopWallDrawing = () => {
    setDrawTool(null);
    lineStartRef.current = null;
    setLineStart(null);
    setWallPreview(null);
    wallPlaceLockRef.current = false;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") spacePanRef.current = true;
      if (e.key === "Escape") {
        if (rackEdit) {
          setRackEdit(null);
          return;
        }
        setContextMenu(null);
        stopWallDrawing();
        setSelectMode(false);
        marqueeRef.current = null;
        setMarquee(null);
        marqueeArmedRef.current = false;
        setMarqueeArmed(false);
        emptyClickRef.current = null;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        canEdit &&
        selectedIds.length > 0 &&
        !rackEdit &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        onDelete(selectedIds);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spacePanRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canEdit, selectedIds, onDelete, rackEdit]);

  const gridLines = useMemo(
    () => buildGridLines(objects, size.width, size.height, scale, stagePos),
    [objects, size.width, size.height, scale, stagePos],
  );

  const getWorldPointer = () => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return {
      x: (p.x - stagePos.x) / scale,
      y: (p.y - stagePos.y) / scale,
    };
  };

  const zoomAt = (clientX: number, clientY: number, nextScale: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pointer = { x: clientX - rect.left, y: clientY - rect.top };
    const world = {
      x: (pointer.x - stagePos.x) / scale,
      y: (pointer.y - stagePos.y) / scale,
    };
    const s = clampScale(nextScale);
    userAdjustedView.current = true;
    setScale(s);
    setStagePos({
      x: pointer.x - world.x * s,
      y: pointer.y - world.y * s,
    });
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    zoomAt(
      pointer.x + (wrapRef.current?.getBoundingClientRect().left ?? 0),
      pointer.y + (wrapRef.current?.getBoundingClientRect().top ?? 0),
      scale * (direction > 0 ? 1.08 : 1 / 1.08),
    );
  };

  const canStartEmptyGesture = (target: Konva.Node, stage: Konva.Stage) => {
    if (target === stage) return true;
    const name = target.name?.() ?? "";
    // Якоря/рамка Transformer — не «пустое» место (иначе сброс выделения / пан).
    if (
      name === "_back" ||
      name.startsWith("_anchor") ||
      target.getParent()?.getClassName() === "Transformer" ||
      target.getClassName() === "Transformer"
    ) {
      return false;
    }
    if (name === "map-object" || target.findAncestor(".map-object")) return false;
    return true;
  };

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  };

  const openContextAt = (
    clientX: number,
    clientY: number,
    world: { x: number; y: number },
  ) => {
    if (!canEdit) return;
    setContextMenu({ kind: "add", clientX, clientY, world });
    stopWallDrawing();
    marqueeArmedRef.current = false;
    setMarqueeArmed(false);
  };

  const openRackEdit = (rackId: number) => {
    if (!canEdit) return;
    const obj = objects.find((o) => o.id === rackId && o.type === "rack");
    if (!obj) return;
    setContextMenu(null);
    setRackEdit({
      id: obj.id,
      label: obj.label,
      shelvesCount: obj.shelvesCount ?? 5,
      initialShelvesCount: obj.shelvesCount ?? 5,
      width: obj.width,
      length: obj.height,
      rackTheme: normalizeRackTheme(obj.rackTheme),
    });
    stopWallDrawing();
    marqueeArmedRef.current = false;
    setMarqueeArmed(false);
  };

  const confirmRackEdit = () => {
    if (!rackEdit) return;
    const width = snapRackSize(rackEdit.width);
    const length = snapRackSize(rackEdit.length);
    const shelvesCount = Math.max(
      1,
      Math.min(40, Math.round(rackEdit.shelvesCount) || 5),
    );
    if (shelvesCount < rackEdit.initialShelvesCount) {
      const ok = window.confirm(
        "Уменьшить число полок?\nОбъекты на верхних полках (выше нового числа) будут удалены безвозвратно.",
      );
      if (!ok) return;
    }
    const id = rackEdit.id;
    setRackEdit(null);
    onPatch(id, {
      label: rackEdit.label.trim() || "Стеллаж",
      shelvesCount,
      width,
      height: length,
      rackTheme: rackEdit.rackTheme,
    });
  };

  const finishMarquee = (box: MarqueeState | null) => {
    marqueeRef.current = null;
    setMarquee(null);
    marqueeArmedRef.current = false;
    setMarqueeArmed(false);
    if (!box || (box.width < MARQUEE_MIN_PX && box.height < MARQUEE_MIN_PX)) {
      onSelect([]);
      return;
    }
    const hit = objects
      .filter((obj) =>
        aabbIntersect(box, {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
        }),
      )
      .map((obj) => obj.id);
    onSelect(hit);
  };

  const placeFromMenu = (type: ObjectType) => {
    if (!contextMenu || contextMenu.kind !== "add") return;
    const world = contextMenu.world;
    setContextMenu(null);
    if (type === "wall" || type === "window") {
      const start = { x: snapToGrid(world.x), y: snapToGrid(world.y) };
      setDrawTool(type);
      setLineStartBoth(start);
      setWallPreview(null);
      setSelectMode(false);
      return;
    }
    onCreate(defaultObjectAt(type, world));
  };

  const handleWallClick = (raw: { x: number; y: number }) => {
    if (!drawTool || !canEdit) return;
    if (wallPlaceLockRef.current) return;
    const pos = { x: snapToGrid(raw.x), y: snapToGrid(raw.y) };
    const start = lineStartRef.current;
    if (!start) {
      setLineStartBoth(pos);
      setWallPreview(null);
      return;
    }
    const segment = wallSegmentFromPoints(start, pos);
    if (!segment) {
      setWallPreview(wallRectFromPoints(start, pos));
      return;
    }
    wallPlaceLockRef.current = true;
    setLineStartBoth(segment.end);
    setWallPreview(null);
    onCreate({
      type: drawTool,
      label: drawTool === "wall" ? "Стена" : "Окно",
      x: segment.rect.x,
      y: segment.rect.y,
      width: segment.rect.width,
      height: segment.rect.height,
      shelvesCount: null,
      rotation: 0,
      frameWidth: null,
      rackTheme: null,
    });
    wallPlaceLockRef.current = false;
  };

  const updateWallPreview = (raw: { x: number; y: number }) => {
    const start = lineStartRef.current;
    if (!drawTool || !start) {
      setWallPreview(null);
      return;
    }
    const pos = { x: snapToGrid(raw.x), y: snapToGrid(raw.y) };
    setWallPreview(wallRectFromPoints(start, pos));
  };

  const onGroupDragEnd = (anchorId: number, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    const ids = selectedSet.has(anchorId) ? selectedIds : [anchorId];
    for (const id of ids) {
      const obj = objects.find((o) => o.id === id);
      if (!obj) continue;
      const gridSnap = snapsToMapGrid(obj.type);
      const x = gridSnap ? snapToGrid(obj.x + dx) : Math.round(obj.x + dx);
      const y = gridSnap ? snapToGrid(obj.y + dy) : Math.round(obj.y + dy);
      onPatch(id, { x, y });
    }
  };

  const canvasClass = [
    "map-canvas",
    panning ? "panning" : "",
    drawTool ? "drawing" : "",
    selectMode ? "selecting" : "",
    marqueeArmed ? "marquee-armed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="map-editor">
      {rackEdit && (
        <div
          className="item-detail-backdrop rack-edit-backdrop"
          role="presentation"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setRackEdit(null)}
        >
          <form
            className="item-detail rack-create"
            role="dialog"
            aria-labelledby="rack-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
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
                  <h2 id="rack-edit-title" className="item-detail-heading">
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
                onKeyDown={(e) => e.stopPropagation()}
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
                value={rackEdit.shelvesCount > 0 ? rackEdit.shelvesCount : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setRackEdit((prev) =>
                      prev ? { ...prev, shelvesCount: 0 } : prev,
                    );
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n)) return;
                  setRackEdit((prev) =>
                    prev
                      ? {
                          ...prev,
                          shelvesCount: Math.max(0, Math.min(40, Math.floor(n))),
                        }
                      : prev,
                  );
                }}
                onBlur={() =>
                  setRackEdit((prev) =>
                    prev
                      ? {
                          ...prev,
                          shelvesCount: Math.max(1, prev.shelvesCount || 1),
                        }
                      : prev,
                  )
                }
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Число полок"
              />
              <p className="field-hint">
                Уменьшение удалит объекты с верхних полок. Ряды глубины меняются
                внутри стеллажа.
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
                  onKeyDown={(e) => e.stopPropagation()}
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
                  onKeyDown={(e) => e.stopPropagation()}
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
                  if (
                    !window.confirm(
                      "Удалить стеллаж?\nСтеллаж и все объекты на полках будут удалены.",
                    )
                  ) {
                    return;
                  }
                  setRackEdit(null);
                  onDelete([id]);
                }}
              >
                Удалить стеллаж
              </button>
            </div>
          </form>
        </div>
      )}

      {canEdit && (
        <div className="map-toolbar" role="toolbar">
          <button
            type="button"
            className={selectMode ? "btn tool active" : "btn tool"}
            onClick={() => {
              setSelectMode((v) => !v);
              setContextMenu(null);
              stopWallDrawing();
            }}
          >
            Выделение
          </button>
          {drawTool ? (
            <button
              type="button"
              className="btn danger stop-draw-btn"
              onClick={stopWallDrawing}
            >
              Стоп
            </button>
          ) : null}
          {selectedIds.length > 0 ? (
            <button
              type="button"
              className="btn danger"
              onClick={() => onDelete(selectedIds)}
            >
              Удалить{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
            </button>
          ) : null}
          {selectedRackIds.length > 0 ? (
            <button
              type="button"
              className="btn primary"
              title="Скопировать выделенные стеллажи вместе с содержимым полок"
              onClick={() => onCopyRacks(selectedRackIds)}
            >
              Скопировать ({selectedRackIds.length})
            </button>
          ) : null}
          <button
            type="button"
            className="btn icon-btn"
            disabled={
              !soloObj ||
              !(
                soloObj.type === "rack" ||
                soloObj.type === "pallet" ||
                soloObj.type === "table" ||
                soloObj.type === "computer_desk" ||
                soloObj.type === "chair" ||
                soloObj.type === "door"
              )
            }
            title="Повернуть 90°"
            aria-label="Повернуть 90°"
            onClick={() => {
              if (!soloObj) return;
              onPatch(soloObj.id, rotateMapObject90(soloObj));
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              aria-hidden
            >
              <path
                d="M20 9V4h-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 4a9 9 0 1 0 2.2 8.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              !soloObj ||
              (soloObj.type !== "rack" &&
                soloObj.type !== "table")
            }
            title={
              soloObj?.type === "table"
                ? "Перенести перегородку на противоположную длинную сторону"
                : "Перевернуть фронт стеллажа (полоска — задняя сторона)"
            }
            onClick={() => {
              if (
                !soloObj ||
                (soloObj.type !== "rack" &&
                  soloObj.type !== "table")
              ) {
                return;
              }
              onPatch(soloObj.id, flipRackFront(soloObj));
            }}
          >
            {soloObj?.type === "table" ? "Перегородка" : "Фронт"}
          </button>
          <span className="toolbar-sep" aria-hidden />
          <input
            ref={floorInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFloorUpload(file);
            }}
          />
          <button
            type="button"
            className="btn tool"
            onClick={() => floorInputRef.current?.click()}
          >
            Текстура пола
          </button>
          {settings.hasFloorTexture && (
            <button type="button" className="btn ghost" onClick={onFloorClear}>
              Сбросить пол
            </button>
          )}
          {drawTool && (
            <span className="toolbar-hint">
              Кликайте узлы стены
              {lineStart ? " · продолжается" : ""} · Стоп / Esc — конец
            </span>
          )}
          {selectMode && (
            <span className="toolbar-hint">Рамка выделения · Esc — выход</span>
          )}
          {marqueeArmed && !selectMode && (
            <span className="toolbar-hint">
              Зажмите и протяните рамку · Esc — сброс
            </span>
          )}
        </div>
      )}

      <div
        ref={wrapRef}
        className={canvasClass}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="zoom-controls" aria-label="Масштаб">
          <button
            type="button"
            className="btn zoom-btn"
            onClick={() => {
              const el = wrapRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * 1.12);
            }}
            title="Приблизить"
          >
            +
          </button>
          <button
            type="button"
            className="btn zoom-btn zoom-label"
            onClick={() => {
              userAdjustedView.current = true;
              setScale(1);
              setStagePos({ x: 0, y: 0 });
            }}
            title="Масштаб 100%"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="btn zoom-btn"
            onClick={() => {
              const el = wrapRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale / 1.12);
            }}
            title="Отдалить"
          >
            −
          </button>
          <button
            type="button"
            className="btn zoom-btn zoom-center-btn"
            disabled={objects.length === 0}
            title="Центрировать карту"
            aria-label="Центрировать карту"
            onClick={() => {
              const next = fitStageToObjects(objects, size.width, size.height);
              if (next) {
                userAdjustedView.current = false;
                setScale(next.scale);
                setStagePos({ x: next.x, y: next.y });
              }
            }}
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
        {contextMenu?.kind === "add" && (
          <div
            className="map-context-menu"
            style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
            role="menu"
          >
            <div className="map-context-title">Добавить</div>
            {TOOL_LABELS.map((t) => (
              <button
                key={t.type}
                type="button"
                className="map-context-item"
                role="menuitem"
                onClick={() => placeFromMenu(t.type)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={onWheel}
          onMouseDown={(e) => {
            setContextMenu(null);
            const stage = e.target.getStage();
            if (!stage) return;
            const isMiddle = e.evt.button === 1;
            const isLeft = e.evt.button === 0;
            const isRight = e.evt.button === 2;
            const empty = canStartEmptyGesture(e.target, stage);
            const world = getWorldPointer();

            if (isRight && canEdit && empty && world) {
              e.evt.preventDefault();
              openContextAt(e.evt.clientX, e.evt.clientY, world);
              return;
            }

            if (isMiddle || (isLeft && spacePanRef.current)) {
              e.evt.preventDefault();
              emptyClickRef.current = null;
              userAdjustedView.current = true;
              panRef.current = {
                x: e.evt.clientX,
                y: e.evt.clientY,
                sx: stagePos.x,
                sy: stagePos.y,
              };
              setPanning(true);
              return;
            }

            if (!isLeft) return;
            if (drawTool) return;

            if (empty && canEdit && world) {
              if (marqueeArmedRef.current || selectMode) {
                emptyClickRef.current = null;
                marqueeRef.current = { start: world };
                setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
                return;
              }
              emptyClickRef.current = {
                x: e.evt.clientX,
                y: e.evt.clientY,
                world,
              };
            } else {
              marqueeArmedRef.current = false;
              setMarqueeArmed(false);
              emptyClickRef.current = null;
            }
          }}
          onMousemove={(e: Konva.KonvaEventObject<MouseEvent>) => {
            if (panRef.current) {
              const dx = e.evt.clientX - panRef.current.x;
              const dy = e.evt.clientY - panRef.current.y;
              setStagePos({
                x: panRef.current.sx + dx,
                y: panRef.current.sy + dy,
              });
              return;
            }
            if (emptyClickRef.current) {
              const dx = e.evt.clientX - emptyClickRef.current.x;
              const dy = e.evt.clientY - emptyClickRef.current.y;
              if (Math.hypot(dx, dy) > CLICK_MOVE_PX) {
                emptyClickRef.current = null;
              }
            }
            const world = getWorldPointer();
            if (!world) return;
            if (marqueeRef.current) {
              const s = marqueeRef.current.start;
              setMarquee({
                x: Math.min(s.x, world.x),
                y: Math.min(s.y, world.y),
                width: Math.abs(world.x - s.x),
                height: Math.abs(world.y - s.y),
              });
              return;
            }
            if (drawTool && lineStartRef.current) {
              updateWallPreview(world);
            }
          }}
          onMouseup={() => {
            if (panRef.current) {
              panRef.current = null;
              setPanning(false);
              return;
            }
            if (marqueeRef.current) {
              finishMarquee(marquee);
              return;
            }
            if (emptyClickRef.current) {
              emptyClickRef.current = null;
              onSelect([]);
              marqueeArmedRef.current = true;
              setMarqueeArmed(true);
              return;
            }
            if (drawTool) {
              const world = getWorldPointer();
              if (world) handleWallClick(world);
            }
          }}
          onMouseLeave={() => {
            if (panRef.current) {
              panRef.current = null;
              setPanning(false);
            }
          }}
          onTouchStart={(e) => {
            setContextMenu(null);
            const touches = e.evt.touches;
            if (touches.length === 2) {
              clearLongPress();
              userAdjustedView.current = true;
              const [a, b] = [touches[0], touches[1]];
              const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
              pinchRef.current = {
                lastDist: dist,
                lastCenter: {
                  x: (a.clientX + b.clientX) / 2,
                  y: (a.clientY + b.clientY) / 2,
                },
              };
              return;
            }
            if (touches.length !== 1) return;
            const stage = e.target.getStage();
            if (!stage) return;
            const empty = canStartEmptyGesture(e.target, stage);
            const world = getWorldPointer();
            const t = touches[0];

            if (drawTool) return;

            if (selectMode && empty && canEdit && world) {
              marqueeRef.current = { start: world };
              setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
              return;
            }

            if (empty && canEdit && world) {
              clearLongPress();
              longPressRef.current = {
                x: t.clientX,
                y: t.clientY,
                world,
                timer: window.setTimeout(() => {
                  const lp = longPressRef.current;
                  longPressRef.current = null;
                  if (!lp) return;
                  panRef.current = null;
                  setPanning(false);
                  openContextAt(lp.x, lp.y, lp.world);
                }, LONG_PRESS_MS),
              };
            }

            if (empty && !selectMode && !drawTool) {
              userAdjustedView.current = true;
              panRef.current = {
                x: t.clientX,
                y: t.clientY,
                sx: stagePos.x,
                sy: stagePos.y,
              };
              setPanning(true);
            }
          }}
          onTouchMove={(e) => {
            const touches = e.evt.touches;
            if (touches.length === 2 && pinchRef.current) {
              clearLongPress();
              e.evt.preventDefault();
              const [a, b] = [touches[0], touches[1]];
              const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
              const center = {
                x: (a.clientX + b.clientX) / 2,
                y: (a.clientY + b.clientY) / 2,
              };
              const ratio = dist / Math.max(1, pinchRef.current.lastDist);
              zoomAt(center.x, center.y, scale * ratio);
              pinchRef.current = { lastDist: dist, lastCenter: center };
              return;
            }
            if (touches.length === 1) {
              const t = touches[0];
              if (longPressRef.current) {
                const dx = t.clientX - longPressRef.current.x;
                const dy = t.clientY - longPressRef.current.y;
                if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) clearLongPress();
              }
              const world = getWorldPointer();
              if (marqueeRef.current && world) {
                const s = marqueeRef.current.start;
                setMarquee({
                  x: Math.min(s.x, world.x),
                  y: Math.min(s.y, world.y),
                  width: Math.abs(world.x - s.x),
                  height: Math.abs(world.y - s.y),
                });
                return;
              }
              if (drawTool && lineStartRef.current && world) {
                updateWallPreview(world);
                return;
              }
              if (panRef.current) {
                const dx = t.clientX - panRef.current.x;
                const dy = t.clientY - panRef.current.y;
                setStagePos({
                  x: panRef.current.sx + dx,
                  y: panRef.current.sy + dy,
                });
              }
            }
          }}
          onTouchEnd={() => {
            clearLongPress();
            const wasPanning = Boolean(panRef.current);
            panRef.current = null;
            pinchRef.current = null;
            setPanning(false);
            if (marqueeRef.current) {
              finishMarquee(marquee);
              return;
            }
            if (drawTool && !wasPanning) {
              const world = getWorldPointer();
              if (world) handleWallClick(world);
            }
          }}
          onClick={() => {
            /* выделение сбрасывается в mouseup при клике по пустому */
          }}
          onTap={(e) => {
            if (
              e.target === e.target.getStage() &&
              !marquee &&
              !selectMode &&
              !drawTool
            ) {
              onSelect([]);
            }
          }}
        >
          <Layer listening={false}>
            {gridLines.map((pts, i) => (
              <Line
                key={i}
                points={pts}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
                listening={false}
              />
            ))}
          </Layer>
          <Layer>
            {objects.map((obj) => (
              <MapObjectShape
                key={obj.id}
                obj={obj}
                selected={selectedSet.has(obj.id)}
                soloSelected={soloId === obj.id}
                canEdit={canEdit}
                locked={Boolean(drawTool) || selectMode}
                onSelect={(additive) => {
                  marqueeArmedRef.current = false;
                  setMarqueeArmed(false);
                  if (additive) {
                    if (selectedSet.has(obj.id)) {
                      onSelect(selectedIds.filter((id) => id !== obj.id));
                    } else {
                      onSelect([...selectedIds, obj.id]);
                    }
                  } else {
                    onSelect([obj.id]);
                  }
                }}
                onChange={(patch) => onPatch(obj.id, patch)}
                onGroupDragEnd={(dx, dy) => onGroupDragEnd(obj.id, dx, dy)}
                onOpen={
                  obj.type === "rack" ? () => onOpenRack(obj.id) : undefined
                }
                onRackMenu={
                  obj.type === "rack" ? () => openRackEdit(obj.id) : undefined
                }
              />
            ))}
            {wallPreview && (
              <Rect
                x={wallPreview.x}
                y={wallPreview.y}
                width={wallPreview.width}
                height={wallPreview.height}
                fill="rgba(240,138,46,0.35)"
                stroke="#f08a2e"
                dash={[6, 4]}
                listening={false}
              />
            )}
            {lineStart && drawTool && (
              <Rect
                x={lineStart.x - 4}
                y={lineStart.y - 4}
                width={8}
                height={8}
                fill="#f08a2e"
                listening={false}
              />
            )}
            {marquee && (
              <Rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.width}
                height={marquee.height}
                fill="rgba(59, 130, 246, 0.18)"
                stroke="#3b82f6"
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
