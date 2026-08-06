import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Newspaper, Plus, Rocket } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { objectPerm } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import type { NewsPostListItem } from "../types";
import { can as userCan, isRoot } from "../types";
import { formatNewsWhen } from "../utils/newsDates";

export function NewsFeedPage() {
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<NewsPostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canView = can(objectPerm("news", "posts", "view"));
  const canCreate = can(objectPerm("news", "posts", "create"));
  const canRelease =
    Boolean(user) &&
    (isRoot(user!) ||
      userCan(user!, "news.release_patch") ||
      userCan(user!, "news.manage_any"));

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listNews()
      .then(({ items: next }) => setItems(next))
      .catch((err: Error) => setError(err.message || "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user || !can("app.news") || !canView) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canView]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.news")) return <Navigate to="/" replace />;
  if (!canView) {
    return (
      <div className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
        <HubBackButton />
        <p className="mt-8 text-center text-[var(--text-muted)]">Нет доступа к новостям</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-10 pt-4">
      <header className="mb-6">
        <div className="mb-3">
          <HubBackButton />
        </div>
        <div className="flex items-center gap-2.5">
          <Newspaper className="h-7 w-7 shrink-0 text-[var(--accent-from)]" />
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Новости
          </h1>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Лента объявлений команды</p>
      </header>

      <div className="mb-5 flex flex-col gap-2.5">
        {canRelease && (
          <button
            type="button"
            onClick={() => navigate("/news/new?patch=1")}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-soft transition hover:opacity-95"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-from) 40%, var(--border))",
              background: "color-mix(in srgb, var(--accent-from) 10%, var(--surface))",
              color: "var(--accent-from)",
            }}
          >
            <Rocket className="h-4 w-4" />
            Выпустить патчноут
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => navigate("/news/new")}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl gradient-accent px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" />
            Написать новость
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-[var(--text-muted)]">
          Пока нет новостей
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/news/${item.id}`}
                className={`news-card block rounded-2xl border bg-[var(--surface)] px-4 py-3.5 shadow-soft transition ${
                  item.read_by_me ? "border-[var(--border)]" : "news-card--unread"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    {item.title}
                  </h2>
                  {!item.read_by_me && (
                    <span className="news-unread-badge mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      новое
                    </span>
                  )}
                </div>
                {item.excerpt && (
                  <p className="mt-1.5 line-clamp-2 text-sm text-[var(--text-secondary)]">
                    {item.excerpt}
                  </p>
                )}
                <p className="mt-2.5 text-xs text-[var(--text-faint)]">
                  {item.author.nickname}
                  {" · "}
                  {formatNewsWhen(item.created_at)}
                  {" · "}
                  прочитали: {item.readers_count}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
