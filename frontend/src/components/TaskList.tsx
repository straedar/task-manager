import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import type { Checklist, Task } from "../types";
import { isTaskActiveForUser, isTaskCompletedForUser } from "../types";
import { TaskCard } from "./TaskCard";
import { ChecklistCard } from "./ChecklistCard";
import { CompletedTasksView } from "./CompletedTasksView";
import { Select, type SelectOption } from "./Select";
import {
  isDeferredItem,
  moscowDateKey,
} from "../utils/moscow";
import { isChecklistOverdue } from "../utils/checklistStatus";

type TaskTab = "active" | "completed";

type ActiveFeedItem =
  | { kind: "task"; key: string; at: string; task: Task }
  | { kind: "checklist"; key: string; at: string; checklist: Checklist };

interface TaskListProps {
  tasks: Task[];
  checklists: Checklist[];
  currentUserId: number;
  isAdmin: boolean;
  onStart: (id: number) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleChecklistItem: (
    checklistId: number,
    itemId: number,
    payload: boolean | { action: "claim" | "complete" | "uncomplete" }
  ) => void;
  onDeleteChecklist: (id: number) => void;
  onUpdated: () => void;
  actingId?: number | null;
  actingChecklistId?: number | null;
}

function tabFromPath(pathname: string): TaskTab {
  return pathname === "/tasks/completed" || pathname === "/completed" ? "completed" : "active";
}

function isTaskVisibleOnHome(task: Task, todayKey: string): boolean {
  // Only explicit planner day defers; due_at is a deadline and must not hide the task.
  return !isDeferredItem(task.planned_for ?? null, todayKey);
}

function isChecklistVisibleOnHome(checklist: Checklist, todayKey: string): boolean {
  return !isDeferredItem(checklist.planned_for ?? null, todayKey);
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

function matchesTaskAssignee(task: Task, assigneeId: string): boolean {
  if (!assigneeId) return true;
  const id = Number(assigneeId);
  return task.assignees.some((a) => a.id === id);
}

function matchesChecklistAssignee(checklist: Checklist, assigneeId: string): boolean {
  if (!assigneeId) return true;
  return checklist.assignee_id === Number(assigneeId);
}

function buildAssigneeOptions(tasks: Task[], checklists: Checklist[]): SelectOption[] {
  const map = new Map<number, string>();
  for (const task of tasks) {
    for (const assignee of task.assignees) {
      map.set(assignee.id, assignee.nickname);
    }
  }
  for (const checklist of checklists) {
    map.set(checklist.assignee.id, checklist.assignee.nickname);
  }

  const people = [...map.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "ru"))
    .map(([id, nickname]) => ({ value: String(id), label: nickname }));

  return [{ value: "", label: "Все исполнители" }, ...people];
}

export function TaskList({
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
}: TaskListProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromPath(location.pathname);
  const [activeQuery, setActiveQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const setTab = (next: TaskTab) => {
    navigate(next === "completed" ? "/tasks/completed" : "/tasks");
  };

  const todayKey = moscowDateKey();

  const homeTasks = useMemo(
    () => tasks.filter((t) => isTaskVisibleOnHome(t, todayKey)),
    [tasks, todayKey]
  );

  const homeChecklists = useMemo(
    () => checklists.filter((c) => isChecklistVisibleOnHome(c, todayKey)),
    [checklists, todayKey]
  );

  const assigneeOptions = useMemo(
    () => buildAssigneeOptions(homeTasks, homeChecklists),
    [homeTasks, homeChecklists]
  );

  const activeFeed = useMemo(() => {
    const items: ActiveFeedItem[] = [];

    for (const task of homeTasks) {
      if (!isTaskActiveForUser(task, currentUserId)) continue;
      if (!matchesTaskAssignee(task, assigneeFilter)) continue;
      if (!matchesTaskSearch(task, activeQuery)) continue;
      items.push({ kind: "task", key: `task-${task.id}`, at: task.created_at, task });
    }

    for (const checklist of homeChecklists) {
      if (checklist.status !== "open") continue;
      // Past deadline → not active work; shown under «Завершённые» as overdue.
      if (isChecklistOverdue(checklist)) continue;
      if (!matchesChecklistAssignee(checklist, assigneeFilter)) continue;
      if (!matchesChecklistSearch(checklist, activeQuery)) continue;
      items.push({
        kind: "checklist",
        key: `checklist-${checklist.id}`,
        at: checklist.created_at,
        checklist,
      });
    }

    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [homeTasks, homeChecklists, currentUserId, activeQuery, assigneeFilter]);

  const completedTasks = useMemo(
    () =>
      homeTasks
        .filter((t) => isTaskCompletedForUser(t, currentUserId))
        .filter((t) => matchesTaskAssignee(t, assigneeFilter)),
    [homeTasks, currentUserId, assigneeFilter]
  );

  const completedChecklists = useMemo(
    () =>
      homeChecklists
        .filter(
          (c) => c.status === "completed" || isChecklistOverdue(c)
        )
        .filter((c) => matchesChecklistAssignee(c, assigneeFilter)),
    [homeChecklists, assigneeFilter]
  );

  const hasAssigneeFilter = Boolean(assigneeFilter);

  return (
    <div>
      <div className="mb-6 flex rounded-full bg-white p-1 shadow-soft">
        <button
          onClick={() => setTab("active")}
          className={`flex-1 rounded-full py-2.5 text-sm font-medium transition ${
            tab === "active" ? "gradient-accent text-white shadow" : "text-gray-500"
          }`}
        >
          Активные
        </button>
        <button
          onClick={() => setTab("completed")}
          className={`flex-1 rounded-full py-2.5 text-sm font-medium transition ${
            tab === "completed" ? "gradient-accent text-white shadow" : "text-gray-500"
          }`}
        >
          Завершённые
        </button>
      </div>

      <div className="mb-4">
        <Select
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={assigneeOptions}
          placeholder="Все исполнители"
          showAvatar={false}
        />
      </div>

      {tab === "completed" ? (
        <CompletedTasksView
          tasks={completedTasks}
          checklists={completedChecklists}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onStart={onStart}
          onComplete={onComplete}
          onDelete={onDelete}
          onToggleChecklistItem={onToggleChecklistItem}
          onDeleteChecklist={onDeleteChecklist}
          onUpdated={onUpdated}
          actingId={actingId}
          actingChecklistId={actingChecklistId}
          filteredByAssignee={hasAssigneeFilter}
        />
      ) : (
        <div>
          <label className="relative mb-4 flex min-w-0 items-center">
            <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400" />
            <input
              type="search"
              value={activeQuery}
              onChange={(e) => setActiveQuery(e.target.value)}
              placeholder="Поиск по задачам и чеклистам..."
              className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            {activeQuery && (
              <button
                type="button"
                onClick={() => setActiveQuery("")}
                className="absolute right-3 text-gray-400 hover:text-gray-600"
                aria-label="Очистить поиск"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="space-y-3">
            {activeFeed.length === 0 ? (
              <p className="py-12 text-center text-gray-400">
                {activeQuery || hasAssigneeFilter
                  ? "Ничего не найдено"
                  : "Нет активных задач и чеклистов"}
              </p>
            ) : (
              activeFeed.map((item) =>
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
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
