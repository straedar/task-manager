import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Play, RotateCcw, Users, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ItemChat } from "../components/ItemChat";
import type { Task } from "../types";
import { PRIORITY_LABELS, STATUS_LABELS, isRoot } from "../types";
import { formatMoscowDeadline, formatTaskDate, parseTaskDate } from "../utils/date";
import { moscowDateKey, taskDayKey } from "../utils/moscow";

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

function isTaskOverdue(task: Task): boolean {
  if (task.status === "completed") return false;
  if (task.due_at) {
    const due = parseTaskDate(task.due_at);
    return Boolean(due && due.getTime() < Date.now());
  }
  const day = taskDayKey(task);
  if (!day) return false;
  return day < moscowDateKey();
}

export function TaskDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      const { task: next } = await api.getTask(id);
      setTask(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (user && can("app.tasks")) void refresh();
  }, [user, can, refresh]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.tasks")) return <Navigate to="/" replace />;
  if (!Number.isFinite(id)) return <Navigate to="/tasks" replace />;

  const isAssignee = task?.assignees.some((a) => a.id === user.id) ?? false;
  const myAssignee = task?.assignees.find((a) => a.id === user.id);
  const iCompleted = Boolean(myAssignee?.completed_at);
  const failedByDeadline = Boolean(task?.status === "completed" && task.auto_completed);
  const canStart = Boolean(task && task.status === "pending" && isAssignee && !iCompleted);
  const canComplete = Boolean(
    task && isAssignee && !iCompleted && task.status === "in_progress"
  );
  const canRestore = Boolean(
    task &&
      failedByDeadline &&
      (isAssignee ||
        task.created_by === user.id ||
        isRoot(user) ||
        can("tasks.manage_any"))
  );
  const overdue = task ? isTaskOverdue(task) || failedByDeadline : false;

  const runAction = async (fn: () => Promise<unknown>) => {
    setActing(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-6">
      <header className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-soft hover:text-orange-600"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link to="/tasks" className="text-sm font-medium text-gray-500 hover:text-orange-600">
          К задачам
        </Link>
      </header>

      {loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : error && !task ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-red-500 shadow-soft">
          {error}
        </p>
      ) : task ? (
        <>
          <div
            className={`mb-4 rounded-3xl p-4 shadow-soft ${
              overdue ? "card-accent-alert" : "bg-white"
            }`}
          >
            <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1">
              {failedByDeadline ? (
                <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Просрочена
                </span>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyles[task.status]}`}
                >
                  {STATUS_LABELS[task.status]}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityStyles[task.priority]}`}
              >
                {PRIORITY_LABELS[task.priority]}
              </span>
              {task.is_shared && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                  <Users className="h-3 w-3" />
                  Общая
                </span>
              )}
              {overdue && !failedByDeadline && (
                <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Просрочена
                </span>
              )}
            </div>

            {task.description && (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-600">
                {task.description}
              </p>
            )}

            <div className="mt-3 space-y-0.5 text-xs text-gray-400">
              <p>
                {task.is_shared
                  ? task.assignees.map((a) => a.nickname).join(", ")
                  : task.assignees
                      .map((a) => `${a.completed_at ? "✓" : "○"} ${a.nickname}`)
                      .join(" · ")}
              </p>
              <p>Создал: {task.creator.nickname}</p>
              <p>Создана: {formatTaskDate(task.created_at)}</p>
              {task.due_at && (
                <p className="text-accent-alert">
                  {overdue && !failedByDeadline
                    ? `Просрочена с ${formatMoscowDeadline(task.due_at)}`
                    : `Срок до ${formatMoscowDeadline(task.due_at)}`}
                </p>
              )}
            </div>

            {(canStart || canComplete) && (
              <div className="mt-4 flex gap-2">
                {canStart && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void runAction(() => api.startTask(task.id))}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    В работу
                  </button>
                )}
                {canComplete && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void runAction(() => api.completeTask(task.id))}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                    Завершить
                  </button>
                )}
              </div>
            )}

            {task.status === "completed" && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  {failedByDeadline ? (
                    <>
                      <X className="h-4 w-4 text-red-500" />
                      Просрочена
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 text-green-600" />
                      Выполнена
                    </>
                  )}
                </div>
                {canRestore && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void runAction(() => api.restoreTask(task.id))}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-sm font-medium text-orange-800 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Восстановить в активные
                  </button>
                )}
              </div>
            )}
          </div>

          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

          <ItemChat kind="task" refId={task.id} currentUserId={user.id} />
        </>
      ) : null}
    </div>
  );
}
