import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { HubBackButton } from "../components/HubBackButton";
import { NewsRichEditor } from "../components/NewsRichEditor";
import type { FeedbackItemInput, FeedbackKind } from "../types";

type DraftRow = FeedbackItemInput & { key: string };

function blankRow(kind: FeedbackKind = "problem"): DraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: "",
    description: "<p></p>",
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|ul|ol)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function FeedbackEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const isNew = !idParam;
  const editId = idParam ? Number(idParam) : NaN;
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isNew || Number.isNaN(editId) || !user) return;
    let cancelled = false;
    setLoading(true);
    api
      .getFeedback(editId)
      .then(({ item }) => {
        if (cancelled) return;
        setAuthorId(item.author_id);
        setRows(
          item.items.length > 0
            ? item.items.map((entry) => ({
                key: `edit-${entry.id}`,
                kind: entry.kind,
                title: entry.title,
                description: entry.description?.trim()
                  ? /<[a-z][\s\S]*>/i.test(entry.description)
                    ? entry.description
                    : `<p>${entry.description}</p>`
                  : "<p></p>",
              }))
            : [blankRow()]
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, editId, user]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (!isNew) {
    if (Number.isNaN(editId)) return <Navigate to="/profile/feedback" replace />;
    if (!loading && authorId != null) {
      const allowed =
        authorId === user.id || can("app.administration");
      if (!allowed) {
        return <Navigate to={`/profile/feedback/${editId}`} replace />;
      }
    }
  }

  const updateRow = (key: string, patch: Partial<FeedbackItemInput>) => {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const items = rows.map(({ kind, title, description }) => ({
      kind,
      title: title.trim(),
      description,
    }));
    if (items.some((item) => !item.title || !stripHtml(item.description))) {
      setError("Заполните название и текст у каждого пункта");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isNew) {
        const { item } = await api.createFeedback(items);
        navigate(`/profile/feedback/${item.id}`, { replace: true });
      } else {
        const { item } = await api.updateFeedback(editId, items);
        navigate(`/profile/feedback/${item.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-12 pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <HubBackButton />
        <Link
          to={isNew ? "/profile/feedback" : `/profile/feedback/${editId}`}
          className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-soft"
        >
          Отмена
        </Link>
      </div>

      <h1 className="mb-5 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
        {isNew ? "Новое обращение" : "Редактирование"}
      </h1>

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-soft"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1 rounded-xl bg-[var(--surface-muted)] p-1">
                  <button
                    type="button"
                    onClick={() => updateRow(row.key, { kind: "problem" })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      row.kind === "problem"
                        ? "bg-red-500 text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    Проблема
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRow(row.key, { kind: "improvement" })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      row.kind === "improvement"
                        ? "bg-emerald-500 text-white"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    Улучшение
                  </button>
                </div>
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() =>
                    setRows((prev) =>
                      prev.length <= 1
                        ? prev
                        : prev.filter((r) => r.key !== row.key)
                    )
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-faint)] hover:bg-[var(--surface-muted)] hover:text-red-500 disabled:opacity-30"
                  aria-label={`Удалить пункт ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
                  Заголовок
                </span>
                <input
                  value={row.title}
                  onChange={(e) => updateRow(row.key, { title: e.target.value })}
                  maxLength={200}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--text-primary)] outline-none ring-orange-400/30 focus:ring-2"
                  placeholder={
                    row.kind === "problem"
                      ? "О чём проблема"
                      : "О чём предложение"
                  }
                />
              </label>

              <div>
                <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
                  Текст
                </span>
                <NewsRichEditor
                  key={row.key}
                  value={row.description}
                  onChange={(html) => updateRow(row.key, { description: html })}
                  placeholder="Текст… Можно выделить жирным и списками"
                  disabled={saving}
                />
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, blankRow("problem")])}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:border-red-300 hover:text-red-600"
            >
              <Plus className="h-4 w-4" />
              Проблема
            </button>
            <button
              type="button"
              onClick={() =>
                setRows((prev) => [...prev, blankRow("improvement")])
              }
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:border-emerald-300 hover:text-emerald-600"
            >
              <Plus className="h-4 w-4" />
              Улучшение
            </button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-2xl gradient-accent px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : isNew ? "Опубликовать" : "Сохранить"}
          </button>
        </form>
      )}
    </div>
  );
}
