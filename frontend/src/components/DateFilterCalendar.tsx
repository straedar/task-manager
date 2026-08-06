import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatDayHeading } from "../utils/date";
import {
  monthGrid,
  monthLabel,
  moscowDateKey,
  shiftMonth,
} from "../utils/moscow";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface DateFilterCalendarProps {
  value: string;
  onChange: (dateKey: string) => void;
  onClear: () => void;
  /** Days that have items (show dots). */
  activeDays?: Set<string>;
}

export function DateFilterCalendar({
  value,
  onChange,
  onClear,
  activeDays,
}: DateFilterCalendarProps) {
  const [open, setOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(() => {
    const base = value || moscowDateKey();
    return `${base.slice(0, 7)}-01`;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const todayKey = moscowDateKey();
  const cells = useMemo(() => monthGrid(monthKey), [monthKey]);

  useEffect(() => {
    if (!open) return;
    const base = value || moscowDateKey();
    setMonthKey(`${base.slice(0, 7)}-01`);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-[46px] w-[46px] items-center justify-center rounded-2xl border shadow-sm transition ${
          value
            ? "border-transparent gradient-accent text-white shadow"
            : "border-gray-200 bg-white text-orange-500 hover:border-orange-300 hover:bg-orange-50"
        }`}
        aria-label="Фильтр по дате"
        aria-expanded={open}
        title="Фильтр по дате"
      >
        <CalendarDays className="h-5 w-5" />
        {value && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--page-bg)] bg-white" />
        )}
      </button>

      {open && (
        <div className="date-filter-panel absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(20.5rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-gray-100 bg-white p-3 shadow-soft">
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setMonthKey((prev) => shiftMonth(prev, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-sm font-semibold capitalize text-gray-900">
              {monthLabel(monthKey)}
            </p>
            <button
              type="button"
              onClick={() => setMonthKey((prev) => shiftMonth(prev, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[11px] font-medium text-gray-400">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="aspect-square" />;
              const isToday = day === todayKey;
              const isSelected = day === value;
              const hasItems = activeDays?.has(day) ?? false;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl text-sm font-medium transition ${
                    isSelected
                      ? "gradient-accent text-white shadow"
                      : isToday
                        ? "bg-orange-50 text-orange-600"
                        : "text-gray-800 hover:bg-orange-50/70"
                  }`}
                >
                  {Number(day.slice(-2))}
                  {hasItems && (
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                        isSelected ? "bg-white" : "bg-orange-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => pick(todayKey)}
              className="flex-1 rounded-2xl border border-orange-200 bg-orange-50 py-2.5 text-xs font-semibold text-orange-600 transition hover:bg-orange-100"
            >
              Сегодня
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="flex-1 rounded-2xl border border-gray-200 bg-white py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Сбросить
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-2xl border border-gray-200 bg-white py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Закрыть
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DateFilterChipProps {
  dateKey: string;
  onClear: () => void;
}

export function DateFilterChip({ dateKey, onClear }: DateFilterChipProps) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-accent text-white shadow">
        <CalendarDays className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-orange-500">
          Фильтр по дате
        </p>
        <p className="truncate text-sm font-semibold text-gray-900">
          {formatDayHeading(dateKey)}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-orange-600 transition hover:bg-white/70"
        aria-label="Сбросить фильтр"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
