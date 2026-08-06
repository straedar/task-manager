import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import type { Preset, TaskPriority, User } from "../types";
import { Modal } from "./Modal";
import { CheckboxIndicator } from "./CheckboxIndicator";
import { PriorityToggle } from "./PriorityToggle";
import { AssigneePicker } from "./AssigneePicker";
import { Select } from "./Select";
import { moscowDateTimeIso, isPastMoscowDay, moscowDateKey } from "../utils/moscow";
import { beginEditing, endEditing } from "../lib/editingLock";
import { DeadlineField } from "./DeadlineField";

interface CreateTaskDialogProps {
  onCreated: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** YYYY-MM-DD — set due_at for that Moscow day */
  plannedDateKey?: string | null;
}

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

export function CreateTaskDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  plannedDateKey = null,
}: CreateTaskDialogProps) {
  const { user } = useAuth();
  const { confirm } = useDialog();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolledOpen(next);
  };
  const [users, setUsers] = useState<User[]>([]);
  const [hasSubordinates, setHasSubordinates] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [isShared, setIsShared] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState(() => moscowDateKey());
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    beginEditing();
    return () => endEditing();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api.getAssignableUsers().then(({ users, has_subordinates }) => {
      setUsers(users);
      setHasSubordinates(has_subordinates);
      if (users.length === 1) setAssigneeIds([users[0].id]);
    });
    api.getPresets("task").then(({ presets: next }) => setPresets(next)).catch(() => setPresets([]));
    setPresetId("");
    setHasDeadline(Boolean(plannedDateKey));
    setDeadlineDate(plannedDateKey || moscowDateKey());
    setDeadlineTime("18:00");
  }, [open, plannedDateKey]);

  const presetOptions = useMemo(
    () => [
      { value: "", label: "Без пресета" },
      ...presets.map((preset) => ({ value: String(preset.id), label: preset.name })),
    ],
    [presets]
  );

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (!id) return;
    const preset = presets.find((p) => p.id === Number(id));
    if (!preset) return;
    setTitle(preset.title);
    setDescription(preset.description);
    setPriority(preset.priority ?? "medium");
  };

  const deleteSelectedPreset = async () => {
    if (!presetId) return;
    const preset = presets.find((p) => p.id === Number(presetId));
    const ok = await confirm({
      title: `Удалить пресет «${preset?.name ?? ""}»?`,
      description: "Пресет исчезнет из списка шаблонов.",
    });
    if (!ok) return;
    try {
      await api.deletePreset(Number(presetId));
      setPresets((prev) => prev.filter((p) => p.id !== Number(presetId)));
      setPresetId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить пресет");
    }
  };

  const close = () => {
    setOpen(false);
    setError("");
  };

  const toggleAssignee = (id: number) => {
    if (isShared) return;
    setAssigneeIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!(user && next.length === 1 && next[0] === user.id)) {
        setIsPrivate(false);
      }
      return next;
    });
  };

  const setShared = (checked: boolean) => {
    if (checked && !hasSubordinates) {
      setError("Общую задачу может создать только пользователь с подчинёнными");
      return;
    }
    setError("");
    setIsShared(checked);
    if (checked) {
      setIsPrivate(false);
      setAssigneeIds(users.map((u) => u.id));
    }
  };

  const assignedOnlyToSelf =
    Boolean(user) &&
    !isShared &&
    assigneeIds.length === 1 &&
    assigneeIds[0] === user!.id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isShared && !hasSubordinates) {
      setError("Общую задачу может создать только пользователь с подчинёнными");
      return;
    }
    setLoading(true);
    try {
      const dateKey = hasDeadline ? plannedDateKey || deadlineDate : null;
      if (hasDeadline && isPastMoscowDay(dateKey)) {
        setError("Нельзя указать прошедший день");
        setLoading(false);
        return;
      }
      const dueAt = dateKey ? moscowDateTimeIso(dateKey, deadlineTime) : null;
      if (dueAt && new Date(dueAt).getTime() < Date.now()) {
        setError("Дедлайн не может быть в прошлом");
        setLoading(false);
        return;
      }
      await api.createTask({
        title,
        description,
        priority,
        assigneeIds: isShared ? users.map((u) => u.id) : assigneeIds,
        is_shared: isShared,
        is_private: assignedOnlyToSelf && isPrivate,
        due_at: dueAt,
        // Planner day only when created from planner; deadline alone must not defer the task.
        planned_for: plannedDateKey || null,
      });
      close();
      setTitle("");
      setDescription("");
      setPriority("medium");
      setIsShared(false);
      setIsPrivate(false);
      setAssigneeIds([]);
      setPresetId("");
      setHasDeadline(false);
      setDeadlineDate(moscowDateKey());
      setDeadlineTime("18:00");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = isShared
    ? hasSubordinates && users.length > 0
    : assigneeIds.length > 0;

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full gradient-accent text-white shadow transition hover:scale-105 sm:h-12 sm:w-12"
          aria-label="Создать задачу"
        >
          <Plus className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}

      <Modal open={open} onClose={close} title="Новая задача">
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 p-5">
          {presets.length > 0 && (
            <div className="w-full">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Пресет</span>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    value={presetId}
                    onChange={applyPreset}
                    options={presetOptions}
                    placeholder="Без пресета"
                    showAvatar={false}
                  />
                </div>
                {presetId && (
                  <button
                    type="button"
                    onClick={deleteSelectedPreset}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 text-gray-400 transition hover:border-red-200 hover:text-red-500"
                    aria-label="Удалить пресет"
                    title="Удалить пресет"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

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
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </label>

          <div className="w-full">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Приоритет</span>
            <PriorityToggle value={priority} onChange={setPriority} />
          </div>

          <DeadlineField
            enabled={hasDeadline}
            dateKey={deadlineDate}
            onEnabledChange={setHasDeadline}
            onDateChange={setDeadlineDate}
            lockedDateKey={plannedDateKey}
            time={deadlineTime}
            onTimeChange={setDeadlineTime}
          />

          <label
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition ${
              hasSubordinates
                ? "cursor-pointer border-gray-200 bg-white hover:border-orange-200"
                : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
            }`}
          >
            <CheckboxIndicator checked={isShared} />
            <input
              type="checkbox"
              checked={isShared}
              disabled={!hasSubordinates}
              onChange={(e) => setShared(e.target.checked)}
              className="sr-only"
            />
            <span className="text-sm font-medium text-gray-800">Общая задача</span>
          </label>

          {!hasSubordinates && (
            <p className="text-xs text-gray-400">
              Общую задачу можно создать, когда у вас есть подчинённые в структуре
            </p>
          )}

          {isShared ? (
            <div className="w-full rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3">
              <p className="mb-2 text-sm font-medium text-orange-800">Участники</p>
              <p className="break-words text-sm text-orange-700">
                Вы и все ваши подчинённые: {users.map((u) => u.nickname).join(", ")}
              </p>
              <p className="mt-2 text-xs text-orange-600">
                Любой участник может завершить задачу — она закроется у всех
              </p>
            </div>
          ) : (
            <div className="w-full">
              <span className="mb-2 block text-sm font-medium text-gray-700">Исполнители</span>
              <AssigneePicker users={users} selectedIds={assigneeIds} onToggle={toggleAssignee} />
            </div>
          )}

          {assignedOnlyToSelf && (
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
                  Видна только вам, руководитель в списке её не увидит
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
            {loading ? "Создание..." : "Создать"}
          </button>
        </form>
      </Modal>
    </>
  );
}
