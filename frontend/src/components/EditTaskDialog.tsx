import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Task, TaskPriority, User } from "../types";
import { beginEditing, endEditing } from "../lib/editingLock";
import { Modal } from "./Modal";
import { CheckboxIndicator } from "./CheckboxIndicator";
import { PriorityToggle } from "./PriorityToggle";
import { AssigneePicker } from "./AssigneePicker";
import { DeadlineField } from "./DeadlineField";
import {
  isPastMoscowDay,
  moscowDateKey,
  moscowDateKeyFromIso,
  moscowDateTimeIso,
  moscowTimeFromIso,
} from "../utils/moscow";
import { formatDayHeading } from "../utils/date";

interface EditTaskDialogProps {
  task: Task;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

export function EditTaskDialog({ task, open, onClose, onSaved }: EditTaskDialogProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [hasSubordinates, setHasSubordinates] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [isShared, setIsShared] = useState(task.is_shared);
  const [isPrivate, setIsPrivate] = useState(task.is_private);
  const [assigneeIds, setAssigneeIds] = useState(task.assignees.map((a) => a.id));
  const [hasDeadline, setHasDeadline] = useState(Boolean(task.due_at));
  const [deadlineDate, setDeadlineDate] = useState(() => moscowDateKey());
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    beginEditing();
    return () => endEditing();
  }, [open]);

  // Seed form only when the dialog opens (or switches to another task) —
  // not on every poll refresh of the same task object.
  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setIsShared(task.is_shared);
    setIsPrivate(task.is_private);
    setAssigneeIds(task.assignees.map((a) => a.id));
    setHasDeadline(Boolean(task.due_at));
    setDeadlineDate(
      (task.due_at && moscowDateKeyFromIso(task.due_at)) ||
        task.planned_for ||
        moscowDateKey()
    );
    setDeadlineTime(moscowTimeFromIso(task.due_at, "18:00"));
    setError("");
    api.getAssignableUsers().then(({ users, has_subordinates }) => {
      setHasSubordinates(has_subordinates);
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const a of task.assignees) {
        if (!byId.has(a.id)) {
          byId.set(a.id, { id: a.id, nickname: a.nickname, parent_id: a.parent_id });
        }
      }
      setUsers([...byId.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, "ru")));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally ignore task field updates while open
  }, [open, task.id]);

  const toggleAssignee = (id: number) => {
    if (isShared) return;
    setAssigneeIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!(next.length === 1 && next[0] === task.created_by)) {
        setIsPrivate(false);
      }
      return next;
    });
  };

  const setShared = (checked: boolean) => {
    if (checked && !hasSubordinates && !task.is_shared) {
      setError("Общую задачу можно включить только при наличии подчинённых");
      return;
    }
    setError("");
    setIsShared(checked);
    if (checked) {
      setIsPrivate(false);
      setAssigneeIds(users.map((u) => u.id));
    }
  };

  const assignedOnlyToCreator =
    !isShared && assigneeIds.length === 1 && assigneeIds[0] === task.created_by;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const prevDeadlineDay = task.due_at
        ? moscowDateKeyFromIso(task.due_at)
        : null;
      if (
        hasDeadline &&
        isPastMoscowDay(deadlineDate) &&
        deadlineDate !== prevDeadlineDay
      ) {
        setError("Нельзя указать прошедший день дедлайна");
        setLoading(false);
        return;
      }
      const dueAt = hasDeadline
        ? moscowDateTimeIso(deadlineDate, deadlineTime)
        : null;
      if (dueAt && new Date(dueAt).getTime() < Date.now()) {
        const sameAsBefore = task.due_at && dueAt === task.due_at;
        if (!sameAsBefore) {
          setError("Дедлайн не может быть в прошлом");
          setLoading(false);
          return;
        }
      }
      await api.updateTask(task.id, {
        title,
        description,
        priority,
        assigneeIds: isShared ? users.map((u) => u.id) : assigneeIds,
        is_shared: isShared,
        is_private: assignedOnlyToCreator && isPrivate,
        due_at: dueAt,
        planned_for: task.planned_for,
      });
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = isShared ? users.length > 0 : assigneeIds.length > 0;
  const canToggleShared = hasSubordinates || task.is_shared;

  return (
    <Modal open={open} onClose={onClose} title="Изменить задачу">
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 p-5">
        <label className="block w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Название</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            required
          />
        </label>

        <label className="block w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Описание</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`${inputClass} resize-none`}
          />
        </label>

        <div className="w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Приоритет</span>
          <PriorityToggle value={priority} onChange={setPriority} />
        </div>

        {task.planned_for && (
          <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-sm text-orange-800">
            День в планировщике:{" "}
            <span className="font-semibold">
              {formatDayHeading(task.planned_for)}
            </span>
          </div>
        )}

        <DeadlineField
          enabled={hasDeadline}
          dateKey={deadlineDate}
          onEnabledChange={setHasDeadline}
          onDateChange={setDeadlineDate}
          time={deadlineTime}
          onTimeChange={setDeadlineTime}
          enabledLabel="Со сроком"
          disabledLabel="Без срока"
        />

        <label
          className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition ${
            canToggleShared
              ? "cursor-pointer border-gray-200 bg-white hover:border-orange-200"
              : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
          }`}
        >
          <CheckboxIndicator checked={isShared} />
          <input
            type="checkbox"
            checked={isShared}
            disabled={!canToggleShared}
            onChange={(e) => setShared(e.target.checked)}
            className="sr-only"
          />
          <span className="text-sm font-medium text-gray-800">Общая задача</span>
        </label>

        {isShared ? (
          <div className="w-full rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3">
            <p className="mb-2 text-sm font-medium text-orange-800">Участники</p>
            <p className="break-words text-sm text-orange-700">
              Создатель и все его подчинённые
              {task.assignees.length > 0
                ? `: ${task.assignees.map((a) => a.nickname).join(", ")}`
                : ""}
            </p>
          </div>
        ) : (
          <div className="w-full">
            <span className="mb-2 block text-sm font-medium text-gray-700">Исполнители</span>
            <AssigneePicker users={users} selectedIds={assigneeIds} onToggle={toggleAssignee} />
          </div>
        )}

        {assignedOnlyToCreator && (
          <label className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-orange-200">
            <CheckboxIndicator checked={isPrivate} />
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="sr-only"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800">Приватная задача</span>
              <span className="block text-xs text-gray-400">
                Видна только создателю
              </span>
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="w-full rounded-2xl py-3.5 font-medium text-white gradient-accent disabled:opacity-50"
        >
          {loading ? "Сохранение..." : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}
