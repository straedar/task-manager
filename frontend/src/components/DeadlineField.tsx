import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { formatDayHeading } from "../utils/date";
import {
  isPastMoscowDay,
  monthGrid,
  monthLabel,
  moscowDateKey,
  shiftMonth,
} from "../utils/moscow";
import { WheelTimePicker } from "./WheelTimePicker";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface DeadlineFieldProps {
  enabled: boolean;
  dateKey: string;
  onEnabledChange: (enabled: boolean) => void;
  onDateChange: (dateKey: string) => void;
  /** When set from planner — date is fixed, only show / hide deadline. */
  lockedDateKey?: string | null;
  showTime?: boolean;
  time?: string;
  onTimeChange?: (time: string) => void;
  hintWhenEnabled?: string;
  hintWhenDisabled?: string;
  enabledLabel?: string;
  disabledLabel?: string;
}

function formatTimeLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = String(match ? Math.min(23, Number(match[1])) : 18).padStart(2, "0");
  const minute = String(match ? Math.min(59, Number(match[2])) : 0).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function DeadlineField({
  enabled,
  dateKey,
  onEnabledChange,
  onDateChange,
  lockedDateKey = null,
  showTime = true,
  time = "18:00",
  onTimeChange,
  hintWhenEnabled,
  hintWhenDisabled,
  enabledLabel = "Со сроком",
  disabledLabel = "Без срока",
}: DeadlineFieldProps) {
  const locked = Boolean(lockedDateKey);
  const effectiveDate = lockedDateKey || dateKey;
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(() => `${(effectiveDate || moscowDateKey()).slice(0, 7)}-01`);
  const rootRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const todayKey = moscowDateKey();
  const cells = useMemo(() => monthGrid(monthKey), [monthKey]);
  const timeLabel = formatTimeLabel(time);

  useEffect(() => {
    if (!open) return;
    setMonthKey(`${(effectiveDate || todayKey).slice(0, 7)}-01`);
  }, [open, effectiveDate, todayKey]);

  useEffect(() => {
    if (!open && !timeOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (open && rootRef.current && !rootRef.current.contains(target)) setOpen(false);
      if (timeOpen && timeRef.current && !timeRef.current.contains(target)) setTimeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setTimeOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, timeOpen]);

  const enable = () => {
    onEnabledChange(true);
    if (!dateKey && !lockedDateKey) onDateChange(todayKey);
  };

  return (
    <div className="w-full">
        <span className="mb-2 block text-sm font-medium text-gray-700">Дедлайн</span>
      <div className="flex w-full rounded-2xl bg-gray-100 p-1">
        <button
          type="button"
          onClick={enable}
          className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
            enabled ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          {enabledLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onEnabledChange(false);
            setOpen(false);
            setTimeOpen(false);
          }}
          className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
            !enabled ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          {disabledLabel}
        </button>
      </div>

      {enabled && (
        <div className="mt-3 flex flex-col gap-3">
          <div ref={rootRef} className="relative">
            {locked ? (
              <div className="flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                <CalendarDays className="h-4 w-4 shrink-0 text-orange-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {formatDayHeading(effectiveDate)}
                  </p>
                  <p className="text-xs text-gray-500">Дата из планировщика</p>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen((v) => !v);
                    setTimeOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-orange-300"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">
                      {effectiveDate ? formatDayHeading(effectiveDate) : "Выберите дату"}
                    </span>
                    <span className="block text-xs text-gray-400">Нажмите, чтобы изменить</span>
                  </span>
                </button>

                {open && (
                  <div className="date-filter-panel absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-3xl border border-gray-100 bg-white p-3 shadow-soft">
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
                        const past = isPastMoscowDay(day);
                        const isToday = day === todayKey;
                        const isSelected = day === effectiveDate;
                        return (
                          <button
                            key={day}
                            type="button"
                            disabled={past}
                            onClick={() => {
                              onDateChange(day);
                              setOpen(false);
                            }}
                            className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl text-sm font-medium transition ${
                              past
                                ? "cursor-not-allowed text-gray-300"
                                : isSelected
                                  ? "gradient-accent text-white shadow"
                                  : isToday
                                    ? "bg-orange-50 text-orange-600"
                                    : "text-gray-800 hover:bg-orange-50/70"
                            }`}
                          >
                            {Number(day.slice(-2))}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onDateChange(todayKey);
                        setOpen(false);
                      }}
                      className="mt-3 w-full rounded-2xl border border-orange-200 bg-orange-50 py-2.5 text-xs font-semibold text-orange-600 transition hover:bg-orange-100"
                    >
                      Сегодня
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {showTime && onTimeChange && (
            <div ref={timeRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setTimeOpen((v) => !v);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-orange-300"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                  <Clock className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">Время дедлайна</span>
                  <span className="block text-xs text-gray-400">Прокрутите колёса, 24 часа (МСК)</span>
                </span>
                <span className="rounded-xl bg-orange-50 px-3 py-1.5 text-sm font-semibold tabular-nums text-orange-600">
                  {timeLabel}
                </span>
              </button>

              {timeOpen && (
                <div className="date-filter-panel relative z-40 mt-3">
                  <WheelTimePicker time={time} onChange={onTimeChange} />
                  <button
                    type="button"
                    onClick={() => setTimeOpen(false)}
                    className="mt-3 w-full rounded-2xl border border-orange-200 bg-orange-50 py-2.5 text-xs font-semibold text-orange-600 transition hover:bg-orange-100"
                  >
                    Готово
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(enabled ? hintWhenEnabled : hintWhenDisabled) && (
        <p className="mt-2 text-xs text-gray-400">
          {enabled ? hintWhenEnabled : hintWhenDisabled}
        </p>
      )}
    </div>
  );
}
