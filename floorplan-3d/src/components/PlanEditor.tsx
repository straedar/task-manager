import { useEffect, useRef, useState } from "react";
import type { FloorPlanModel, Opening } from "../lib/process";
import { wallSizeMm, type WallSeg } from "../lib/walls";
import { furnitureSizeMm, type Furniture } from "../lib/furniture";

type MenuState = {
  x: number;
  y: number;
  col: number;
  row: number;
  opening: Opening | null;
  furniture: Furniture | null;
};

type WallEditorState = {
  x: number;
  y: number;
  wallId: string;
  length: string;
  thickness: string;
};

type FurnitureEditorState = {
  x: number;
  y: number;
  furnitureId: string;
  width: string;
  depth: string;
};

type DragState = {
  kind: "opening" | "wall" | "furniture";
  id: string;
  col: number;
  row: number;
  dragging: boolean;
};

type PlanEditorProps = {
  mode: "source" | "mask";
  imageUrl: string;
  model: FloorPlanModel;
  walls: WallSeg[];
  openings: Opening[];
  furniture: Furniture[];
  selectedId: string | null;
  selectedWallId: string | null;
  selectedFurnitureId: string | null;
  cellMm: number;
  onSelect: (id: string | null) => void;
  onSelectWall: (id: string | null) => void;
  onSelectFurniture: (id: string | null) => void;
  onMove: (id: string, col: number, row: number) => void;
  onMoveWall: (id: string, col: number, row: number) => void;
  onMoveFurniture: (id: string, col: number, row: number) => void;
  onWallChange: (id: string, patch: { length?: number; thickness?: number }) => void;
  onCreate: (kind: Opening["kind"], col: number, row: number) => void;
  onCreateFurniture: (col: number, row: number) => void;
  onDelete: (id: string) => void;
  onDeleteFurniture: (id: string) => void;
  onRotateFurniture: (id: string) => void;
  onResizeFurniture: (id: string, patch: { width?: number; depth?: number }) => void;
  onOpenRack: (id: string) => void;
  onToggleDoorLeaf: (id: string) => void;
};

export function PlanEditor({
  mode,
  imageUrl,
  model,
  walls,
  openings,
  furniture,
  selectedId,
  selectedWallId,
  selectedFurnitureId,
  cellMm,
  onSelect,
  onSelectWall,
  onSelectFurniture,
  onMove,
  onMoveWall,
  onMoveFurniture,
  onWallChange,
  onCreate,
  onCreateFurniture,
  onDelete,
  onDeleteFurniture,
  onRotateFurniture,
  onResizeFurniture,
  onOpenRack,
  onToggleDoorLeaf,
}: PlanEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [wallEditor, setWallEditor] = useState<WallEditorState | null>(null);
  const [furnitureEditor, setFurnitureEditor] = useState<FurnitureEditorState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const holdRef = useRef<number | null>(null);

  const clearHold = () => {
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };

  const measure = () => {
    const frame = frameRef.current;
    if (!frame) return;
    const fr = frame.getBoundingClientRect();
    if (mode === "mask") {
      setBox(containRect(fr.width, fr.height, model.cols, model.rows));
      return;
    }
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setBox(objectFitContainBox(frame, img));
  };

  useEffect(() => {
    measure();
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [imageUrl, mode, model.cols, model.rows]);

  useEffect(() => {
    if (!menu && !wallEditor && !furnitureEditor) return;
    const close = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      setMenu(null);
      setWallEditor(null);
      setFurnitureEditor(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu, wallEditor, furnitureEditor]);

  const toGrid = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      col: ((event.clientX - rect.left) / rect.width) * model.cols,
      row: ((event.clientY - rect.top) / rect.height) * model.rows,
    };
  };

  const popoverPos = (event: { clientX: number; clientY: number }) => {
    const frame = frameRef.current?.getBoundingClientRect();
    const x = event.clientX - (frame?.left ?? 0);
    const y = event.clientY - (frame?.top ?? 0);
    const maxX = Math.max(12, (frame?.width ?? 240) - 200);
    const maxY = Math.max(12, (frame?.height ?? 180) - 24);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    };
  };

  const openPressMenu = (
    event: { clientX: number; clientY: number },
    col: number,
    row: number,
  ) => {
    dragRef.current = null;
    const item = hitFurniture(furniture, col, row);
    if (item) {
      openFurnitureEditor(event, item);
      return;
    }
    const opening = hitOpening(openings, col, row);
    if (opening) {
      openOpeningMenu(event, col, row, opening, null);
      return;
    }
    const wall = hitWall(walls, col, row);
    if (wall) {
      openWallEditor(event, wall);
      return;
    }
    openOpeningMenu(event, col, row, null, null);
  };

  const commitWallEditor = (next?: WallEditorState | null) => {
    const editor = next === undefined ? wallEditor : next;
    if (!editor) return;
    const length = Number(editor.length);
    const thickness = Number(editor.thickness);
    const patch: { length?: number; thickness?: number } = {};
    if (Number.isFinite(length) && length > 0) patch.length = length;
    if (Number.isFinite(thickness) && thickness > 0) patch.thickness = thickness;
    if (Object.keys(patch).length) onWallChange(editor.wallId, patch);
  };

  const openWallEditor = (event: { clientX: number; clientY: number }, wall: WallSeg) => {
    const size = wallSizeMm(wall, cellMm);
    setMenu(null);
    setFurnitureEditor(null);
    setWallEditor({
      ...popoverPos(event),
      wallId: wall.id,
      length: String(size.length),
      thickness: String(size.thickness),
    });
    onSelectWall(wall.id);
    onSelect(null);
    onSelectFurniture(null);
  };

  const commitFurnitureEditor = (next?: FurnitureEditorState | null) => {
    const editor = next === undefined ? furnitureEditor : next;
    if (!editor) return;
    const width = Number(editor.width);
    const depth = Number(editor.depth);
    const patch: { width?: number; depth?: number } = {};
    if (Number.isFinite(width) && width > 0) patch.width = width;
    if (Number.isFinite(depth) && depth > 0) patch.depth = depth;
    if (Object.keys(patch).length) onResizeFurniture(editor.furnitureId, patch);
  };

  const openFurnitureEditor = (event: { clientX: number; clientY: number }, item: Furniture) => {
    const size = furnitureSizeMm(item, cellMm);
    setMenu(null);
    setWallEditor(null);
    setFurnitureEditor({
      ...popoverPos(event),
      furnitureId: item.id,
      width: String(size.width),
      depth: String(size.depth),
    });
    onSelectFurniture(item.id);
    onSelect(null);
    onSelectWall(null);
  };

  const openOpeningMenu = (
    event: { clientX: number; clientY: number },
    col: number,
    row: number,
    opening: Opening | null,
    item: Furniture | null,
  ) => {
    setWallEditor(null);
    setFurnitureEditor(null);
    setMenu({ ...popoverPos(event), col, row, opening, furniture: item });
  };

  return (
    <div
      ref={frameRef}
      className={`preview-frame${mode === "mask" ? " mask-mode" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === "source" ? (
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Превью плана"
          onLoad={measure}
          draggable={false}
        />
      ) : null}
      {box.width > 0 ? (
        <svg
          className="plan-overlay"
          viewBox={`0 0 ${model.cols} ${model.rows}`}
          preserveAspectRatio="none"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag) return;
            const { col, row } = toGrid(e);
            const dist = Math.hypot(col - drag.col, row - drag.row);
            if (!drag.dragging && dist < 0.45) return;
            clearHold();
            drag.dragging = true;
            if (drag.kind === "wall") onMoveWall(drag.id, col, row);
            else if (drag.kind === "furniture") onMoveFurniture(drag.id, col, row);
            else onMove(drag.id, col, row);
          }}
          onPointerUp={() => {
            dragRef.current = null;
            clearHold();
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            clearHold();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = null;
            const { col, row } = toGrid(e);
            const item = hitFurniture(furniture, col, row);
            if (item) {
              onOpenRack(item.id);
              return;
            }
            const opening = hitOpening(openings, col, row);
            openOpeningMenu(e, col, row, opening, null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = null;
            const { col, row } = toGrid(e);
            const item = hitFurniture(furniture, col, row);
            if (item) {
              openFurnitureEditor(e, item);
              return;
            }
            const opening = hitOpening(openings, col, row);
            if (opening) {
              openOpeningMenu(e, col, row, opening, null);
              return;
            }
            const wall = hitWall(walls, col, row);
            if (wall) openWallEditor(e, wall);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (e.detail > 1) return;
            e.preventDefault();
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            setMenu(null);
            setWallEditor(null);
            setFurnitureEditor(null);
            const { col, row } = toGrid(e);
            const point = { clientX: e.clientX, clientY: e.clientY };
            clearHold();
            holdRef.current = window.setTimeout(() => {
              holdRef.current = null;
              openPressMenu(point, col, row);
            }, 480);
            const item = hitFurniture(furniture, col, row);
            if (item) {
              e.preventDefault();
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              dragRef.current = { kind: "furniture", id: item.id, col, row, dragging: false };
              onSelectFurniture(item.id);
              onSelect(null);
              onSelectWall(null);
              return;
            }
            const opening = hitOpening(openings, col, row);
            if (opening) {
              e.preventDefault();
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              dragRef.current = { kind: "opening", id: opening.id, col, row, dragging: false };
              onSelect(opening.id);
              onSelectWall(null);
              onSelectFurniture(null);
              return;
            }
            const wall = hitWall(walls, col, row);
            if (wall) {
              e.preventDefault();
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              dragRef.current = { kind: "wall", id: wall.id, col, row, dragging: false };
              onSelectWall(wall.id);
              onSelect(null);
              onSelectFurniture(null);
              return;
            }
            onSelect(null);
            onSelectWall(null);
            onSelectFurniture(null);
          }}
        >
          {walls.map((wall) => (
            <rect
              key={wall.id}
              className={`wall-cell${wall.id === selectedWallId ? " selected" : ""}${mode === "source" ? " on-plan" : ""}`}
              x={wall.c}
              y={wall.r}
              width={Math.max(1, wall.w)}
              height={Math.max(1, wall.d)}
            />
          ))}
          {openings.map((opening) => (
            <rect
              key={opening.id}
              className={`opening ${opening.kind}${opening.id === selectedId ? " selected" : ""}${opening.kind === "door" && opening.hasLeaf === false ? " empty" : ""}`}
              x={opening.c}
              y={opening.r}
              width={Math.max(1, opening.w)}
              height={Math.max(1, opening.d)}
            />
          ))}
          {furniture.map((item) => (
            <ShelfMark key={item.id} item={item} selected={item.id === selectedFurnitureId} />
          ))}
        </svg>
      ) : null}

      {wallEditor ? (
        <div
          ref={popoverRef}
          className="ctx-menu wall-editor"
          style={{ left: wallEditor.x, top: wallEditor.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="wall-editor-title">Длина стены</p>
          <label className="mini-field">
            Длина, мм
            <input
              className="num"
              type="number"
              min={5}
              max={2000}
              step={1}
              autoFocus
              value={wallEditor.length}
              onChange={(e) => setWallEditor({ ...wallEditor, length: e.target.value })}
              onBlur={() => commitWallEditor()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitWallEditor();
                  setWallEditor(null);
                }
              }}
            />
          </label>
          <label className="mini-field">
            Толщина, мм
            <input
              className="num"
              type="number"
              min={1}
              max={80}
              step={1}
              value={wallEditor.thickness}
              onChange={(e) => setWallEditor({ ...wallEditor, thickness: e.target.value })}
              onBlur={() => commitWallEditor()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitWallEditor();
                  setWallEditor(null);
                }
              }}
            />
          </label>
        </div>
      ) : null}

      {furnitureEditor ? (
        <div
          ref={popoverRef}
          className="ctx-menu wall-editor"
          style={{ left: furnitureEditor.x, top: furnitureEditor.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="wall-editor-title">Стеллаж</p>
          <label className="mini-field">
            Ширина, мм
            <input
              className="num"
              type="number"
              min={8}
              max={2000}
              step={1}
              autoFocus
              value={furnitureEditor.width}
              onChange={(e) => setFurnitureEditor({ ...furnitureEditor, width: e.target.value })}
              onBlur={() => commitFurnitureEditor()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitFurnitureEditor();
                  setFurnitureEditor(null);
                }
              }}
            />
          </label>
          <label className="mini-field">
            Глубина, мм
            <input
              className="num"
              type="number"
              min={6}
              max={800}
              step={1}
              value={furnitureEditor.depth}
              onChange={(e) => setFurnitureEditor({ ...furnitureEditor, depth: e.target.value })}
              onBlur={() => commitFurnitureEditor()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitFurnitureEditor();
                  setFurnitureEditor(null);
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onOpenRack(furnitureEditor.furnitureId);
              setFurnitureEditor(null);
            }}
          >
            Коробки на полках
          </button>
          <button
            type="button"
            onClick={() => {
              onRotateFurniture(furnitureEditor.furnitureId);
              setFurnitureEditor(null);
            }}
          >
            Повернуть
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              onDeleteFurniture(furnitureEditor.furnitureId);
              setFurnitureEditor(null);
            }}
          >
            Удалить стеллаж
          </button>
        </div>
      ) : null}

      {menu ? (
        <div
          ref={popoverRef}
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onCreate("window", menu.col, menu.row);
              setMenu(null);
            }}
          >
            Добавить окно
          </button>
          <button
            type="button"
            onClick={() => {
              onCreate("door", menu.col, menu.row);
              setMenu(null);
            }}
          >
            Добавить дверь
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateFurniture(menu.col, menu.row);
              setMenu(null);
            }}
          >
            Добавить стеллаж
          </button>
          {menu.opening?.kind === "door" ? (
            <button
              type="button"
              onClick={() => {
                onToggleDoorLeaf(menu.opening!.id);
                setMenu(null);
              }}
            >
              {menu.opening.hasLeaf === false ? "Вернуть дверь" : "Убрать дверь"}
            </button>
          ) : null}
          {menu.opening ? (
            <button
              type="button"
              className="danger"
              onClick={() => {
                onDelete(menu.opening!.id);
                setMenu(null);
              }}
            >
              Удалить проём
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function hitOpening(openings: Opening[], col: number, row: number) {
  for (let i = openings.length - 1; i >= 0; i--) {
    const o = openings[i]!;
    if (col >= o.c && col <= o.c + o.w && row >= o.r && row <= o.r + o.d) return o;
  }
  return null;
}

function hitFurniture(items: Furniture[], col: number, row: number) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (col >= item.c && col <= item.c + item.w && row >= item.r && row <= item.r + item.d) return item;
  }
  return null;
}

function ShelfMark({ item, selected }: { item: Furniture; selected: boolean }) {
  const alongX = item.back === "n" || item.back === "s";
  const w = Math.max(1, item.w);
  const d = Math.max(1, item.d);
  const post = Math.max(0.35, Math.min(w, d) * 0.14);
  const posts: Array<[number, number]> = [
    [item.c, item.r],
    [item.c + w - post, item.r],
    [item.c, item.r + d - post],
    [item.c + w - post, item.r + d - post],
  ];
  return (
    <g className={`furniture${selected ? " selected" : ""}`}>
      <rect className="furniture-body" x={item.c} y={item.r} width={w} height={d} />
      {posts.map(([x, y], i) => (
        <rect key={i} className="furniture-post" x={x} y={y} width={post} height={post} />
      ))}
      {alongX ? (
        <>
          <line className="furniture-line" x1={item.c + w * 0.2} x2={item.c + w * 0.8} y1={item.r + d * 0.35} y2={item.r + d * 0.35} />
          <line className="furniture-line" x1={item.c + w * 0.2} x2={item.c + w * 0.8} y1={item.r + d * 0.65} y2={item.r + d * 0.65} />
        </>
      ) : (
        <>
          <line className="furniture-line" x1={item.c + w * 0.35} x2={item.c + w * 0.35} y1={item.r + d * 0.2} y2={item.r + d * 0.8} />
          <line className="furniture-line" x1={item.c + w * 0.65} x2={item.c + w * 0.65} y1={item.r + d * 0.2} y2={item.r + d * 0.8} />
        </>
      )}
    </g>
  );
}

function hitWall(walls: WallSeg[], col: number, row: number) {
  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i]!;
    if (col >= wall.c && col <= wall.c + wall.w && row >= wall.r && row <= wall.r + wall.d) return wall;
  }
  return null;
}

function containRect(frameW: number, frameH: number, cols: number, rows: number) {
  const scale = Math.min(frameW / cols, frameH / rows);
  const width = cols * scale;
  const height = rows * scale;
  return {
    left: (frameW - width) / 2,
    top: (frameH - height) / 2,
    width,
    height,
  };
}

function objectFitContainBox(frame: HTMLElement, img: HTMLImageElement) {
  const fr = frame.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const scale = Math.min(ir.width / natW, ir.height / natH);
  const width = natW * scale;
  const height = natH * scale;
  return {
    left: ir.left - fr.left + (ir.width - width) / 2,
    top: ir.top - fr.top + (ir.height - height) / 2,
    width,
    height,
  };
}
