import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Crown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  depth?: number;
  isRoot?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showAvatar?: boolean;
  /** Prefer opening up when there isn't room below (default: always down). */
  dropdownPlacement?: "down" | "up" | "auto";
  /** Extra controls on the right of an option (edit/delete). Click stops selection. */
  renderOptionActions?: (opt: SelectOption, ctx: { close: () => void }) => ReactNode;
}

function OptionAvatar({ isRoot, label }: { isRoot?: boolean; label: string }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${
        isRoot ? "gradient-accent text-white" : "bg-orange-50 text-orange-500"
      }`}
    >
      {isRoot ? <Crown className="h-4 w-4" /> : label.charAt(0).toUpperCase()}
    </span>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Выберите...",
  disabled,
  className = "",
  showAvatar = true,
  dropdownPlacement = "down",
  renderOptionActions,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.value === value);

  useLayoutEffect(() => {
    if (!open || dropdownPlacement === "down") {
      setOpenUp(false);
      return;
    }
    if (dropdownPlacement === "up") {
      setOpenUp(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const needed = 260;
    setOpenUp(spaceBelow < needed && spaceAbove > spaceBelow);
  }, [open, dropdownPlacement, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? "border-orange-400 ring-2 ring-orange-100"
            : "border-gray-200 hover:border-orange-200"
        }`}
      >
        {selected ? (
          <>
            {showAvatar && <OptionAvatar isRoot={selected.isRoot} label={selected.label} />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
              {selected.label}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-gray-400">{placeholder}</span>
        )}
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 z-50 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-soft ${
            openUp ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.5rem)]"
          }`}
        >
          <ul className="max-h-60 overflow-y-auto p-1.5">
            {options.map((opt) => {
              const isSelected = value === opt.value;
              const depth = opt.depth ?? 0;
              const actions = renderOptionActions?.(opt, { close: () => setOpen(false) });

              return (
                <li key={opt.value}>
                  <div
                    className={`flex w-full items-center gap-1 rounded-xl transition ${
                      isSelected
                        ? "bg-orange-50 text-orange-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    style={{ paddingLeft: `${12 + depth * 18}px` }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-1 text-left text-sm"
                    >
                      {showAvatar && <OptionAvatar isRoot={opt.isRoot} label={opt.label} />}
                      <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                      {isSelected && !actions && (
                        <Check className="h-4 w-4 shrink-0 text-orange-500" />
                      )}
                    </button>
                    {actions && (
                      <div className="flex shrink-0 items-center gap-0.5 py-1 pr-2">{actions}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
