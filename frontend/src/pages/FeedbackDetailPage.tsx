import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Pencil, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { HubBackButton } from "../components/HubBackButton";
import { CheckboxIndicator } from "../components/CheckboxIndicator";
import type { FeedbackBatch, FeedbackItem } from "../types";
import { formatNewsDateTime, formatNewsWhen } from "../utils/newsDates";

function asNewsBodyHtml(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return `<p>${value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")}</p>`;
}

type ReviewDraft = {
  admin_done: boolean;
  admin_comment: string;
};

function draftsFromBatch(batch: FeedbackBatch): Record<number, ReviewDraft> {
  const next: Record<number, ReviewDraft> = {};
  for (const entry of batch.items) {
    next[entry.id] = {
      admin_done: Boolean(entry.admin_done),
      admin_comment: entry.admin_comment ?? "",
    };
  }
  return next;
}

export function FeedbackDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { user, loading: authLoading, can } = useAuth();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const [item, setItem] = useState<FeedbackBatch | null>(null);
  const [drafts, setDrafts] = useState<Record<number, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const isAdmin = can("app.administration");

  const load = useCallback(() => {
    if (Number.isNaN(id)) return;
    setLoading(true);
    setError("");
    api
      .getFeedback(id)
      .then(({ item: next }) => {
        setItem(next);
        setDrafts(draftsFromBatch(next));
      })
      .catch((err: Error) => setError(err.message || "Не удалось открыть"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (Number.isNaN(id)) return <Navigate to="/profile/feedback" replace />;

  const canEdit =
    Boolean(item) &&
    (item!.author_id === user.id || can("app.administration"));

  const onDelete = async () => {
    if (!item || deleting) return;
    const ok = await confirm({
      title: "Удалить это обращение?",
      description: "Оно исчезнет из ленты у всех. Это действие нельзя отменить.",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteFeedback(item.id);
      navigate("/profile/feedback", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setDeleting(false);
    }
  };

  const saveReview = async (entry: FeedbackItem, patch: Partial<ReviewDraft>) => {
    if (!item || !isAdmin) return;
    const current = drafts[entry.id] ?? {
      admin_done: entry.admin_done,
      admin_comment: entry.admin_comment ?? "",
    };
    const nextDraft = { ...current, ...patch };
    setDrafts((prev) => ({ ...prev, [entry.id]: nextDraft }));
    setSavingId(entry.id);
    setError("");
    try {
      const { item: updated } = await api.updateFeedbackReview(item.id, [
        {
          id: entry.id,
          admin_done: nextDraft.admin_done,
          admin_comment: nextDraft.admin_comment,
        },
      ]);
      setItem(updated);
      setDrafts(draftsFromBatch(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
      setDrafts(draftsFromBatch(item));
    } finally {
      setSavingId(null);
    }
  };

  const heading =
    item?.items.length === 1
      ? item.items[0]!.title
      : item
        ? `Обращение · ${item.items.length} п.`
        : "";

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-12 pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <HubBackButton />
        <Link
          to="/profile/feedback"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-soft transition hover:text-[var(--accent-from)]"
        >
          <ArrowLeft className="h-4 w-4" />
          К ленте
        </Link>
      </div>

      {loading ? (
        <p className="py-16 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : error && !item ? (
        <p className="py-16 text-center text-red-500">{error}</p>
      ) : item ? (
        <article className="relative rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-6 shadow-soft sm:px-7">
          {canEdit && (
            <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 sm:right-4 sm:top-4">
              <button
                type="button"
                onClick={() => navigate(`/profile/feedback/${item.id}/edit`)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-soft transition hover:border-[var(--accent-from)] hover:text-[var(--accent-from)]"
                title="Редактировать"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                disabled={deleting}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-soft transition hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}

          <h1
            className={`mb-5 text-2xl font-bold tracking-tight text-[var(--text-primary)] ${
              canEdit ? "pr-14" : ""
            }`}
          >
            {heading}
          </h1>

          <div className="space-y-6">
            {item.items.map((entry) => {
              const draft = drafts[entry.id] ?? {
                admin_done: Boolean(entry.admin_done),
                admin_comment: entry.admin_comment ?? "",
              };
              const dirtyComment =
                draft.admin_comment.trim() !==
                (entry.admin_comment ?? "").trim();
              return (
                <section key={entry.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        entry.kind === "problem"
                          ? "bg-red-500/15 text-red-600"
                          : "bg-emerald-500/15 text-emerald-700"
                      }`}
                    >
                      {entry.kind === "problem" ? "Проблема" : "Улучшение"}
                    </span>
                    {entry.admin_done && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                        <Check className="h-3 w-3" />
                        Обработано
                      </span>
                    )}
                  </div>
                  {item.items.length > 1 && (
                    <h2 className="mb-2 text-xl font-bold tracking-tight text-[var(--text-primary)]">
                      {entry.title}
                    </h2>
                  )}
                  <div
                    className="news-body text-[15px] leading-relaxed text-[var(--text-primary)]"
                    dangerouslySetInnerHTML={{
                      __html: asNewsBodyHtml(entry.description),
                    }}
                  />

                  {isAdmin ? (
                    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3">
                      <label
                        className={`flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-soft transition ${
                          savingId === entry.id
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer hover:border-[var(--accent-from)]"
                        }`}
                      >
                        <CheckboxIndicator checked={draft.admin_done} />
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draft.admin_done}
                          disabled={savingId === entry.id}
                          onChange={(e) =>
                            void saveReview(entry, {
                              admin_done: e.target.checked,
                            })
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium text-[var(--text-primary)]">
                            Принято / сделано
                          </span>
                          <span className="block text-xs text-[var(--text-muted)]">
                            Отметьте, если информация принята или пункт выполнен
                          </span>
                        </span>
                      </label>
                      <label className="mt-3 block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                          Комментарий администратора
                        </span>
                        <textarea
                          value={draft.admin_comment}
                          rows={3}
                          disabled={savingId === entry.id}
                          placeholder="Например: исправим в ближайшем обновлении"
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [entry.id]: {
                                ...draft,
                                admin_comment: e.target.value,
                              },
                            }))
                          }
                          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-from)]"
                        />
                      </label>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        {savingId === entry.id && (
                          <span className="text-xs text-[var(--text-faint)]">
                            Сохранение…
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={savingId === entry.id || !dirtyComment}
                          onClick={() =>
                            void saveReview(entry, {
                              admin_comment: draft.admin_comment,
                            })
                          }
                          className="rounded-xl gradient-accent px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition enabled:hover:opacity-95 disabled:opacity-40"
                        >
                          Сохранить комментарий
                        </button>
                      </div>
                    </div>
                  ) : entry.admin_done || (entry.admin_comment ?? "").trim() ? (
                    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3">
                      {entry.admin_done && (
                        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700">
                          <Check className="h-4 w-4" />
                          Обработано администратором
                        </p>
                      )}
                      {(entry.admin_comment ?? "").trim() && (
                        <p
                          className={`whitespace-pre-wrap text-sm text-[var(--text-secondary)] ${
                            entry.admin_done ? "mt-2" : ""
                          }`}
                        >
                          {(entry.admin_comment ?? "").trim()}
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

          <footer className="mt-8 border-t border-[var(--border)] pt-4">
            <p className="text-sm text-[var(--text-muted)]">
              Опубликовал{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {item.author.nickname}
              </span>
              {" · "}
              {formatNewsDateTime(item.created_at)}
              {item.updated_at !== item.created_at && (
                <>
                  {" · "}
                  изм. {formatNewsWhen(item.updated_at)}
                </>
              )}
            </p>
          </footer>
        </article>
      ) : null}
    </div>
  );
}
