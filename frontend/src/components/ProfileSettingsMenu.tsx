import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  KeyRound,
  Palette,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { THEMES, useTheme, type ThemeId } from "../context/ThemeContext";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { api } from "../api/client";
import {
  getExistingSubscription,
  isPushSupported,
  isSecureForPush,
  subscribeToPush,
  subscriptionToJson,
  unsubscribeFromPush,
} from "../lib/push";

type PushStatus = "loading" | "unsupported" | "insecure" | "off" | "on" | "busy";

/** Theme, notifications and password — profile header settings menu. */
export function ProfileSettingsMenu() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("loading");
  const [hint, setHint] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!isPushSupported()) {
        if (!cancelled) setPushStatus("unsupported");
        return;
      }
      if (!isSecureForPush()) {
        if (!cancelled) setPushStatus("insecure");
        return;
      }
      try {
        const sub = await getExistingSubscription();
        if (!cancelled) setPushStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setPushStatus("off");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setThemeOpen(false);
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
  }, [open]);

  const showHint = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(null), 3500);
  };

  const togglePush = async () => {
    if (pushStatus === "busy" || pushStatus === "loading") return;
    if (pushStatus === "unsupported") {
      showHint("Браузер не поддерживает пуш-уведомления");
      return;
    }
    if (pushStatus === "insecure") {
      showHint("Нужен HTTPS — без него Android не даёт пуши");
      return;
    }
    setPushStatus("busy");
    try {
      if (pushStatus === "on") {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await api.unsubscribePush(endpoint);
        setPushStatus("off");
        showHint("Пуш-уведомления выключены");
        return;
      }
      const { publicKey } = await api.getVapidPublicKey();
      const sub = await subscribeToPush(publicKey);
      await api.subscribePush(subscriptionToJson(sub));
      try {
        await api.testPush();
      } catch {
        /* ok */
      }
      setPushStatus("on");
      showHint("Пуш включены — проверьте уведомление");
    } catch (err) {
      setPushStatus("off");
      showHint(err instanceof Error ? err.message : "Не удалось включить пуш");
    }
  };

  const PushIcon =
    pushStatus === "on"
      ? BellRing
      : pushStatus === "insecure" || pushStatus === "unsupported"
        ? BellOff
        : Bell;

  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface-muted)]";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setThemeOpen(false);
        }}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] shadow-soft transition hover:text-[var(--accent-from)]"
        aria-label="Настройки профиля"
        aria-expanded={open}
        title="Настройки"
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1.5 shadow-soft">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
            Настройки
          </p>

          <button type="button" onClick={() => setThemeOpen((v) => !v)} className={itemClass}>
            <Palette className="h-4 w-4 shrink-0 text-[var(--accent-from)]" />
            <span className="min-w-0 flex-1 font-medium">Тема</span>
            <span className="text-xs text-[var(--text-faint)]">
              {THEMES.find((t) => t.id === theme)?.label}
            </span>
          </button>

          {themeOpen && (
            <div className="border-y border-[var(--border)] bg-[var(--surface-muted)] py-1">
              {THEMES.map((item) => {
                const active = theme === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTheme(item.id as ThemeId);
                      setThemeOpen(false);
                    }}
                    className={`${itemClass} ${active ? "text-[var(--accent-from)]" : ""}`}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white shadow"
                      style={{
                        backgroundColor: item.swatch,
                        boxShadow: `0 0 0 1px ${item.swatch}`,
                      }}
                    />
                    <span className="min-w-0 flex-1 font-medium">{item.label}</span>
                    {active && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--accent-from)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => void togglePush()}
            disabled={pushStatus === "busy" || pushStatus === "loading"}
            className={`${itemClass} disabled:opacity-60`}
          >
            <PushIcon
              className={`h-4 w-4 shrink-0 ${
                pushStatus === "on" ? "text-[var(--accent-from)]" : ""
              }`}
            />
            <span className="min-w-0 flex-1 font-medium">
              {pushStatus === "on" ? "Уведомления вкл." : "Уведомления"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/settings/notifications");
            }}
            className={itemClass}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--accent-from)]" />
            <span className="min-w-0 flex-1 font-medium">Настройки уведомлений</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
            className={itemClass}
          >
            <KeyRound className="h-4 w-4 shrink-0 text-[var(--accent-from)]" />
            <span className="min-w-0 flex-1 font-medium">Сменить пароль</span>
          </button>
        </div>
      )}

      {hint && (
        <div className="absolute right-0 top-12 z-[60] w-56 rounded-xl bg-gray-900 px-3 py-2 text-xs leading-snug text-white shadow-soft">
          {hint}
        </div>
      )}

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
