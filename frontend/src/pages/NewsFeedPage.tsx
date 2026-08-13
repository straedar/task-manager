import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Home, Newspaper, Rocket } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { objectPerm } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import { NewsBottomNav } from "../components/NewsBottomNav";
import type { NewsChannel, NewsPostListItem } from "../types";
import { can as userCan, isRoot } from "../types";
import { formatNewsWhen } from "../utils/newsDates";

const FEED_META: Record<
  NewsChannel,
  { title: string; subtitle: string; Icon: typeof Newspaper; empty: string }
> = {
  company: {
    title: "Новости компании",
    subtitle: "Объявления для всей компании",
    Icon: Building2,
    empty: "Пока нет новостей компании",
  },
  warehouse: {
    title: "Новости склада",
    subtitle: "Объявления склада",
    Icon: Home,
    empty: "Пока нет новостей склада",
  },
  patch: {
    title: "Патчноуты",
    subtitle: "Обновления приложения",
    Icon: Rocket,
    empty: "Пока нет патчноутов",
  },
};

function parseFeed(raw: string | null): NewsChannel {
  if (raw === "warehouse" || raw === "patch" || raw === "company") return raw;
  return "company";
}

export function NewsFeedPage() {
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const feed = useMemo(() => parseFeed(searchParams.get("channel")), [searchParams]);
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

  const [lastNewsFeed, setLastNewsFeed] = useState<"company" | "warehouse">(
    () => (feed === "warehouse" ? "warehouse" : "company")
  );

  useEffect(() => {
    if (feed === "company" || feed === "warehouse") setLastNewsFeed(feed);
  }, [feed]);

  const setFeed = useCallback(
    (next: NewsChannel) => {
      if (next === "company" || next === "warehouse") setLastNewsFeed(next);
      setSearchParams(next === "company" ? {} : { channel: next }, { replace: true });
    },
    [setSearchParams]
  );

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listNews(feed)
      .then(({ items: next }) => setItems(next))
      .catch((err: Error) => setError(err.message || "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, [feed]);

  useEffect(() => {
    if (!user || !can("app.news") || !canView) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canView, feed]);

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

  const meta = FEED_META[feed];
  const HeaderIcon = meta.Icon;

  const onCreate = () => {
    if (feed === "patch") {
      navigate("/news/new?patch=1");
      return;
    }
    navigate(`/news/new?channel=${feed}`);
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4">
      <header className="mb-6">
        <div className="mb-3">
          <HubBackButton />
        </div>
        <div className="flex items-center gap-2.5">
          <HeaderIcon className="h-7 w-7 shrink-0 text-[var(--accent-from)]" />
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {meta.title}
          </h1>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{meta.subtitle}</p>
      </header>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-[var(--text-muted)]">
          {meta.empty}
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

      <NewsBottomNav
        feed={feed}
        lastNewsFeed={lastNewsFeed}
        canCreateNews={canCreate}
        canReleasePatch={canRelease}
        onFeedChange={setFeed}
        onCreate={onCreate}
      />
    </div>
  );
}
