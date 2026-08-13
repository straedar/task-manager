import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { objectPerm } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import { NewsRichEditor } from "../components/NewsRichEditor";
import { can as userCan, isRoot } from "../types";

export function NewsEditorPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isPatchDraft = searchParams.get("patch") === "1";
  const newsChannel =
    searchParams.get("channel") === "warehouse" ? "warehouse" : "company";
  const isNew = !idParam;
  const editId = idParam ? Number(idParam) : NaN;
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [loading, setLoading] = useState(!isNew || isPatchDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [globalUpdate, setGlobalUpdate] = useState(false);
  const [patchMeta, setPatchMeta] = useState<{
    day_key: string;
    heading_ru: string;
    version_patch: string;
    version_global: string;
  } | null>(null);
  const [editChannel, setEditChannel] = useState<"company" | "warehouse" | "patch" | null>(
    null
  );

  const canRelease =
    Boolean(user) &&
    (isRoot(user!) ||
      userCan(user!, "news.release_patch") ||
      userCan(user!, "news.manage_any"));

  const selectedVersion = useMemo(() => {
    if (!patchMeta) return null;
    return globalUpdate ? patchMeta.version_global : patchMeta.version_patch;
  }, [patchMeta, globalUpdate]);

  const cancelPath = (() => {
    if (!isNew && editChannel === "warehouse") return "/news?channel=warehouse";
    if (!isNew && editChannel === "patch") return "/news?channel=patch";
    if (isNew && isPatchDraft) return "/news?channel=patch";
    if (isNew && newsChannel === "warehouse") return "/news?channel=warehouse";
    return "/news";
  })();

  useEffect(() => {
    if (!isNew || !isPatchDraft || !user) return;
    if (!canRelease) {
      setLoading(false);
      setError("Недостаточно прав для патчноута");
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getPatchDraft()
      .then((draft) => {
        if (cancelled) return;
        setBodyHtml(draft.body_html || "<p></p>");
        setPatchMeta({
          day_key: draft.day_key,
          heading_ru: draft.heading_ru,
          version_patch: draft.version_patch,
          version_global: draft.version_global,
        });
        setTitle(draft.title_patch);
        setGlobalUpdate(false);
      })
      .catch((err: Error & { post_id?: number }) => {
        if (cancelled) return;
        setError(err.message || "Не удалось загрузить черновик");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, isPatchDraft, user?.id]);

  useEffect(() => {
    if (!patchMeta) return;
    const version = globalUpdate ? patchMeta.version_global : patchMeta.version_patch;
    setTitle(`Патчноут ${version} · ${patchMeta.heading_ru}`);
  }, [globalUpdate, patchMeta]);

  useEffect(() => {
    if (isNew || Number.isNaN(editId) || !user) return;
    let cancelled = false;
    setLoading(true);
    api
      .getNews(editId)
      .then(({ item }) => {
        if (cancelled) return;
        setTitle(item.title);
        setBodyHtml(item.body_html || "<p></p>");
        setAuthorId(item.author_id);
        setEditChannel(item.channel);
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
  if (!can("app.news")) return <Navigate to="/" replace />;

  if (isNew && isPatchDraft && !canRelease) {
    return <Navigate to="/news?channel=patch" replace />;
  }

  if (isNew && !isPatchDraft && !can(objectPerm("news", "posts", "create"))) {
    return <Navigate to="/news" replace />;
  }

  if (!isNew) {
    if (Number.isNaN(editId)) return <Navigate to="/news" replace />;
    if (!loading && authorId != null) {
      const manageAny = isRoot(user) || userCan(user, "news.manage_any");
      const allowed =
        manageAny || (authorId === user.id && can("news.edit_own"));
      if (!allowed) return <Navigate to={`/news/${editId}`} replace />;
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const t = title.trim();
    if (!t) {
      setError("Укажите заголовок");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isNew) {
        const payload: {
          title: string;
          body_html: string;
          channel?: "company" | "warehouse";
          patch?: { version: string; release_day: string; global: boolean };
        } = { title: t, body_html: bodyHtml };
        if (isPatchDraft && patchMeta && selectedVersion) {
          payload.patch = {
            version: selectedVersion,
            release_day: patchMeta.day_key,
            global: globalUpdate,
          };
        } else {
          payload.channel = newsChannel;
        }
        const { item } = await api.createNews(payload);
        navigate(`/news/${item.id}`, { replace: true });
      } else {
        const { item } = await api.updateNews(editId, {
          title: t,
          body_html: bodyHtml,
        });
        navigate(`/news/${item.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setSaving(false);
    }
  };

  const editorTitle = isPatchDraft
    ? "Патчноут"
    : isNew
      ? newsChannel === "warehouse"
        ? "Новость склада"
        : "Новость компании"
      : "Редактирование";

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <HubBackButton />
        <Link
          to={isNew ? cancelPath : `/news/${editId}`}
          className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-soft"
        >
          Отмена
        </Link>
      </div>

      <h1 className="mb-5 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
        {editorTitle}
      </h1>

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {isPatchDraft && patchMeta && (
            <fieldset className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <legend className="px-1 text-sm font-medium text-[var(--text-secondary)]">
                Тип обновления
              </legend>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)]">
                  <input
                    type="radio"
                    name="bump"
                    checked={!globalUpdate}
                    onChange={() => setGlobalUpdate(false)}
                  />
                  Обычное
                  <span className="text-[var(--text-faint)]">
                    → {patchMeta.version_patch}
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)]">
                  <input
                    type="radio"
                    name="bump"
                    checked={globalUpdate}
                    onChange={() => setGlobalUpdate(true)}
                  />
                  Глобальное
                  <span className="text-[var(--text-faint)]">
                    → {patchMeta.version_global}
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
              Заголовок
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--text-primary)] outline-none ring-orange-400/30 focus:ring-2"
              placeholder="О чём новость"
              autoFocus={!isPatchDraft}
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">
              Текст
            </span>
            <NewsRichEditor
              key={
                isNew
                  ? isPatchDraft
                    ? "patch"
                    : `new-${newsChannel}`
                  : `edit-${editId}`
              }
              value={bodyHtml}
              onChange={setBodyHtml}
              disabled={saving}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={saving || (isPatchDraft && !patchMeta)}
            className="inline-flex w-full items-center justify-center rounded-2xl gradient-accent px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 disabled:opacity-50"
          >
            {saving
              ? "Сохранение…"
              : isPatchDraft
                ? "Опубликовать патчноут"
                : isNew
                  ? "Опубликовать"
                  : "Сохранить"}
          </button>
        </form>
      )}
    </div>
  );
}
