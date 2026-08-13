import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Pencil, Play, Trash2, Users, X } from "lucide-react";
import { DiscussionIcon } from "./DiscussionIcon";
import type { Task } from "../types";
import { PRIORITY_LABELS, STATUS_LABELS } from "../types";
import { formatTaskDate, formatMoscowDeadline, parseTaskDate } from "../utils/date";
import { moscowDateKey, taskDayKey } from "../utils/moscow";
import { EditTaskDialog } from "./EditTaskDialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

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

const actionBtn =
  "flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-50";

const checkBtn =
  "flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition disabled:opacity-50";

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

interface TaskCardProps {
  task: Task;
  currentUserId: number;
  canEdit: boolean;
  canDelete: boolean;
  onStart: (id: number) => void;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdated: () => void;
  actingId?: number | null;
}

export function TaskCard({
  task,
  currentUserId,
  canEdit,
  canDelete,
  onStart,
  onComplete,
  onDelete,
  onUpdated,
  actingId,
}: TaskCardProps) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isAssignee = task.assignees.some((a) => a.id === currentUserId);
  const myAssignee = task.assignees.find((a) => a.id === currentUserId);
  const iCompleted = Boolean(myAssignee?.completed_at);
  const failedByDeadline = task.status === "completed" && Boolean(task.auto_completed);

  const canStart = task.status === "pending" && isAssignee && !iCompleted;
  const canComplete =
    isAssignee && !iCompleted && task.status === "in_progress";
  const showCompletedMark =
    !canStart && !canComplete && (task.status === "completed" || iCompleted);

  const doneCount = task.assignees.filter((a) => a.completed_at).length;
  const myCompletedAt = myAssignee?.completed_at;
  const showTaskCompleted = task.status === "completed" && task.completed_at;
  const showMyCompleted = !task.is_shared && iCompleted && myCompletedAt && !showTaskCompleted;
  const hasFooterActions = canEdit || canDelete;
  const hasCornerAction = canStart || canComplete || showCompletedMark;
  const overdue = isTaskOverdue(task) || failedByDeadline;

  const handleDelete = () => setDeleteOpen(true);

  const confirmDelete = () => {
    setDeleteOpen(false);
    onDelete(task.id);
  };

  return (
    <>
      <div
        role="link"
        tabIndex={0}
        onClick={() => navigate(`/tasks/t/${task.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(`/tasks/t/${task.id}`);
          }
        }}
        className={`relative cursor-pointer rounded-3xl p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md ${
          overdue ? "card-accent-alert" : "bg-white"
        }`}
      >
        {canStart && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStart(task.id);
            }}
            disabled={actingId === task.id}
            className={`${checkBtn} absolute right-3 top-3 z-10 bg-blue-500 text-white hover:bg-blue-600`}
            aria-label="В работу"
            title="В работу"
          >
            <Play className="h-5 w-5 fill-white" />
          </button>
        )}
        {canComplete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onComplete(task.id);
            }}
            disabled={actingId === task.id}
            className={`${checkBtn} absolute right-3 top-3 z-10 bg-gray-900 text-white hover:bg-gray-800`}
            aria-label="Завершить"
            title="Завершить"
          >
            <Check className="h-6 w-6" strokeWidth={2.5} />
          </button>
        )}
        {showCompletedMark && (
          <div
            className={`${checkBtn} absolute right-3 top-3 z-10 ${
              failedByDeadline
                ? "bg-red-100 text-red-600"
                : "bg-green-100 text-green-600"
            }`}
            aria-label={failedByDeadline ? "Просрочена" : "Выполнено"}
            title={failedByDeadline ? "Просрочена" : "Выполнено"}
          >
            {failedByDeadline ? (
              <X className="h-6 w-6" strokeWidth={2.5} />
            ) : (
              <Check className="h-6 w-6" strokeWidth={2.5} />
            )}
          </div>
        )}

        <div className={`min-w-0 ${hasCornerAction ? "pr-12" : ""}`}>
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-gray-900">
              {task.title}
            </h3>
            <DiscussionIcon chat={task.chat} className="mt-0.5 h-4 w-4" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {failedByDeadline ? (
              <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                Просрочена
              </span>
            ) : (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyles[task.status]}`}>
                {STATUS_LABELS[task.status]}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityStyles[task.priority]}`}>
              {PRIORITY_LABELS[task.priority]}
            </span>
            {task.is_shared && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                <Users className="h-3 w-3" />
                Общая
              </span>
            )}
            {task.is_private && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                Приватная
              </span>
            )}
            {overdue && !failedByDeadline && (
              <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                Просрочена
              </span>
            )}
          </div>
        </div>

        {task.description && (
          <p
            className={`mt-2 break-words whitespace-pre-wrap text-sm leading-snug ${
              overdue ? "card-accent-desc" : "text-gray-600"
            }`}
          >
            {task.description}
          </p>
        )}

        <div
          className={`mt-2.5 flex items-end gap-2 border-t border-gray-100 pt-2.5 ${
            hasFooterActions ? "justify-between" : ""
          }`}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="break-words text-xs text-gray-400">
              {task.is_shared
                ? task.assignees.map((a) => a.nickname).join(", ")
                : failedByDeadline
                  ? task.assignees.map((a) => `✗ ${a.nickname}`).join(" · ")
                  : task.assignees
                      .map((a) => `${a.completed_at ? "✓" : "○"} ${a.nickname}`)
                      .join(" · ")}
            </p>
            {!task.is_shared && task.status !== "completed" && task.assignees.length > 1 && (
              <p className="text-xs text-gray-400">
                Выполнили: {doneCount} из {task.assignees.length}
              </p>
            )}
            <p className="text-xs text-gray-400">Создана: {formatTaskDate(task.created_at)}</p>
            {task.status !== "completed" && task.due_at && (
              <p className="text-xs text-accent-alert">
                {overdue && !failedByDeadline
                  ? `Просрочена с ${formatMoscowDeadline(task.due_at)}`
                  : `Срок до ${formatMoscowDeadline(task.due_at)}`}
              </p>
            )}
            {overdue && !task.due_at && task.planned_for && (
              <p className="text-xs text-accent-alert">Срок: {task.planned_for}</p>
            )}
            {showTaskCompleted && (
              <p className={`text-xs ${failedByDeadline ? "text-accent-alert" : "text-green-600"}`}>
                {failedByDeadline ? "Просрочена" : "Завершена"}:{" "}
                {formatTaskDate(task.completed_at!)}
              </p>
            )}
            {showMyCompleted && (
              <p className="text-xs text-green-600">
                Вы завершили: {formatTaskDate(myCompletedAt!)}
              </p>
            )}
            {task.status === "completed" && task.completed_by_user && !failedByDeadline && (
              <p className="text-xs text-green-600">
                {task.is_shared ? "Завершил" : "Закрыл задачу"}:{" "}
                {task.completed_by_user.nickname}
              </p>
            )}
          </div>

          {hasFooterActions && (
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditOpen(true);
                  }}
                  disabled={actingId === task.id}
                  className={`${actionBtn} bg-orange-50 text-orange-500 hover:bg-orange-100`}
                  aria-label="Изменить"
                  title="Изменить"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  disabled={actingId === task.id}
                  className={`${actionBtn} bg-red-50 text-red-500 hover:bg-red-100`}
                  aria-label="Удалить"
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <EditTaskDialog
          task={task}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={onUpdated}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        title="Удалить задачу?"
        description="Задача исчезнет у всех исполнителей. Восстановить её будет нельзя."
        loading={actingId === task.id}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        preview={
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {task.title}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-faint)]">
              {failedByDeadline ? "Просрочена" : STATUS_LABELS[task.status]} ·{" "}
              {PRIORITY_LABELS[task.priority]}
            </p>
          </div>
        }
      />
    </>
  );
}
