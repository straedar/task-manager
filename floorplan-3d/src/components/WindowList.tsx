import type { WindowEdit } from "../lib/windows";

type WindowListProps = {
  windows: Array<{ id: string; index: number }>;
  edits: Record<string, WindowEdit>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<WindowEdit>) => void;
  wallHeight: number;
};

export function WindowList({
  windows,
  edits,
  selectedId,
  onSelect,
  onChange,
  wallHeight,
}: WindowListProps) {
  if (windows.length === 0) return null;

  return (
    <>
      <p className="stats">Двойной клик на плане — добавить окно. Перетащите прямоугольник, чтобы сдвинуть.</p>
      <div className="window-list">
        {windows.map((item) => {
          const edit = edits[item.id];
          if (!edit) return null;
          const active = selectedId === item.id;
          return (
            <article
              key={item.id}
              className={active ? "window-card active" : "window-card"}
              onClick={() => onSelect(item.id)}
            >
              <h3>Окно {item.index + 1}</h3>
              <label className="mini-field">
                Высота от пола, мм
                <input
                  className="num"
                  type="number"
                  min={5}
                  max={Math.max(10, wallHeight - 20)}
                  step={1}
                  value={edit.sillHeight}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { sillHeight: next });
                  }}
                />
              </label>
              <label className="mini-field">
                Ширина, мм
                <input
                  className="num"
                  type="number"
                  min={8}
                  max={2000}
                  step={1}
                  value={edit.width}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { width: next });
                  }}
                />
              </label>
            </article>
          );
        })}
      </div>
    </>
  );
}

type DoorListProps = {
  doors: Array<{ id: string; index: number; hasLeaf: boolean }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleLeaf: (id: string) => void;
};

export function DoorList({ doors, selectedId, onSelect, onToggleLeaf }: DoorListProps) {
  if (doors.length === 0) return null;

  return (
    <>
      <p className="stats">Можно убрать полотно и оставить проём. Двойной клик по двери на плане — то же действие.</p>
      <div className="window-list">
        {doors.map((item) => {
          const active = selectedId === item.id;
          return (
            <article
              key={item.id}
              className={active ? "window-card active" : "window-card"}
              onClick={() => onSelect(item.id)}
            >
              <h3>Дверь {item.index + 1}</h3>
              <button
                className="btn ghost"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLeaf(item.id);
                }}
              >
                {item.hasLeaf ? "Убрать дверь из проёма" : "Вернуть дверь"}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

type WallListProps = {
  walls: Array<{ id: string; index: number; length: number; thickness: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: { length?: number; thickness?: number }) => void;
};

export function WallList({ walls, selectedId, onSelect, onChange }: WallListProps) {
  if (walls.length === 0) return null;

  return (
    <>
      <p className="stats">ПКМ по стене на плане — задать длину и толщину в миллиметрах.</p>
      <div className="window-list">
        {walls.map((item) => {
          const active = selectedId === item.id;
          return (
            <article
              key={item.id}
              className={active ? "window-card active" : "window-card"}
              onClick={() => onSelect(item.id)}
            >
              <h3>Стена {item.index + 1}</h3>
              <label className="mini-field">
                Длина, мм
                <input
                  className="num"
                  type="number"
                  min={5}
                  max={2000}
                  step={1}
                  value={item.length}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { length: next });
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
                  value={item.thickness}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { thickness: next });
                  }}
                />
              </label>
            </article>
          );
        })}
      </div>
    </>
  );
}

type FurnitureListProps = {
  items: Array<{ id: string; index: number; width: number; depth: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onChange: (id: string, patch: { width?: number; depth?: number }) => void;
  onOpen?: (id: string) => void;
};

export function FurnitureList({ items, selectedId, onSelect, onRotate, onDelete, onChange, onOpen }: FurnitureListProps) {
  if (items.length === 0) return null;

  return (
    <>
      <p className="stats">Двойной клик по стеллажу — вид полок и коробки. ПКМ — ширина и глубина.</p>
      <div className="window-list">
        {items.map((item) => {
          const active = selectedId === item.id;
          return (
            <article
              key={item.id}
              className={active ? "window-card active" : "window-card"}
              onClick={() => onSelect(item.id)}
            >
              <h3>Стеллаж {item.index + 1}</h3>
              <label className="mini-field">
                Ширина, мм
                <input
                  className="num"
                  type="number"
                  min={8}
                  max={2000}
                  step={1}
                  value={item.width}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { width: next });
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
                  value={item.depth}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) onChange(item.id, { depth: next });
                  }}
                />
              </label>
              <button
                className="btn ghost"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(item.id);
                }}
              >
                Коробки на полках
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRotate(item.id);
                }}
              >
                Повернуть
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
              >
                Удалить
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}
