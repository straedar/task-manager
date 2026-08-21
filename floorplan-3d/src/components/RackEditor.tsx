import { useMemo, useRef, useState } from "react";
import type { Furniture } from "../lib/furniture";
import { shelfFrame } from "../lib/furniture";
import { addCartonAt, cartonSize, moveCartonAlong, type Carton } from "../lib/carton";

type RackEditorProps = {
  furniture: Furniture;
  cell: number;
  cartons: Carton[];
  onClose: () => void;
  onAdd: (carton: Carton) => void;
  onMove: (carton: Carton) => void;
  onDelete: (id: string) => void;
};

export function RackEditor({
  furniture,
  cell,
  cartons,
  onClose,
  onAdd,
  onMove,
  onDelete,
}: RackEditorProps) {
  const frame = useMemo(() => shelfFrame(furniture, cell), [furniture, cell]);
  const mine = cartons.filter((item) => item.furnitureId === furniture.id);
  const view = { w: 320, h: 420, pad: 18 };
  const innerW = view.w - view.pad * 2;
  const innerH = view.h - view.pad * 2;
  const dragRef = useRef<{ id: string; along: number; moved: boolean } | null>(null);
  const holdRef = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clearHold = () => {
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };

  const levelView = (index: number) => {
    const count = Math.max(1, frame.levels.length);
    const gap = innerH / count;
    const y = view.pad + (count - 1 - index) * gap;
    return { y, h: gap };
  };

  const toAlong = (clientX: number, svg: SVGSVGElement, boxW: number) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * view.w;
    const local = (x - view.pad - frame.post / frame.along * innerW * 0.08) / innerW;
    const span = Math.max(frame.innerW - boxW, 0.0001);
    const left = local * frame.innerW - boxW / 2;
    return Math.min(1, Math.max(0, left / span));
  };

  return (
    <div className="rack-modal" onPointerDown={onClose}>
      <div className="rack-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="rack-dialog-head">
          <div>
            <p className="wall-editor-title">Стеллаж</p>
            <p className="stats">Клик по полке — коробка. Перетащите или долгий тап / ПКМ — убрать.</p>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <svg
          className="rack-view"
          viewBox={`0 0 ${view.w} ${view.h}`}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag) return;
            const carton = mine.find((item) => item.id === drag.id);
            if (!carton) return;
            const size = cartonSize(frame, carton.level);
            const along = toAlong(e.clientX, e.currentTarget, size.w);
            if (Math.abs(along - drag.along) > 0.02) {
              drag.moved = true;
              clearHold();
            }
            onMove(moveCartonAlong(carton, along, furniture, cell, mine));
          }}
          onPointerUp={() => {
            dragRef.current = null;
            clearHold();
          }}
          onPointerLeave={() => {
            dragRef.current = null;
            clearHold();
          }}
        >
          <rect className="rack-view-bg" x={0} y={0} width={view.w} height={view.h} rx={14} />
          <rect
            className="rack-post"
            x={view.pad}
            y={view.pad}
            width={10}
            height={innerH}
            rx={2}
          />
          <rect
            className="rack-post"
            x={view.w - view.pad - 10}
            y={view.pad}
            width={10}
            height={innerH}
            rx={2}
          />
          {frame.levels.map((level) => {
            const slot = levelView(level.index);
            const size = cartonSize(frame, level.index);
            const boxes = mine.filter((item) => item.level === level.index);
            return (
              <g key={level.index}>
                <rect
                  className="rack-bay"
                  x={view.pad + 12}
                  y={slot.y + 6}
                  width={innerW - 24}
                  height={slot.h - 10}
                  onClick={(e) => {
                    e.stopPropagation();
                    const along = toAlong(e.clientX, e.currentTarget.ownerSVGElement!, size.w);
                    const created = addCartonAt(furniture, cell, level.index, along, mine);
                    if (created) {
                      onAdd(created);
                      setSelectedId(created.id);
                    }
                  }}
                />
                <rect
                  className="rack-deck"
                  x={view.pad + 10}
                  y={slot.y + slot.h - 7}
                  width={innerW - 20}
                  height={6}
                  rx={1}
                />
                {boxes.map((carton) => {
                  const boxW = Math.max(18, (size.w / frame.innerW) * (innerW - 28));
                  const boxH = Math.max(16, Math.min(slot.h - 18, (size.h / Math.max(level.clearH, size.h)) * (slot.h - 18)));
                  const x = view.pad + 14 + carton.along * (innerW - 28 - boxW);
                  const y = slot.y + slot.h - 8 - boxH;
                  const selected = carton.id === selectedId;
                  return (
                    <g
                      key={carton.id}
                      className={selected ? "rack-carton selected" : "rack-carton"}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setSelectedId(carton.id);
                        dragRef.current = { id: carton.id, along: carton.along, moved: false };
                        (e.currentTarget as SVGGElement).ownerSVGElement?.setPointerCapture(e.pointerId);
                        clearHold();
                        holdRef.current = window.setTimeout(() => {
                          holdRef.current = null;
                          if (dragRef.current?.moved) return;
                          dragRef.current = null;
                          onDelete(carton.id);
                          setSelectedId(null);
                        }, 520);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(carton.id);
                        setSelectedId(null);
                      }}
                    >
                      <rect x={x} y={y} width={boxW} height={boxH} rx={2} />
                      <rect className="rack-carton-label" x={x + boxW * 0.12} y={y + boxH * 0.12} width={boxW * 0.42} height={boxH * 0.28} rx={1} />
                      <rect className="rack-carton-mark" x={x + boxW * 0.12} y={y + boxH * 0.48} width={boxW * 0.36} height={boxH * 0.22} rx={1} />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <p className="stats">На полке клик ставит коробку в это место, если хватает ширины.</p>
      </div>
    </div>
  );
}
