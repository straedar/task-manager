import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { THEMES, useTheme, type ThemeId } from "../context/ThemeContext";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const pick = (id: ThemeId) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-500 shadow-soft transition hover:text-orange-500"
        aria-label="Тема оформления"
        aria-expanded={open}
        title="Тема"
      >
        <Palette className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-soft">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Тема
          </p>
          {THEMES.map((item) => {
            const active = theme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-orange-50 ${
                  active ? "text-orange-600" : "text-gray-800"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: item.swatch, boxShadow: `0 0 0 1px ${item.swatch}` }}
                />
                <span className="min-w-0 flex-1 font-medium">{item.label}</span>
                {active && <Check className="h-4 w-4 shrink-0 text-orange-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
