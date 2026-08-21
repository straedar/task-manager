import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createShelfItem, deleteShelfItem, listShelfItems, replaceRackItems, setShelfItemContents, updateShelfItem, type MapObject, type RackTheme, type ShelfItem, type ShelfItemType } from "../api";
import { CatalogContentsPicker, type CatalogPick } from "../CatalogContentsPicker";
import { useDialog } from "../DialogContext";
import "./rack-interior.css";

type ShelfDropTarget = { shelfIndex: number; depthRow: number; posX: number | null };
const MAX_SHELF_ROWS = 8;
const GRID = 50;
const VIEW_SCALE_MAX = 2.5;
const ENTITY_GAP = 6;
const MAX_STACK = 4;
const SHELF_CELLS_PER_BOX = 6;
const DEFAULT_FRAME_WIDTH = 720;
const FRAME_WIDTH_MIN = 360;
const FRAME_WIDTH_MAX = 1600;
const UNSTACK_ARM_MS = 300;

function normalizeRackTheme(value: unknown): RackTheme {
  if (value === "black" || value === "orange") return "black";
  return "blue";
}

function clearDomSelection() {
  window.getSelection?.()?.removeAllRanges();
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
export function RackInterior({
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
  const { confirm } = useDialog();
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

