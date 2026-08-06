import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Trash2, type LucideIcon } from "lucide-react";

export type AppDialogVariant = "danger" | "accent" | "info";

export interface AppDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When false, only the primary button is shown (alert). */
  showCancel?: boolean;
  loading?: boolean;
  variant?: AppDialogVariant;
  icon?: LucideIcon;
  preview?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_STYLES: Record<
  AppDialogVariant,
  { iconWrap: string; confirmBtn: string; Icon: LucideIcon }
> = {
  danger: {
    Icon: Trash2,
    iconWrap:
      "bg-gradient-to-br from-red-500 to-orange-500 shadow-[0_12px_28px_rgba(239,68,68,0.35)]",
    confirmBtn:
      "bg-gradient-to-r from-red-500 to-orange-500 shadow-[0_8px_20px_rgba(239,68,68,0.3)]",
  },
  accent: {
    Icon: CheckCircle2,
    iconWrap:
      "bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] shadow-[0_12px_28px_color-mix(in_srgb,var(--accent-from)_40%,transparent)]",
    confirmBtn:
      "bg-gradient-to-r from-[var(--accent-from)] to-[var(--accent-to)] shadow-[0_8px_20px_color-mix(in_srgb,var(--accent-from)_35%,transparent)]",
  },
  info: {
    Icon: AlertCircle,
    iconWrap:
      "bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] shadow-[0_12px_28px_color-mix(in_srgb,var(--accent-from)_40%,transparent)]",
    confirmBtn:
      "bg-gradient-to-r from-[var(--accent-from)] to-[var(--accent-to)] shadow-[0_8px_20px_color-mix(in_srgb,var(--accent-from)_35%,transparent)]",
  },
};

export function AppDialog({
  open,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Отмена",
  showCancel = true,
  loading = false,
  variant = "accent",
  icon,
  preview,
  onConfirm,
  onCancel,
}: AppDialogProps) {
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const descId = useId();
  const style = VARIANT_STYLES[variant];
  const Icon = icon ?? style.Icon;

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <button
        type="button"
        className={`absolute inset-0 bg-[var(--modal-scrim)] transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => !loading && onCancel()}
        aria-label={showCancel ? "Отмена" : "Закрыть"}
      />

      <div
        className={`confirm-delete-panel relative mb-0 w-full max-w-md overflow-hidden rounded-t-[1.75rem] bg-[var(--surface)] shadow-soft sm:mb-0 sm:rounded-[1.75rem] ${
          visible ? "confirm-delete-panel--in" : ""
        }`}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[color-mix(in_srgb,var(--accent-from)_12%,transparent)] blur-2xl" />
        <div className="pointer-events-none absolute -left-8 top-16 h-28 w-28 rounded-full bg-[color-mix(in_srgb,var(--accent-to)_10%,transparent)] blur-2xl" />

        <div className="relative px-6 pb-6 pt-7 text-center sm:px-8">
          <div
            className={`confirm-delete-icon mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-white ${style.iconWrap}`}
          >
            <Icon className="h-7 w-7" strokeWidth={2.25} />
          </div>

          <h2
            id={titleId}
            className="text-xl font-semibold tracking-tight text-[var(--text-primary)]"
          >
            {title}
          </h2>

          {preview && (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-left">
              {preview}
            </div>
          )}

          {description && (
            <p
              id={descId}
              className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]"
            >
              {description}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:gap-3">
            {showCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition hover:brightness-105 active:scale-[0.98] disabled:opacity-60 ${style.confirmBtn}`}
            >
              {loading ? "Подождите..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
