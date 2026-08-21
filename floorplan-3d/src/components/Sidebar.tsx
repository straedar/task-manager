import { useId, useState, type ReactNode } from "react";
import type { FloorPlanModel, Opening, ProcessSettings } from "../lib/process";
import { REAL_WALL_HEIGHT } from "../lib/parts";
import { mToMm } from "../lib/units";
import type { WindowEdit } from "../lib/windows";
import type { WallSeg } from "../lib/walls";
import type { Furniture } from "../lib/furniture";
import { DoorList, FurnitureList, WallList, WindowList } from "./WindowList";
import { PlanEditor } from "./PlanEditor";

type SidebarProps = {
  settings: ProcessSettings;
  onSettings: (next: ProcessSettings) => void;
  wallHeight: number;
  onWallHeight: (value: number) => void;
  planWidth: number;
  onPlanWidth: (value: number) => void;
  showPlan: boolean;
  onShowPlan: (value: boolean) => void;
  colorRooms: boolean;
  onColorRooms: (value: boolean) => void;
  preview: "source" | "mask";
  onPreview: (value: "source" | "mask") => void;
  sourceUrl?: string;
  previewUrl?: string;
  stats?: { rooms: number; walls: number; doors: number; windows: number };
  busy: boolean;
  onExport: () => void;
  canExport: boolean;
  showOpenings: boolean;
  onShowOpenings: (value: boolean) => void;
  windows?: Array<{ id: string; index: number }>;
  windowEdits?: Record<string, WindowEdit>;
  selectedWindowId?: string | null;
  onSelectWindow?: (id: string | null) => void;
  onWindowChange?: (id: string, patch: Partial<WindowEdit>) => void;
  planModel?: FloorPlanModel | null;
  openings?: Opening[];
  onMoveOpening?: (id: string, col: number, row: number) => void;
  onCreateOpening?: (kind: Opening["kind"], col: number, row: number) => void;
  onDeleteOpening?: (id: string) => void;
  onToggleDoorLeaf?: (id: string) => void;
  walls?: WallSeg[];
  selectedWallId?: string | null;
  onSelectWall?: (id: string | null) => void;
  onMoveWall?: (id: string, col: number, row: number) => void;
  onWallChange?: (id: string, patch: { length?: number; thickness?: number }) => void;
  wallSizes?: Array<{ id: string; index: number; length: number; thickness: number }>;
  furniture?: Furniture[];
  selectedFurnitureId?: string | null;
  onSelectFurniture?: (id: string | null) => void;
  onMoveFurniture?: (id: string, col: number, row: number) => void;
  onCreateFurniture?: (col: number, row: number) => void;
  onDeleteFurniture?: (id: string) => void;
  onRotateFurniture?: (id: string) => void;
  onResizeFurniture?: (id: string, patch: { width?: number; depth?: number }) => void;
  furnitureSizes?: Array<{ id: string; index: number; width: number; depth: number }>;
  onOpenRack?: (id: string) => void;
  open?: boolean;
  onClose?: () => void;
};

export function Sidebar({
  settings,
  onSettings,
  wallHeight,
  onWallHeight,
  planWidth,
  onPlanWidth,
  showPlan,
  onShowPlan,
  colorRooms,
  onColorRooms,
  preview,
  onPreview,
  sourceUrl,
  previewUrl,
  stats,
  busy,
  onExport,
  canExport,
  showOpenings,
  onShowOpenings,
  windows = [],
  windowEdits = {},
  selectedWindowId = null,
  onSelectWindow,
  onWindowChange,
  planModel = null,
  openings = [],
  onMoveOpening,
  onCreateOpening,
  onDeleteOpening,
  onToggleDoorLeaf,
  walls = [],
  selectedWallId = null,
  onSelectWall,
  onMoveWall,
  onWallChange,
  wallSizes = [],
  furniture = [],
  selectedFurnitureId = null,
  onSelectFurniture,
  onMoveFurniture,
  onCreateFurniture,
  onDeleteFurniture,
  onRotateFurniture,
  onResizeFurniture,
  furnitureSizes = [],
  onOpenRack,
  open = false,
  onClose,
}: SidebarProps) {
  const patch = (partial: Partial<ProcessSettings>) => onSettings({ ...settings, ...partial });

  return (
    <aside className={open ? "sidebar open" : "sidebar"}>
      <div className="sidebar-mobile-head">
        <p className="panel-title">Меню</p>
        <button className="btn ghost menu-close" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {sourceUrl ? (
        <CollapsiblePanel title="Распознавание">
          <div className="panel-head">
            <div className="tabs">
              <button
                className={preview === "source" ? "tab active" : "tab"}
                onClick={() => onPreview("source")}
                type="button"
              >
                План
              </button>
              <button
                className={preview === "mask" ? "tab active" : "tab"}
                onClick={() => onPreview("mask")}
                type="button"
              >
                Стены
              </button>
            </div>
          </div>
          <div className="preview-frame-wrap">
            {planModel && onMoveOpening && onCreateOpening && onDeleteOpening && onToggleDoorLeaf && onSelectWindow && onSelectWall && onMoveWall && onWallChange && onSelectFurniture && onMoveFurniture && onCreateFurniture && onDeleteFurniture && onRotateFurniture && onResizeFurniture && onOpenRack ? (
              <PlanEditor
                mode={preview}
                imageUrl={sourceUrl}
                model={planModel}
                walls={walls}
                openings={openings}
                furniture={furniture}
                selectedId={selectedWindowId}
                selectedWallId={selectedWallId}
                selectedFurnitureId={selectedFurnitureId}
                cellMm={planWidth / planModel.cols}
                onSelect={onSelectWindow}
                onSelectWall={onSelectWall}
                onSelectFurniture={onSelectFurniture}
                onMove={onMoveOpening}
                onMoveWall={onMoveWall}
                onMoveFurniture={onMoveFurniture}
                onWallChange={onWallChange}
                onCreate={onCreateOpening}
                onCreateFurniture={onCreateFurniture}
                onDelete={onDeleteOpening}
                onDeleteFurniture={onDeleteFurniture}
                onRotateFurniture={onRotateFurniture}
                onResizeFurniture={onResizeFurniture}
                onOpenRack={onOpenRack}
                onToggleDoorLeaf={onToggleDoorLeaf}
              />
            ) : (
              <div className="preview-frame">
                <img src={preview === "mask" ? previewUrl : sourceUrl} alt="Превью плана" />
              </div>
            )}
            {busy ? <div className="busy">Считаем стены…</div> : null}
          </div>
          <p className="stats">
            Перетащите объект. Долгий тап — размеры или меню. Двойной тап по стеллажу — коробки.
          </p>
          {stats ? (
            <p className="stats">
              Комнат: {stats.rooms} · дверей: {stats.doors} · окон: {stats.windows}
            </p>
          ) : null}
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel title="Параметры плана">
        <Slider
          label="Чувствительность"
          min={2}
          max={40}
          value={settings.sensitivity}
          onChange={(v) => patch({ sensitivity: v })}
        />
        <Slider
          label="Окно анализа"
          min={15}
          max={71}
          step={2}
          value={settings.blockSize}
          onChange={(v) => patch({ blockSize: v })}
        />
        <Slider
          label="Убрать мелкий шум"
          min={10}
          max={400}
          value={settings.minArea}
          onChange={(v) => patch({ minArea: v })}
        />
        <Slider
          label="Сгладить тонкие линии"
          min={0}
          max={3}
          value={settings.openRadius}
          onChange={(v) => patch({ openRadius: v })}
        />
        <Slider
          label="Склеить разрывы стен"
          min={0}
          max={8}
          value={settings.closeRadius}
          onChange={(v) => patch({ closeRadius: v })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={settings.invert}
            onChange={(e) => patch({ invert: e.target.checked })}
          />
          Инвертировать (светлые стены)
        </label>
      </CollapsiblePanel>

      <CollapsiblePanel title="3D-модель">
        <MeterField
          label="Сечение, мм"
          value={wallHeight}
          onChange={onWallHeight}
          min={5}
          sliderMin={10}
          sliderMax={mToMm(REAL_WALL_HEIGHT)}
          step={1}
        />
        <p className="stats">Стены 100 мм, выше этой отметки вид обрезается</p>
        <Slider
          label="Ширина плана, мм"
          min={100}
          max={2000}
          step={10}
          value={planWidth}
          onChange={onPlanWidth}
        />
        <label className="check">
          <input type="checkbox" checked={showPlan} onChange={(e) => onShowPlan(e.target.checked)} />
          Чертёж на полу
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={colorRooms}
            onChange={(e) => onColorRooms(e.target.checked)}
          />
          Подсветить комнаты
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showOpenings}
            onChange={(e) => onShowOpenings(e.target.checked)}
          />
          Двери и окна
        </label>
        <button className="btn primary" type="button" disabled={!canExport} onClick={onExport}>
          Скачать STL
        </button>
        <p className="stats">Бинарный STL, единицы — миллиметры</p>
      </CollapsiblePanel>

      {windows.length > 0 && onSelectWindow && onWindowChange ? (
        <CollapsiblePanel title="Окна">
          <WindowList
            windows={windows}
            edits={windowEdits}
            selectedId={selectedWindowId}
            onSelect={onSelectWindow}
            onChange={onWindowChange}
            wallHeight={mToMm(REAL_WALL_HEIGHT)}
          />
        </CollapsiblePanel>
      ) : null}

      {wallSizes.length > 0 && onSelectWall && onWallChange ? (
        <CollapsiblePanel title="Стены">
          <WallList
            walls={wallSizes}
            selectedId={selectedWallId}
            onSelect={onSelectWall}
            onChange={onWallChange}
          />
        </CollapsiblePanel>
      ) : null}

      {onToggleDoorLeaf && onSelectWindow && openings.some((opening) => opening.kind === "door") ? (
        <CollapsiblePanel title="Двери">
          <DoorList
            doors={openings
              .filter((opening) => opening.kind === "door")
              .map((opening, index) => ({
                id: opening.id,
                index,
                hasLeaf: opening.hasLeaf !== false,
              }))}
            selectedId={selectedWindowId ?? null}
            onSelect={onSelectWindow}
            onToggleLeaf={onToggleDoorLeaf}
          />
        </CollapsiblePanel>
      ) : null}

      {furnitureSizes.length > 0 && onSelectFurniture && onRotateFurniture && onDeleteFurniture && onResizeFurniture ? (
        <CollapsiblePanel title="Стеллажи">
          <FurnitureList
            items={furnitureSizes}
            selectedId={selectedFurnitureId}
            onSelect={onSelectFurniture}
            onRotate={onRotateFurniture}
            onDelete={onDeleteFurniture}
            onChange={onResizeFurniture}
            onOpen={onOpenRack}
          />
        </CollapsiblePanel>
      ) : null}
    </aside>
  );
}

function CollapsiblePanel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "panel" : "panel collapsed"}>
      <button
        type="button"
        className="panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="panel-title">{title}</span>
        <span className="panel-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? <div className="panel-body">{children}</div> : null}
    </section>
  );
}

function MeterField({
  label,
  value,
  onChange,
  min,
  sliderMin,
  sliderMax,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  sliderMin: number;
  sliderMax: number;
  step: number;
}) {
  const id = useId();
  const sliderValue = Math.min(sliderMax, Math.max(sliderMin, value));

  return (
    <label className="slider" htmlFor={id}>
      <span>
        {label}
        <input
          className="num"
          type="number"
          min={min}
          step={step}
          value={Math.round(value)}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next >= min) onChange(next);
          }}
        />
      </span>
      <input
        id={id}
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="slider" htmlFor={id}>
      <span>
        {label}
        <strong>{Number.isInteger(step) && step >= 1 ? value : value.toFixed(1)}</strong>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
