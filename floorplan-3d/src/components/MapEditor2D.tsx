import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Transformer, Line, Group } from "react-konva";
import type Konva from "konva";
import type { MapObject, MapSettings, ObjectType } from "../api";
import {
  GRID,
  LABELED_TYPES,
  OBJECT_FILL,
  TOOL_LABELS,
  clampScale,
  defaultObjectAt,
  fitStageToObjects,
  minSize,
  rotateMapObject90,
  snapToGrid,
  snapsToMapGrid,
  wallRectFromPoints,
} from "../world";

type Props = {
  objects: MapObject[];
  canEdit: boolean;
  selectedId: number | null;
  tool: ObjectType | null;
  settings: MapSettings;
  onSelect: (id: number | null) => void;
  onToolChange: (tool: ObjectType | null) => void;
  onCreate: (draft: Omit<MapObject, "id">) => void;
  onPatch: (id: number, patch: Partial<MapObject>) => void;
  onDelete: (id: number) => void;
  onSettingsPatch: (patch: Partial<MapSettings>) => void;
  onFloorUpload: (file: File) => void;
  onFloorClear: () => void;
  onOpenRack: (id: number) => void;
};

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

  const showLabel = LABELED_TYPES.has(obj.type) && Boolean(obj.label);

  return (
    <>
      <Rect
        width={obj.width}
        height={obj.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={obj.type === "rack" || obj.type === "pallet" ? 4 : 0}
      />
      {obj.type === "rack" && (
        /* Стрелка на открытую сторону (+Z / низ клетки): кресты X на торцах ±X */
        <Line
          points={[
            obj.width * 0.35,
            obj.height * 0.72,
            obj.width * 0.5,
            obj.height * 0.92,
            obj.width * 0.65,
            obj.height * 0.72,
          ]}
          closed
          fill="#f08a2e"
          opacity={0.9}
          listening={false}
        />
      )}
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
  canEdit,
  drawMode,
  onSelect,
  onChange,
  onOpen,
}: {
  obj: MapObject;
  selected: boolean;
  canEdit: boolean;
  drawMode: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<MapObject>) => void;
  onOpen?: () => void;
}) {
  const shapeRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const limits = minSize(obj.type);
  // Стеллажи поворачиваем кнопкой (обмен сторон), не ручкой Transformer —
  // иначе Konva крутит вокруг угла и объект «уезжает» без смены ориентации.
  const canRotateHandle = obj.type === "door" || obj.type === "chair";
  const canResize = obj.type !== "wall" && obj.type !== "window";
  const gridSnap = snapsToMapGrid(obj.type);
  const showTransform = selected && !drawMode && canEdit && canResize;

  useEffect(() => {
    if (showTransform && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [showTransform, obj.width, obj.height, obj.x, obj.y, obj.rotation]);

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
        listening={!drawMode}
        draggable={canEdit && !drawMode && selected}
        onClick={(e) => {
          e.cancelBubble = true;
          if (!drawMode) onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          if (!drawMode) onSelect();
        }}
        onDblClick={(e) => {
          e.cancelBubble = true;
          if (!drawMode) onOpen?.();
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          if (!drawMode) onOpen?.();
        }}
        onDragEnd={(e) => {
          if (!canEdit) return;
          const x = gridSnap ? snapToGrid(e.target.x()) : Math.round(e.target.x());
          const y = gridSnap ? snapToGrid(e.target.y()) : Math.round(e.target.y());
          e.target.position({ x, y });
          onChange({ x, y });
        }}
        onTransformEnd={() => {
          if (!canEdit) return;
          const node = shapeRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          let nextW = Math.max(limits.minSide, Math.round(Math.abs(node.width() * scaleX)));
          let nextH = Math.max(limits.minSide, Math.round(Math.abs(node.height() * scaleY)));
          let nextX = node.x();
          let nextY = node.y();
          if (scaleX < 0) nextX += node.width() * scaleX;
          if (scaleY < 0) nextY += node.height() * scaleY;
          if (gridSnap) {
            nextX = snapToGrid(nextX);
            nextY = snapToGrid(nextY);
            nextW = Math.max(GRID, snapToGrid(nextW));
            nextH = Math.max(GRID, snapToGrid(nextH));
            node.width(nextW);
            node.height(nextH);
            node.position({ x: nextX, y: nextY });
          }
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
          boundBoxFunc={(oldBox, newBox) => {
            if (Math.min(newBox.width, newBox.height) < limits.minSide) return oldBox;
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
  selectedId,
  tool,
  settings,
  onSelect,
  onToolChange,
  onCreate,
  onPatch,
  onDelete,
  onSettingsPatch,
  onFloorUpload,
  onFloorClear,
  onOpenRack,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const floorInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const pinchRef = useRef<{
    lastDist: number;
    lastCenter: { x: number; y: number };
  } | null>(null);
  const wallDraftRef = useRef<{
    type: "wall" | "window";
    start: { x: number; y: number };
  } | null>(null);
  const [wallDraft, setWallDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const fittedKey = useRef("");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const key = `${objects.length}:${size.width}x${size.height}`;
    if (fittedKey.current === key && objects.length > 0) return;
    const next = fitStageToObjects(objects, size.width, size.height);
    if (next) {
      setScale(next.scale);
      setStagePos({ x: next.x, y: next.y });
      fittedKey.current = key;
    }
  }, [objects, size.width, size.height]);

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

  const canStartPan = (target: Konva.Node, stage: Konva.Stage) => {
    if (target === stage) return true;
    const name = target.name?.() ?? "";
    if (name === "map-object" || target.findAncestor(".map-object")) return false;
    return true;
  };

  return (
    <div className="map-editor">
      {canEdit && (
        <div className="map-toolbar" role="toolbar">
          <button
            type="button"
            className={!tool ? "btn tool active" : "btn tool"}
            onClick={() => onToolChange(null)}
          >
            Выбрать
          </button>
          {TOOL_LABELS.map((t) => (
            <button
              key={t.type}
              type="button"
              className={tool === t.type ? "btn tool active" : "btn tool"}
              onClick={() => onToolChange(t.type)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="btn danger"
            disabled={selectedId == null}
            onClick={() => {
              if (selectedId != null) onDelete(selectedId);
            }}
          >
            Удалить
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              selectedId == null ||
              !objects.some(
                (o) =>
                  o.id === selectedId &&
                  (o.type === "rack" ||
                    o.type === "pallet" ||
                    o.type === "table" ||
                    o.type === "chair" ||
                    o.type === "door"),
              )
            }
            onClick={() => {
              const obj = objects.find((o) => o.id === selectedId);
              if (!obj) return;
              onPatch(obj.id, rotateMapObject90(obj));
            }}
          >
            Повернуть 90°
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              selectedId == null ||
              !objects.some((o) => o.id === selectedId && o.type === "rack")
            }
            onClick={() => {
              const rack = objects.find(
                (o) => o.id === selectedId && o.type === "rack",
              );
              if (rack) onOpenRack(rack.id);
            }}
          >
            Войти
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = fitStageToObjects(objects, size.width, size.height);
              if (next) {
                setScale(next.scale);
                setStagePos({ x: next.x, y: next.y });
              }
            }}
          >
            Центрировать
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
        </div>
      )}

      {canEdit && (
        <div className="map-settings" role="group" aria-label="Высоты">
          <label className="map-setting">
            <span>Стены</span>
            <input
              type="range"
              min={150}
              max={800}
              step={5}
              value={Math.round(settings.wallHeightM * 100)}
              onChange={(e) =>
                onSettingsPatch({ wallHeightM: Number(e.target.value) / 100 })
              }
            />
            <em>{Math.round(settings.wallHeightM * 100)} см</em>
          </label>
          <label className="map-setting">
            <span>Стеллажи</span>
            <input
              type="range"
              min={120}
              max={600}
              step={5}
              value={Math.round(settings.rackHeightM * 100)}
              onChange={(e) =>
                onSettingsPatch({ rackHeightM: Number(e.target.value) / 100 })
              }
            />
            <em>{Math.round(settings.rackHeightM * 100)} см</em>
          </label>
          <label className="map-setting">
            <span>Подоконник</span>
            <input
              type="range"
              min={10}
              max={250}
              step={5}
              value={Math.round(settings.windowSillM * 100)}
              onChange={(e) =>
                onSettingsPatch({ windowSillM: Number(e.target.value) / 100 })
              }
            />
            <em>{Math.round(settings.windowSillM * 100)} см</em>
          </label>
          <label className="map-setting">
            <span>Высота окон</span>
            <input
              type="range"
              min={30}
              max={300}
              step={5}
              value={Math.round(settings.windowHeightM * 100)}
              onChange={(e) =>
                onSettingsPatch({ windowHeightM: Number(e.target.value) / 100 })
              }
            />
            <em>{Math.round(settings.windowHeightM * 100)} см</em>
          </label>
        </div>
      )}

      <div
        ref={wrapRef}
        className={`map-canvas ${panning ? "panning" : ""} ${tool ? "drawing" : ""}`}
      >
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
            const stage = e.target.getStage();
            if (!stage) return;
            const isMiddle = e.evt.button === 1;
            const isLeft = e.evt.button === 0;

            if (isMiddle || (isLeft && !tool && canStartPan(e.target, stage))) {
              panRef.current = {
                x: e.evt.clientX,
                y: e.evt.clientY,
                sx: stagePos.x,
                sy: stagePos.y,
              };
              setPanning(true);
              return;
            }

            if (!canEdit || !tool || !isLeft) return;
            const world = getWorldPointer();
            if (!world) return;

            if (tool === "wall" || tool === "window") {
              wallDraftRef.current = { type: tool, start: world };
              setWallDraft(wallRectFromPoints(world, world));
              return;
            }

            onCreate(defaultObjectAt(tool, world));
            onToolChange(null);
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
            const draft = wallDraftRef.current;
            if (!draft) return;
            const world = getWorldPointer();
            if (!world) return;
            setWallDraft(wallRectFromPoints(draft.start, world));
          }}
          onMouseup={() => {
            if (panRef.current) {
              panRef.current = null;
              setPanning(false);
            }
            const draftMeta = wallDraftRef.current;
            const draft = wallDraft;
            wallDraftRef.current = null;
            setWallDraft(null);
            if (!draftMeta || !draft || !canEdit) return;
            if (draft.width < GRID - 0.5 && draft.height < GRID - 0.5) return;
            onCreate({
              type: draftMeta.type,
              label: draftMeta.type === "wall" ? "Стена" : "Окно",
              x: draft.x,
              y: draft.y,
              width: draft.width,
              height: draft.height,
              shelvesCount: null,
              rotation: 0,
              frameWidth: null,
              rackTheme: null,
            });
            onToolChange(null);
          }}
          onMouseLeave={() => {
            if (panRef.current) {
              panRef.current = null;
              setPanning(false);
            }
          }}
          onTouchStart={(e) => {
            const touches = e.evt.touches;
            if (touches.length === 2) {
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
            if (touches.length === 1 && !tool) {
              const stage = e.target.getStage();
              if (stage && canStartPan(e.target, stage)) {
                panRef.current = {
                  x: touches[0].clientX,
                  y: touches[0].clientY,
                  sx: stagePos.x,
                  sy: stagePos.y,
                };
                setPanning(true);
              }
            }
          }}
          onTouchMove={(e) => {
            const touches = e.evt.touches;
            if (touches.length === 2 && pinchRef.current) {
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
            if (panRef.current && touches.length === 1) {
              const dx = touches[0].clientX - panRef.current.x;
              const dy = touches[0].clientY - panRef.current.y;
              setStagePos({
                x: panRef.current.sx + dx,
                y: panRef.current.sy + dy,
              });
            }
          }}
          onTouchEnd={() => {
            panRef.current = null;
            pinchRef.current = null;
            setPanning(false);
          }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) onSelect(null);
          }}
          onTap={(e) => {
            if (e.target === e.target.getStage()) onSelect(null);
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
                selected={selectedId === obj.id}
                canEdit={canEdit}
                drawMode={tool != null}
                onSelect={() => onSelect(obj.id)}
                onChange={(patch) => onPatch(obj.id, patch)}
                onOpen={
                  obj.type === "rack" ? () => onOpenRack(obj.id) : undefined
                }
              />
            ))}
            {wallDraft && (
              <Rect
                x={wallDraft.x}
                y={wallDraft.y}
                width={wallDraft.width}
                height={wallDraft.height}
                fill="rgba(240,138,46,0.35)"
                stroke="#f08a2e"
                dash={[6, 4]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
