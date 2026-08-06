import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { Calendar, Lightbulb, Search, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { BottomNav } from "../components/BottomNav";
import { HubBackButton } from "../components/HubBackButton";
import { IdeaCard } from "../components/IdeaCard";
import type { Idea, IdeaTag } from "../types";
import { IDEA_TAG_LABELS } from "../types";
import { dateKeyFromValue, formatDayHeading } from "../utils/date";

type StatusFilter = "all" | "open" | "completed";
type TagFilter = "all" | IdeaTag;

function ideaMatchesDate(idea: Idea, dateKey: string): boolean {
  const created = dateKeyFromValue(idea.created_at);
  const due = idea.due_at ? dateKeyFromValue(idea.due_at) : null;
  const completed = idea.completed_at ? dateKeyFromValue(idea.completed_at) : null;
  return created === dateKey || due === dateKey || completed === dateKey;
}

export function IdeasPage() {
  const { user, loading: authLoading, can } = useAuth();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [dateFilter, setDateFilter] = useState("");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { ideas: next } = await api.getIdeas();
      setIdeas(next);
    } catch {
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return ideas.filter((idea) => {
      if (filter === "open" && idea.status !== "open") return false;
      if (filter === "completed" && idea.status !== "completed") return false;
      if (tagFilter !== "all" && idea.tag !== tagFilter) return false;
      if (dateFilter && !ideaMatchesDate(idea, dateFilter)) return false;

      if (q) {
        const titleMatch = idea.title.toLowerCase().includes(q);
        const descMatch = idea.description.toLowerCase().includes(q);
        const tagMatch = IDEA_TAG_LABELS[idea.tag].toLowerCase().includes(q);
        if (!titleMatch && !descMatch && !tagMatch) return false;
      }

      return true;
    });
  }, [ideas, filter, query, tagFilter, dateFilter]);

  const handleComplete = async (id: number) => {
    setActingId(id);
    try {
      await api.completeIdea(id);
      await load();
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setActingId(id);
    try {
      await api.deleteIdea(id);
      await load();
    } finally {
      setActingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-gray-400">Загрузка...</div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("tasks.ideas")) return <Navigate to="/" replace />;

  const hasFilters = Boolean(query || tagFilter !== "all" || dateFilter);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6">
      <header className="mb-6">
        <div className="mb-2">
          <HubBackButton />
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Lightbulb className="h-7 w-7 shrink-0 text-orange-500" />
          Идеи
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">Инициативы и предложения</p>
      </header>

      <div className="mb-2.5 flex w-full min-w-0 gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск..."
            className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 text-gray-400 hover:text-gray-600"
              aria-label="Очистить поиск"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition ${
            dateFilter
              ? "border-orange-300 bg-orange-50 text-orange-600"
              : "border-gray-200 bg-white text-orange-500 hover:border-orange-300 hover:bg-orange-50"
          }`}
          aria-label="Фильтр по дате"
          title="Фильтр по дате"
        >
          <Calendar className="h-4 w-4" />
          <input
            ref={dateInputRef}
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            tabIndex={-1}
            aria-hidden
          />
        </button>
      </div>

      <div className="mb-2.5 w-full min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5">
          {(
            [
              ["all", "Все"],
              ["work", IDEA_TAG_LABELS.work],
              ["entertainment", IDEA_TAG_LABELS.entertainment],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTagFilter(value)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                tagFilter === value
                  ? "gradient-accent text-white shadow"
                  : "bg-white text-gray-500 shadow-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {hasFilters && (
        <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-2">
          {dateFilter && (
            <div className="flex max-w-full items-center gap-2 rounded-2xl bg-orange-50 px-2.5 py-1 text-xs text-orange-700">
              <span className="truncate">{formatDayHeading(dateFilter)}</span>
              <button
                type="button"
                onClick={() => setDateFilter("")}
                className="shrink-0 font-medium hover:underline"
              >
                ×
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTagFilter("all");
              setDateFilter("");
            }}
            className="text-xs font-medium text-gray-400 hover:text-gray-600"
          >
            Сбросить
          </button>
        </div>
      )}

      <div className="mb-3 flex w-full min-w-0 rounded-full bg-white p-0.5 shadow-soft">
        {(
          [
            ["open", "Активные"],
            ["completed", "Готово"],
            ["all", "Все"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`min-w-0 flex-1 truncate rounded-full px-1 py-1.5 text-xs font-medium transition sm:py-2 sm:text-sm ${
              filter === value ? "gradient-accent text-white shadow" : "text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-gray-400">
          {hasFilters ? "Ничего не найдено" : "Пока нет идей"}
        </p>
      ) : (
        <div className="w-full min-w-0 space-y-2.5">
          {filtered.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              currentUserId={user.id}
              isAdmin={can("tasks.manage_any")}
              onComplete={handleComplete}
              onDelete={handleDelete}
              onUpdated={load}
              actingId={actingId}
            />
          ))}
        </div>
      )}

      <BottomNav onIdeaCreated={load} />
    </div>
  );
}
