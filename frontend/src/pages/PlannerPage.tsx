import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { BottomNav } from "../components/BottomNav";
import { HubBackButton } from "../components/HubBackButton";
import { CreateTaskDialog } from "../components/CreateTaskDialog";
import { ChecklistFormDialog } from "../components/CreateChecklistDialog";
import { EditTaskDialog } from "../components/EditTaskDialog";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { Modal } from "../components/Modal";
import { Select, type SelectOption } from "../components/Select";
import type { Checklist, Task } from "../types";
import { PRIORITY_LABELS, STATUS_LABELS } from "../types";
import { formatDayHeading } from "../utils/date";
import {
  checklistDayKey,
  monthGrid,
  monthLabel,
  moscowDateKey,
  shiftMonth,
  taskDayKey,
} from "../utils/moscow";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const priorityStyles = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-orange-100 text-orange-700",
  high: "bg-red-100 text-red-700",
};

const statusStyles = {
  pending: "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

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

function matchesTaskAssignee(task: Task, assigneeId: string): boolean {
  if (!assigneeId) return true;
  return task.assignees.some((a) => a.id === Number(assigneeId));
}

function matchesChecklistAssignee(checklist: Checklist, assigneeId: string): boolean {
  if (!assigneeId) return true;
  return checklist.assignee_id === Number(assigneeId);
}

export function PlannerPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { confirm, alert } = useDialog();
  const [monthKey, setMonthKey] = useState(() => moscowDateKey().slice(0, 7) + "-01");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [deleteTaskOpen, setDeleteTaskOpen] = useState(false);
  const [detailChecklist, setDetailChecklist] = useState<Checklist | null>(null);
  const [editChecklistOpen, setEditChecklistOpen] = useState(false);
  const [acting, setActing] = useState(false);

  const todayKey = moscowDateKey();
  const admin = can("tasks.manage_any");

  const refresh = useCallback(async () => {
    try {
      const [{ tasks: nextTasks }, { checklists: nextChecklists }] = await Promise.all([
        api.getTasks(),
        api.getChecklists(),
      ]);
      setTasks(nextTasks);
      setChecklists(nextChecklists);
      setDetailTask((prev) => {
        if (!prev) return null;
        return nextTasks.find((t) => t.id === prev.id) ?? null;
      });
      setDetailChecklist((prev) => {
        if (!prev) return null;
        return nextChecklists.find((c) => c.id === prev.id) ?? null;
      });
    } catch {
      setTasks([]);
      setChecklists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const filteredTasks = useMemo(
    () => tasks.filter((t) => matchesTaskAssignee(t, assigneeFilter)),
    [tasks, assigneeFilter]
  );

  const filteredChecklists = useMemo(
    () => checklists.filter((c) => matchesChecklistAssignee(c, assigneeFilter)),
    [checklists, assigneeFilter]
  );

  const assigneeOptions = useMemo(
    () => buildAssigneeOptions(tasks, checklists),
    [tasks, checklists]
  );

  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of filteredTasks) {
      const key = taskDayKey(task, { fallbackCreated: true });
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    for (const checklist of filteredChecklists) {
      const key = checklistDayKey(checklist);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [filteredTasks, filteredChecklists]);

  const dayTasks = useMemo(
    () =>
      selectedDay
        ? filteredTasks.filter(
            (t) => taskDayKey(t, { fallbackCreated: true }) === selectedDay
          )
        : [],
    [filteredTasks, selectedDay]
  );

  const dayChecklists = useMemo(
    () =>
      selectedDay
        ? filteredChecklists.filter((c) => checklistDayKey(c) === selectedDay)
        : [],
    [filteredChecklists, selectedDay]
  );

  const cells = useMemo(() => monthGrid(monthKey), [monthKey]);

  const canManageTask = (task: Task) =>
    Boolean(user && (admin || task.created_by === user.id));

  const canManageChecklist = (checklist: Checklist) =>
    Boolean(user && (admin || checklist.created_by === user.id));

  const handleDeleteTask = async () => {
    if (!detailTask) return;
    setActing(true);
    try {
      await api.deleteTask(detailTask.id);
      setDeleteTaskOpen(false);
      setDetailTask(null);
      await refresh();
    } catch (err) {
      await alert({
        title: "Не удалось удалить",
        description: err instanceof Error ? err.message : "Попробуйте ещё раз",
      });
    } finally {
      setActing(false);
    }
  };

  const handleDeleteChecklist = async (checklist: Checklist) => {
    const ok = await confirm({
      title: `Удалить чеклист «${checklist.title}»?`,
      description: "Это действие нельзя отменить.",
    });
    if (!ok) return;
    setActing(true);
    try {
      await api.deleteChecklist(checklist.id);
      setDetailChecklist(null);
      setEditChecklistOpen(false);
      await refresh();
    } catch (err) {
      await alert({
        title: "Не удалось удалить",
        description: err instanceof Error ? err.message : "Попробуйте ещё раз",
      });
    } finally {
      setActing(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-gray-400">Загрузка...</div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("tasks.planner")) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6">
      <header className="mb-6">
        <div className="mb-2">
          <HubBackButton />
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <CalendarDays className="h-7 w-7 shrink-0 text-orange-500" />
          Планировщик
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">Задачи и чеклисты по дням месяца</p>
      </header>

      <div className="mb-4">
        <Select
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={assigneeOptions}
          placeholder="Все исполнители"
          showAvatar={false}
        />
      </div>

      <div className="mb-4 flex items-center justify-between rounded-3xl bg-white px-3 py-2 shadow-soft">
        <button
          type="button"
          onClick={() => setMonthKey((prev) => shiftMonth(prev, -1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-50"
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold capitalize text-gray-900">{monthLabel(monthKey)}</p>
        <button
          type="button"
          onClick={() => setMonthKey((prev) => shiftMonth(prev, 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-50"
          aria-label="Следующий месяц"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : (
        <div className="rounded-3xl bg-white p-3 shadow-soft">
          <div className="mb-2 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[11px] font-medium text-gray-400">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="aspect-square" />;
              const count = countsByDay.get(day) ?? 0;
              const isToday = day === todayKey;
              const isSelected = day === selectedDay;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl text-sm font-medium transition ${
                    isSelected
                      ? "gradient-accent text-white shadow"
                      : isToday
                        ? "bg-orange-50 text-orange-600"
                        : "text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  {Number(day.slice(-2))}
                  {count > 0 && (
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                        isSelected ? "bg-white" : "bg-orange-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(selectedDay) && !detailTask && !detailChecklist}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? formatDayHeading(selectedDay) : ""}
      >
        <div className="flex flex-col gap-4 p-5">
          {selectedDay && selectedDay >= todayKey ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTaskOpen(true)}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-orange-200 hover:bg-orange-50/50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                  <ListTodo className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-gray-900">Задача</span>
              </button>
              <button
                type="button"
                onClick={() => setChecklistOpen(true)}
                className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50/50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <CheckSquare className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-gray-900">Чеклист</span>
              </button>
            </div>
          ) : (
            <p className="rounded-2xl bg-gray-50 px-3 py-2.5 text-center text-sm text-gray-500">
              На прошедший день создать нельзя
            </p>
          )}

          {dayTasks.length === 0 && dayChecklists.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">
              {assigneeFilter
                ? "Ничего не найдено у этого исполнителя"
                : "На этот день пока ничего нет"}
            </p>
          ) : (
            <div className="space-y-2">
              {dayTasks.map((task) => (
                <button
                  key={`task-${task.id}`}
                  type="button"
                  onClick={() => setDetailTask(task)}
                  className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
                >
                  <p className="text-sm font-medium text-gray-900">{task.title}</p>
                  {task.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{task.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-gray-400">
                    Задача · {task.assignees.map((a) => a.nickname).join(", ")}
                  </p>
                </button>
              ))}
              {dayChecklists.map((checklist) => (
                <button
                  key={`cl-${checklist.id}`}
                  type="button"
                  onClick={() => setDetailChecklist(checklist)}
                  className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-left transition hover:border-sky-200 hover:bg-sky-50/40"
                >
                  <p className="text-sm font-medium text-gray-900">{checklist.title}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Чеклист · {checklist.assignee.nickname} ·{" "}
                    {checklist.items.filter((i) => i.completed_at).length}/{checklist.items.length}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(detailTask)}
        onClose={() => {
          setDetailTask(null);
          setEditTaskOpen(false);
        }}
        title={detailTask?.title ?? "Задача"}
      >
        {detailTask && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap gap-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyles[detailTask.status]}`}
              >
                {STATUS_LABELS[detailTask.status]}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityStyles[detailTask.priority]}`}
              >
                {PRIORITY_LABELS[detailTask.priority]}
              </span>
              {detailTask.is_shared && (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                  Общая
                </span>
              )}
              {detailTask.is_private && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  Приватная
                </span>
              )}
            </div>

            {detailTask.description ? (
              <div>
                <p className="mb-1 text-sm font-medium text-gray-700">Описание</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">
                  {detailTask.description}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Без описания</p>
            )}

            <div className="space-y-1 text-xs text-gray-400">
              <p>Исполнители: {detailTask.assignees.map((a) => a.nickname).join(", ")}</p>
              <p>Создал: {detailTask.creator.nickname}</p>
            </div>

            {canManageTask(detailTask) && (
              <div className="flex gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditTaskOpen(true)}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-sm font-medium text-orange-600 transition hover:bg-orange-100 disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTaskOpen(true)}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {detailTask && (
        <EditTaskDialog
          task={detailTask}
          open={editTaskOpen}
          onClose={() => setEditTaskOpen(false)}
          onSaved={async () => {
            setEditTaskOpen(false);
            await refresh();
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteTaskOpen && Boolean(detailTask)}
        title="Удалить задачу?"
        description="Задача исчезнет у всех исполнителей. Восстановить её будет нельзя."
        loading={acting}
        onCancel={() => setDeleteTaskOpen(false)}
        onConfirm={() => void handleDeleteTask()}
        preview={
          detailTask ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {detailTask.title}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-faint)]">
                {STATUS_LABELS[detailTask.status]} · {PRIORITY_LABELS[detailTask.priority]}
              </p>
            </div>
          ) : null
        }
      />

      <Modal
        open={Boolean(detailChecklist) && !editChecklistOpen}
        onClose={() => setDetailChecklist(null)}
        title={detailChecklist?.title ?? "Чеклист"}
      >
        {detailChecklist && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap gap-1">
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                Чеклист
              </span>
              {detailChecklist.is_private && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  Приватный
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {detailChecklist.items.filter((i) => i.completed_at).length}/
                {detailChecklist.items.length}
              </span>
            </div>

            <ul className="space-y-2">
              {detailChecklist.items.map((item) => (
                <li
                  key={item.id}
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    item.completed_at
                      ? "bg-gray-50 text-gray-400 line-through"
                      : "bg-sky-50/60 text-gray-800"
                  }`}
                >
                  {item.title}
                </li>
              ))}
            </ul>

            <div className="space-y-1 text-xs text-gray-400">
              <p>Исполнитель: {detailChecklist.assignee.nickname}</p>
              <p>Создал: {detailChecklist.creator.nickname}</p>
            </div>

            {canManageChecklist(detailChecklist) && (
              <div className="flex gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditChecklistOpen(true)}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 py-3 text-sm font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteChecklist(detailChecklist)}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        hideTrigger
        plannedDateKey={selectedDay}
        onCreated={() => {
          refresh();
        }}
      />

      <ChecklistFormDialog
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        plannedDateKey={selectedDay}
        onSaved={() => {
          refresh();
        }}
      />

      {detailChecklist && (
        <ChecklistFormDialog
          open={editChecklistOpen}
          checklist={detailChecklist}
          onClose={() => setEditChecklistOpen(false)}
          onSaved={async () => {
            setEditChecklistOpen(false);
            await refresh();
          }}
        />
      )}

      <BottomNav onTaskCreated={() => refresh()} />
    </div>
  );
}
