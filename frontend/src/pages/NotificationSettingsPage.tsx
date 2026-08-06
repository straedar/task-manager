import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Bell, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { HubBackButton } from "../components/HubBackButton";
import { ThemeSwitch } from "../components/ThemeSwitch";
import type { NotifPrefs } from "../types";

type ToggleRow = {
  key: keyof NotifPrefs;
  label: string;
  hint?: string;
  disabled?: boolean;
};

const CHANNELS: ToggleRow[] = [
  { key: "channel_tasks", label: "Задачи" },
  { key: "channel_news", label: "Новости" },
  { key: "channel_orders", label: "Заказы с производства", hint: "Скоро", disabled: true },
  { key: "channel_reference", label: "Справочник", hint: "Пока без пушей", disabled: true },
  { key: "channel_stockmap", label: "Карта склада", hint: "Пока без пушей", disabled: true },
];

const TASK_EVENTS: ToggleRow[] = [
  { key: "task_assigned", label: "Назначили задачу мне" },
  { key: "task_changed", label: "Изменили задачу (срок, приоритет, текст)" },
  { key: "task_assignee_done", label: "Исполнитель отметил готовность (постановщику)" },
  { key: "task_fully_done", label: "Задача полностью выполнена (постановщику)" },
  { key: "task_remind_1h", label: "Напоминание за час до срока" },
  { key: "task_remind_morning", label: "Утреннее напоминание о задачах на сегодня" },
  { key: "task_overdue", label: "Просрочка" },
  {
    key: "task_comments",
    label: "Комментарии и упоминания",
    hint: "Когда появятся комментарии",
    disabled: true,
  },
];

const NEWS_EVENTS: ToggleRow[] = [
  { key: "news_any", label: "Любая новая новость (кроме своих)" },
];

function Section({
  title,
  rows,
  prefs,
  onToggle,
  gated,
}: {
  title: string;
  rows: ToggleRow[];
  prefs: NotifPrefs;
  onToggle: (key: keyof NotifPrefs, value: boolean) => void;
  gated?: boolean;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      <div
        className={`space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-2 py-1 ${
          gated ? "opacity-45" : ""
        }`}
      >
        {rows.map((row) => (
          <ThemeSwitch
            key={row.key}
            id={`notif-${row.key}`}
            checked={prefs[row.key]}
            label={row.hint ? `${row.label} · ${row.hint}` : row.label}
            onChange={() => {
              if (row.disabled || gated) return;
              onToggle(row.key, !prefs[row.key]);
            }}
          />
        ))}
      </div>
    </section>
  );
}

export function NotificationSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [meta, setMeta] = useState<{ quiet_hours: string; weekend: string; low_priority: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .getNotificationPrefs()
      .then((res) => {
        if (cancelled) return;
        setPrefs(res.prefs);
        setMeta(res.meta);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onToggle = async (key: keyof NotifPrefs, value: boolean) => {
    if (!prefs || saving) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    setError("");
    try {
      const res = await api.updateNotificationPrefs({ [key]: value });
      setPrefs(res.prefs);
    } catch (err) {
      setPrefs(prefs);
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-12 pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <HubBackButton />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-secondary)] shadow-soft"
        >
          Назад
        </button>
      </div>

      <header className="mb-5 flex items-center gap-2.5">
        <Bell className="h-7 w-7 text-[var(--accent-from)]" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Уведомления
          </h1>
          <p className="text-sm text-[var(--text-muted)]">Что присылать на это устройство</p>
        </div>
      </header>

      {meta && (
        <div className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          <p className="mb-1 flex items-start gap-1.5">
            <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {meta.quiet_hours}
          </p>
          <p className="mb-1">{meta.weekend}</p>
          <p>{meta.low_priority}</p>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {!prefs ? (
        <p className="py-10 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : (
        <>
          <Section title="Мини-приложения" rows={CHANNELS} prefs={prefs} onToggle={onToggle} />
          <Section
            title="Задачи"
            rows={TASK_EVENTS}
            prefs={prefs}
            onToggle={onToggle}
            gated={!prefs.channel_tasks}
          />
          <Section
            title="Новости"
            rows={NEWS_EVENTS}
            prefs={prefs}
            onToggle={onToggle}
            gated={!prefs.channel_news}
          />
        </>
      )}
    </div>
  );
}
