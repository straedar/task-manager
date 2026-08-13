import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { MessageSquareWarning, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { HubBackButton } from "../components/HubBackButton";
import type { FeedbackBatch } from "../types";
import { formatNewsWhen } from "../utils/newsDates";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|ul|ol)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function batchTitle(batch: FeedbackBatch): string {
  const first = batch.items[0];
  if (!first) return "Обращение";
  if (batch.items.length === 1) return first.title;
  return `${first.title} · ещё ${batch.items.length - 1}`;
}

function batchExcerpt(batch: FeedbackBatch): string {
  const first = batch.items[0];
  if (!first) return "";
  const text = stripHtml(first.description);
  if (text.length <= 160) return text;
  return `${text.slice(0, 159).trimEnd()}…`;
}

export function FeedbackPage() {
  const { userId: userIdParam } = useParams<{ userId?: string }>();
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();

  const filterAuthorId = userIdParam ? Number(userIdParam) : null;
  const viewingOther =
    filterAuthorId != null &&
    Number.isInteger(filterAuthorId) &&
    filterAuthorId > 0 &&
    filterAuthorId !== user?.id;

  const [feedback, setFeedback] = useState<FeedbackBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const req = viewingOther
      ? api.listFeedback(filterAuthorId!)
      : api.listFeedback();
    req
      .then(({ items }) => setFeedback(items))
      .catch((err: Error) =>
        setError(err.message || "Не удалось загрузить обращения")
      )
      .finally(() => setLoading(false));
  }, [viewingOther, filterAuthorId]);

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

  if (
    userIdParam &&
    (!Number.isInteger(Number(userIdParam)) || Number(userIdParam) < 1)
  ) {
    return <Navigate to="/profile/feedback" replace />;
  }

  if (viewingOther && !can("app.structure")) {
    return <Navigate to="/profile/feedback" replace />;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-10 pt-4">
      <header className="mb-6">
        <div className="mb-3">
          <HubBackButton />
        </div>
        <div className="flex items-center gap-2.5">
          <MessageSquareWarning className="h-7 w-7 shrink-0 text-[var(--accent-from)]" />
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Проблемы и улучшения
          </h1>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {viewingOther
            ? "Обращения этого сотрудника"
            : "Лента проблем и предложений команды"}
        </p>
      </header>

      {!viewingOther && (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => navigate("/profile/feedback/new")}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl gradient-accent px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" />
            Сообщить о проблеме / улучшении
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : feedback.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-[var(--text-muted)]">
          Пока нет обращений
        </p>
      ) : (
        <ul className="space-y-3">
          {feedback.map((batch) => {
            const kinds = new Set(batch.items.map((i) => i.kind));
            const kindLabel =
              kinds.size === 2
                ? "Проблема и улучшение"
                : kinds.has("problem")
                  ? "Проблема"
                  : "Улучшение";
            return (
              <li key={batch.id}>
                <Link
                  to={`/profile/feedback/${batch.id}`}
                  className="news-card block rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-soft transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                      {batchTitle(batch)}
                    </h2>
                    <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {kindLabel}
                      </span>
                      {batch.items.every((i) => i.admin_done) ? (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                          Обработано
                        </span>
                      ) : batch.items.some((i) => i.admin_done) ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Частично
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {batchExcerpt(batch) && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-[var(--text-secondary)]">
                      {batchExcerpt(batch)}
                    </p>
                  )}
                  <p className="mt-2.5 text-xs text-[var(--text-faint)]">
                    {batch.author.nickname}
                    {" · "}
                    {formatNewsWhen(batch.created_at)}
                    {batch.items.length > 1
                      ? ` · пунктов: ${batch.items.length}`
                      : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
