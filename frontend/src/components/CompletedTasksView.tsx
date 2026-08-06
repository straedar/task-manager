import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Checklist, Task } from "../types";
import { formatDayHeading } from "../utils/date";
import { moscowDateKeyFromIso } from "../utils/moscow";
import { TaskCard } from "./TaskCard";
import { ChecklistCard } from "./ChecklistCard";
import { DateFilterCalendar, DateFilterChip } from "./DateFilterCalendar";

interface CompletedTasksViewProps {
  tasks: Task[];
  checklists: Checklist[];
  currentUserId: number;
  isAdmin: boolean;
  onStart: (id: number) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleChecklistItem: (checklistId: number, itemId: number, completed: boolean) => void;
  onDeleteChecklist: (id: number) => void;
  onUpdated: () => void;
  actingId?: number | null;
  actingChecklistId?: number | null;
  filteredByAssignee?: boolean;
}

type FeedItem =
  | { kind: "task"; key: string; at: string; task: Task }
  | { kind: "checklist"; key: string; at: string; checklist: Checklist };

function getTaskCompletionStamp(task: Task, userId: number): string | null {
  if (task.completed_at) return task.completed_at;
  const mine = task.assignees.find((a) => a.id === userId)?.completed_at;
  if (mine) return mine;
  return task.assignees.find((a) => a.completed_at)?.completed_at ?? null;
}

function matchesTaskSearch(task: Task, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const haystack = [
    task.title,
    task.description,
    ...task.assignees.map((a) => a.nickname),
    task.creator.nickname,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matchesChecklistSearch(checklist: Checklist, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const haystack = [
    checklist.title,
    checklist.assignee.nickname,
    checklist.creator.nickname,
    ...checklist.items.map((i) => i.title),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matchesDayFilter(
  createdAt: string,
  completedAt: string | null,
  dateFilter: string
): boolean {
  if (!dateFilter) return true;
  const createdKey = moscowDateKeyFromIso(createdAt);
  const completedKey = completedAt ? moscowDateKeyFromIso(completedAt) : null;
  return createdKey === dateFilter || completedKey === dateFilter;
}

function collectActiveDays(
  tasks: Task[],
  checklists: Checklist[],
  currentUserId: number
): Set<string> {
  const days = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const key = moscowDateKeyFromIso(value);
    if (key) days.add(key);
  };

  for (const task of tasks) {
    add(task.created_at);
    add(getTaskCompletionStamp(task, currentUserId));
  }
  for (const checklist of checklists) {
    add(checklist.created_at);
    add(checklist.completed_at);
  }
  return days;
}

export function CompletedTasksView({
  tasks,
  checklists,
  currentUserId,
  isAdmin,
  onStart,
  onComplete,
  onDelete,
  onToggleChecklistItem,
  onDeleteChecklist,
  onUpdated,
  actingId,
  actingChecklistId,
  filteredByAssignee = false,
}: CompletedTasksViewProps) {
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const activeDays = useMemo(
    () => collectActiveDays(tasks, checklists, currentUserId),
    [tasks, checklists, currentUserId]
  );

  const feed = useMemo(() => {
    const items: FeedItem[] = [];

    for (const task of tasks) {
      if (!matchesTaskSearch(task, query)) continue;
      const completedStamp = getTaskCompletionStamp(task, currentUserId);
      if (!matchesDayFilter(task.created_at, completedStamp, dateFilter)) continue;
      items.push({
        kind: "task",
        key: `task-${task.id}`,
        at: completedStamp ?? task.created_at,
        task,
      });
    }

    for (const checklist of checklists) {
      if (!matchesChecklistSearch(checklist, query)) continue;
      if (!matchesDayFilter(checklist.created_at, checklist.completed_at, dateFilter)) continue;
      items.push({
        kind: "checklist",
        key: `checklist-${checklist.id}`,
        at: checklist.completed_at ?? checklist.created_at,
        checklist,
      });
    }

    return items;
  }, [tasks, checklists, query, currentUserId, dateFilter]);

  const groups = useMemo(() => {
    if (dateFilter) {
      if (feed.length === 0) return [];
      return [
        {
          key: dateFilter,
          label: formatDayHeading(dateFilter),
          items: [...feed].sort((a, b) => b.at.localeCompare(a.at)),
        },
      ];
    }

    const map = new Map<string, FeedItem[]>();
    for (const item of feed) {
      const key = moscowDateKeyFromIso(item.at) || "unknown";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }

    const keys = [...map.keys()].sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    });

    return keys.map((key) => ({
      key,
      label: key === "unknown" ? "Без даты" : formatDayHeading(key),
      items: (map.get(key) ?? []).sort((a, b) => b.at.localeCompare(a.at)),
    }));
  }, [feed, dateFilter]);

  const noResults = feed.length === 0;
  const emptyForSelectedDate = Boolean(dateFilter) && noResults && !query;

  return (
    <div>
      <div className="relative z-20 mb-4 flex gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по задачам и чеклистам..."
            className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 text-gray-400 hover:text-gray-600"
              aria-label="Очистить поиск"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>

        <DateFilterCalendar
          value={dateFilter}
          onChange={setDateFilter}
          onClear={() => setDateFilter("")}
          activeDays={activeDays}
        />
      </div>

      {dateFilter && (
        <DateFilterChip dateKey={dateFilter} onClear={() => setDateFilter("")} />
      )}

      {emptyForSelectedDate ? (
        <p className="py-12 text-center text-gray-400">
          Нет записей за {formatDayHeading(dateFilter)}
        </p>
      ) : noResults ? (
        <p className="py-12 text-center text-gray-400">
          {query || filteredByAssignee || dateFilter
            ? "Ничего не найдено"
            : "Нет завершённых задач и чеклистов"}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} id={`completed-${group.key}`} className="scroll-mt-4">
              <div className="mb-3 flex items-center gap-2 px-1">
                <h2 className="text-sm font-semibold text-gray-800">{group.label}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {group.items.length}
                </span>
              </div>
              <div className="space-y-3">
                {group.items.map((item) =>
                  item.kind === "task" ? (
                    <TaskCard
                      key={item.key}
                      task={item.task}
                      currentUserId={currentUserId}
                      canEdit={isAdmin || item.task.created_by === currentUserId}
                      canDelete={isAdmin || item.task.created_by === currentUserId}
                      onStart={onStart}
                      onComplete={onComplete}
                      onDelete={onDelete}
                      onUpdated={onUpdated}
                      actingId={actingId}
                    />
                  ) : (
                    <ChecklistCard
                      key={item.key}
                      checklist={item.checklist}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      onToggleItem={onToggleChecklistItem}
                      onDelete={onDeleteChecklist}
                      onUpdated={onUpdated}
                      acting={actingChecklistId === item.checklist.id}
                    />
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
