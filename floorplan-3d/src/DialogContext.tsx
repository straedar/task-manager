import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "accent" | "info";
};

export type AlertOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "danger" | "accent" | "info";
};

export type PromptOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "accent" | "info";
};

type DialogApi = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string) => Promise<void>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

type PendingConfirm = {
  kind: "confirm";
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type PendingAlert = {
  kind: "alert";
  options: AlertOptions;
  resolve: () => void;
};

type PendingPrompt = {
  kind: "prompt";
  options: PromptOptions;
  resolve: (value: string | null) => void;
};

type Pending = PendingConfirm | PendingAlert | PendingPrompt | null;

const DialogContext = createContext<DialogApi | null>(null);

function normalizeConfirm(options: ConfirmOptions | string): ConfirmOptions {
  if (typeof options === "string") {
    return { title: options, variant: "danger", confirmLabel: "Удалить" };
  }
  return { variant: "danger", confirmLabel: "Удалить", ...options };
}

function normalizeAlert(options: AlertOptions | string): AlertOptions {
  if (typeof options === "string") {
    return { title: options, variant: "info", confirmLabel: "Понятно" };
  }
  return { variant: "info", confirmLabel: "Понятно", ...options };
}

function AppDialogView({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Отмена",
  showCancel,
  variant = "danger",
  onConfirm,
  onCancel,
  input,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  showCancel: boolean;
  variant?: "danger" | "accent" | "info";
  onConfirm: () => void;
  onCancel: () => void;
  input?: {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  };
}) {
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const descId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Только при открытии: иначе каждый onChange создаёт новый `input`-объект,
  // эффект снова вызывает select() и затирает набор одной буквой.
  const hasInput = Boolean(input);
  useEffect(() => {
    if (!open || !hasInput) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(t);
  }, [open, hasInput]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return createPortal(
    <div
      className={`tm-dialog ${visible ? "tm-dialog--in" : ""}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <button
        type="button"
        className="tm-dialog__scrim"
        onClick={onCancel}
        aria-label={showCancel ? "Отмена" : "Закрыть"}
      />
      <div className={`tm-dialog__panel tm-dialog__panel--${variant}`}>
        <div className={`tm-dialog__icon tm-dialog__icon--${variant}`} aria-hidden>
          {variant === "danger" ? (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <path
                d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path
                d="M12 8v5M12 16.5h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
        <h2 id={titleId} className="tm-dialog__title">
          {title}
        </h2>
        {description && (
          <p id={descId} className="tm-dialog__desc">
            {description}
          </p>
        )}
        {input && (
          <label className="tm-dialog__field" htmlFor={inputId}>
            <span className="sr-only">Значение</span>
            <input
              ref={inputRef}
              id={inputId}
              value={input.value}
              placeholder={input.placeholder}
              onChange={(e) => input.onChange(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}
        <div className="tm-dialog__actions">
          {showCancel && (
            <button type="button" className="tm-dialog__btn tm-dialog__btn--ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`tm-dialog__btn tm-dialog__btn--primary tm-dialog__btn--${variant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null);
  const [promptValue, setPromptValue] = useState("");
  const pendingRef = useRef<Pending>(null);
  pendingRef.current = pending;

  const confirm = useCallback((options: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", options: normalizeConfirm(options), resolve });
    });
  }, []);

  const alert = useCallback((options: AlertOptions | string) => {
    return new Promise<void>((resolve) => {
      setPending({ kind: "alert", options: normalizeAlert(options), resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue ?? "");
      setPending({ kind: "prompt", options, resolve });
    });
  }, []);

  const api = useMemo(() => ({ confirm, alert, prompt }), [confirm, alert, prompt]);

  const closeConfirm = (value: boolean) => {
    const current = pendingRef.current;
    if (!current || current.kind !== "confirm") return;
    current.resolve(value);
    setPending(null);
  };

  const closeAlert = () => {
    const current = pendingRef.current;
    if (!current || current.kind !== "alert") return;
    current.resolve();
    setPending(null);
  };

  const closePrompt = (value: string | null) => {
    const current = pendingRef.current;
    if (!current || current.kind !== "prompt") return;
    current.resolve(value);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending?.kind === "confirm" && (
        <AppDialogView
          open
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel ?? "Удалить"}
          cancelLabel={pending.options.cancelLabel}
          variant={pending.options.variant ?? "danger"}
          showCancel
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      )}
      {pending?.kind === "alert" && (
        <AppDialogView
          open
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel ?? "Понятно"}
          variant={pending.options.variant ?? "info"}
          showCancel={false}
          onConfirm={closeAlert}
          onCancel={closeAlert}
        />
      )}
      {pending?.kind === "prompt" && (
        <AppDialogView
          open
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel ?? "Сохранить"}
          cancelLabel={pending.options.cancelLabel ?? "Отмена"}
          variant={pending.options.variant ?? "accent"}
          showCancel
          input={{
            value: promptValue,
            placeholder: pending.options.placeholder,
            onChange: setPromptValue,
          }}
          onConfirm={() => closePrompt(promptValue)}
          onCancel={() => closePrompt(null)}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}
