import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { api } from "../api/client";
import { objectPerm } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import type { NewsPost } from "../types";
import { can as userCan, isRoot } from "../types";
import { formatNewsDateTime, formatNewsWhen } from "../utils/newsDates";

export function NewsDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { user, loading: authLoading, can } = useAuth();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const [item, setItem] = useState<NewsPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    if (Number.isNaN(id)) return;
    setLoading(true);
    setError("");
    api
      .getNews(id)
      .then(({ item: next }) => setItem(next))
      .catch((err: Error) => setError(err.message || "Не удалось открыть"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!user || !can("app.news") || !can(objectPerm("news", "posts", "view"))) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, id]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.news")) return <Navigate to="/" replace />;
  if (Number.isNaN(id)) return <Navigate to="/news" replace />;

  const manageAny = isRoot(user) || userCan(user, "news.manage_any");
  const canEdit =
    Boolean(item) &&
    (manageAny || (item!.author_id === user.id && can("news.edit_own")));
  const canDelete =
    Boolean(item) &&
    (manageAny || (item!.author_id === user.id && can("news.delete_own")));

  const onDelete = async () => {
    if (!item || deleting) return;
    const ok = await confirm({
      title: "Удалить эту новость?",
      description: "Новость исчезнет из ленты у всех. Это действие нельзя отменить.",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteNews(item.id);
      navigate("/news", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-12 pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <HubBackButton />
        <Link
          to="/news"
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
          {(canEdit || canDelete) && (
            <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 sm:right-4 sm:top-4">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => navigate(`/news/${item.id}/edit`)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-soft transition hover:border-[var(--accent-from)] hover:text-[var(--accent-from)]"
                  title="Редактировать"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  disabled={deleting}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-soft transition hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                  title="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          <h1
            className={`mb-4 text-2xl font-bold tracking-tight text-[var(--text-primary)] ${
              canEdit || canDelete ? "pr-14" : ""
            }`}
          >
            {item.title}
          </h1>

          <div
            className="news-body text-[15px] leading-relaxed text-[var(--text-primary)]"
            dangerouslySetInnerHTML={{ __html: item.body_html }}
          />

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

            <div className="mt-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Прочитали
                <span className="ml-1.5 font-normal text-[var(--text-faint)]">
                  ({item.readers_count})
                </span>
              </h2>
              {item.readers.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-faint)]">Пока никто не открыл</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {item.readers.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="font-medium text-[var(--text-primary)]">
                        {r.nickname}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--text-faint)]">
                        {formatNewsWhen(r.read_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </footer>
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </article>
      ) : null}
    </div>
  );
}
