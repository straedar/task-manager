import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppDialog, type AppDialogVariant } from "../components/AppDialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: AppDialogVariant;
};

export type AlertOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: AppDialogVariant;
};

type DialogApi = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string) => Promise<void>;
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

type Pending = PendingConfirm | PendingAlert | null;

const DialogContext = createContext<DialogApi | null>(null);

function normalizeConfirm(options: ConfirmOptions | string): ConfirmOptions {
  if (typeof options === "string") {
    return { title: options, variant: "danger", confirmLabel: "Удалить" };
  }
  return {
    variant: "danger",
    confirmLabel: "Удалить",
    ...options,
  };
}

function normalizeAlert(options: AlertOptions | string): AlertOptions {
  if (typeof options === "string") {
    return { title: options, variant: "info", confirmLabel: "Понятно" };
  }
  return {
    variant: "info",
    confirmLabel: "Понятно",
    ...options,
  };
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null);
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

  const api = useMemo(() => ({ confirm, alert }), [confirm, alert]);

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

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending?.kind === "confirm" && (
        <AppDialog
          open
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel}
          cancelLabel={pending.options.cancelLabel}
          variant={pending.options.variant ?? "danger"}
          showCancel
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      )}
      {pending?.kind === "alert" && (
        <AppDialog
          open
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel}
          variant={pending.options.variant ?? "info"}
          showCancel={false}
          onConfirm={closeAlert}
          onCancel={closeAlert}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within DialogProvider");
  }
  return ctx;
}
