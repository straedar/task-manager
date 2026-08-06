import { useCallback, useEffect, useRef, useState } from "react";

const ITEM_H = 40;
const VISIBLE = 5;
const PAD = Math.floor(VISIBLE / 2); // spacer so first/last can sit in the band
const VIEW_H = ITEM_H * VISIBLE;
const COPIES = 5;
const MID_COPY = Math.floor(COPIES / 2);

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function wrapIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

/**
 * With top/bottom PAD spacers and snap-align:center, item `g` (0-based in the
 * loop list) is centered when scrollTop === g * ITEM_H.
 */
function scrollTopForGlobal(g: number): number {
  return g * ITEM_H;
}

function globalFromScrollTop(scrollTop: number): number {
  return Math.round(scrollTop / ITEM_H);
}

interface WheelColumnProps {
  values: string[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

function WheelColumn({ values, value, onChange, ariaLabel }: WheelColumnProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  const valuesRef = useRef(values);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  valuesRef.current = values;
  onChangeRef.current = onChange;

  const n = values.length;
  const loopItems = Array.from({ length: COPIES * n }, (_, i) => values[i % n]!);

  const [centerGlobal, setCenterGlobal] = useState(() => MID_COPY * n + Math.max(0, values.indexOf(value)));

  const midGlobal = useCallback(
    (logical: number) => MID_COPY * n + wrapIndex(logical, n),
    [n]
  );

  const jumpToLogical = useCallback(
    (logical: number) => {
      const el = scrollerRef.current;
      if (!el || n === 0) return;
      const g = midGlobal(logical);
      lockRef.current = true;
      el.scrollTo({ top: scrollTopForGlobal(g), behavior: "auto" });
      setCenterGlobal(g);
      window.setTimeout(() => {
        lockRef.current = false;
      }, 40);
    },
    [midGlobal, n]
  );

  useEffect(() => {
    const i = Math.max(0, values.indexOf(value));
    jumpToLogical(i);
  }, [value, values, jumpToLogical]);

  const emitLogical = useCallback((logical: number) => {
    const list = valuesRef.current;
    const i = wrapIndex(logical, list.length);
    const next = list[i];
    if (next && next !== valueRef.current) onChangeRef.current(next);
  }, []);

  const settle = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || lockRef.current || n === 0) return;
    const g = globalFromScrollTop(el.scrollTop);
    const logical = wrapIndex(g, n);
    setCenterGlobal(g);
    emitLogical(logical);
    // Recenter to middle copy so looping stays available.
    const mid = midGlobal(logical);
    if (g !== mid) {
      lockRef.current = true;
      el.scrollTo({ top: scrollTopForGlobal(mid), behavior: "auto" });
      setCenterGlobal(mid);
      window.setTimeout(() => {
        lockRef.current = false;
      }, 40);
    }
  }, [emitLogical, midGlobal, n]);

  const onScroll = () => {
    if (lockRef.current) return;
    const el = scrollerRef.current;
    if (el) setCenterGlobal(globalFromScrollTop(el.scrollTop));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(settle, 100);
  };

  /** One notch at a time; crosses 23→00 / 59→00 without jumping. */
  const stepBy = useCallback(
    (delta: number) => {
      const el = scrollerRef.current;
      const list = valuesRef.current;
      if (!el || lockRef.current || list.length === 0 || delta === 0) return;

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const current = Math.max(0, list.indexOf(valueRef.current));
      const nextLogical = wrapIndex(current + delta, list.length);
      const next = list[nextLogical];
      if (!next) return;

      const fromG = midGlobal(current);
      const toG = fromG + delta; // adjacent copy slot — continuous wrap

      lockRef.current = true;
      el.scrollTo({ top: scrollTopForGlobal(toG), behavior: "smooth" });
      setCenterGlobal(toG);

      window.setTimeout(() => {
        el.scrollTo({ top: scrollTopForGlobal(midGlobal(nextLogical)), behavior: "auto" });
        setCenterGlobal(midGlobal(nextLogical));
        lockRef.current = false;
        if (next !== valueRef.current) onChangeRef.current(next);
      }, 200);
    },
    [midGlobal]
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY === 0 ? 0 : e.deltaY > 0 ? 1 : -1;
      if (direction === 0) return;
      stepBy(direction);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stepBy]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden" style={{ height: VIEW_H }} aria-label={ariaLabel}>
      <div
        ref={scrollerRef}
        className="wheel-picker-column h-full overflow-y-auto overscroll-contain"
        style={{ scrollSnapType: "y mandatory", WebkitOverflowScrolling: "touch" }}
        onScroll={onScroll}
      >
        <div style={{ height: PAD * ITEM_H }} aria-hidden />
        {loopItems.map((v, i) => {
          const logical = i % n;
          const selected = i === centerGlobal;
          return (
            <button
              key={`${v}-${i}`}
              type="button"
              onClick={() => {
                const current = Math.max(0, values.indexOf(value));
                let delta = logical - current;
                if (delta > n / 2) delta -= n;
                if (delta < -n / 2) delta += n;
                if (delta === 0) return;
                stepBy(delta);
              }}
              className={`relative z-[1] flex w-full items-center justify-center text-xl font-semibold tabular-nums transition-colors ${
                selected ? "text-orange-600" : "text-gray-400"
              }`}
              style={{ height: ITEM_H, scrollSnapAlign: "center" }}
            >
              {v}
            </button>
          );
        })}
        <div style={{ height: PAD * ITEM_H }} aria-hidden />
      </div>
    </div>
  );
}

interface WheelTimePickerProps {
  time: string;
  onChange: (time: string) => void;
}

export function WheelTimePicker({ time, onChange }: WheelTimePickerProps) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = String(match ? Math.min(23, Number(match[1])) : 18).padStart(2, "0");
  const minute = String(match ? Math.min(59, Number(match[2])) : 0).padStart(2, "0");

  return (
    <div className="wheel-picker relative select-none overflow-hidden rounded-3xl border border-gray-100 bg-white px-3 py-2 shadow-soft">
      <div className="wheel-picker-band pointer-events-none absolute inset-x-4 top-1/2 z-0 h-10 -translate-y-1/2 rounded-2xl" aria-hidden />

      <div className="relative z-[1] flex">
        <WheelColumn
          values={HOURS}
          value={hour}
          ariaLabel="Часы"
          onChange={(h) => onChange(`${h}:${minute}`)}
        />
        <WheelColumn
          values={MINUTES}
          value={minute}
          ariaLabel="Минуты"
          onChange={(m) => onChange(`${hour}:${m}`)}
        />
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[2] flex -translate-x-1/2 items-center text-2xl font-semibold text-orange-500">
        :
      </div>

      <div className="wheel-picker-fade-top pointer-events-none absolute inset-x-0 top-0 z-[3] h-14" aria-hidden />
      <div className="wheel-picker-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-14" aria-hidden />
    </div>
  );
}
