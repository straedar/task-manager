import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import type { Checklist, Preset, User } from "../types";
import { Modal } from "./Modal";
import { AssigneePicker } from "./AssigneePicker";
import { CheckboxIndicator } from "./CheckboxIndicator";
import { Select } from "./Select";
import { isPastMoscowDay, moscowDateKey, moscowDateKeyFromIso, moscowDateTimeIso, moscowTimeFromIso } from "../utils/moscow";
import { beginEditing, endEditing } from "../lib/editingLock";
import { DeadlineField } from "./DeadlineField";
import { formatDayHeading } from "../utils/date";

interface ChecklistFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  checklist?: Checklist | null;
  plannedDateKey?: string | null;
}

type DraftItem = { id?: number; title: string };

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

export function ChecklistFormDialog({
  open,
  onClose,
  onSaved,
  checklist = null,
  plannedDateKey = null,
}: ChecklistFormDialogProps) {
  const { user } = useAuth();
  const { confirm } = useDialog();
  const editing = Boolean(checklist);
  const [users, setUsers] = useState<User[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ title: "" }]);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [hasDeadline, setHasDeadline] = useState(true);
  const [deadlineDate, setDeadlineDate] = useState(() => moscowDateKey());
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [hasSubordinates, setHasSubordinates] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    beginEditing();
    return () => endEditing();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api.getAssignableUsers().then(({ users: next, has_subordinates }) => {
      setUsers(next);
      setHasSubordinates(Boolean(has_subordinates));
      if (!checklist && next.length === 1) setAssigneeId(next[0].id);
    });
    if (!checklist) {
      api
        .getPresets("checklist")
        .then(({ presets: next }) => setPresets(next))
        .catch(() => setPresets([]));
    } else {
      setPresets([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when dialog opens / switches checklist
  }, [open, checklist?.id]);

  useEffect(() => {
    if (!open) return;
    if (checklist) {
      setTitle(checklist.title);
      setItems(
        checklist.items.length > 0
          ? checklist.items.map((item) => ({ id: item.id, title: item.title }))
          : [{ title: "" }]
      );
      setAssigneeId(checklist.assignee_id);
      setHasDeadline(Boolean(checklist.expires_at));
      setDeadlineDate(
        (checklist.expires_at && moscowDateKeyFromIso(checklist.expires_at)) ||
          checklist.planned_for ||
          moscowDateKey()
      );
      setDeadlineTime(moscowTimeFromIso(checklist.expires_at, "18:00"));
      setIsPrivate(Boolean(checklist.is_private));
      setIsShared(Boolean(checklist.is_shared));
      setPresetId("");
    } else {
      setTitle("");
      setItems([{ title: "" }]);
      setAssigneeId(null);
      setHasDeadline(true);
      setDeadlineDate(plannedDateKey || moscowDateKey());
      setDeadlineTime("18:00");
      setIsPrivate(false);
      setIsShared(false);
      setPresetId("");
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when dialog opens / switches checklist
  }, [open, checklist?.id]);

  const ownerId = checklist?.created_by ?? user?.id ?? null;
  const assignedToSelf = Boolean(ownerId && assigneeId === ownerId) && !isShared;

  const setAssignee = (id: number) => {
    if (isShared) return;
    setAssigneeId(id);
    if (!(ownerId && id === ownerId)) setIsPrivate(false);
  };

  const setShared = (checked: boolean) => {
    if (checked && !hasSubordinates && !checklist?.is_shared) {
      setError("Общий чеклист может создать только пользователь с подчинёнными");
      return;
    }
    setError("");
    setIsShared(checked);
    if (checked) {
      setIsPrivate(false);
      if (user) setAssigneeId(user.id);
    }
  };

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
    setItems(
      preset.items.length > 0
        ? preset.items.map((itemTitle) => ({ title: itemTitle }))
        : [{ title: "" }]
    );
    setHasDeadline(preset.has_deadline !== false);
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

  const updateItem = (index: number, value: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, title: value } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, { title: "" }]);

  const removeItem = (index: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const cleaned = items
      .map((item) => ({ id: item.id, title: item.title.trim() }))
      .filter((item) => item.title);
    const effectiveAssigneeId = isShared && user ? (checklist?.created_by ?? user.id) : assigneeId;
    if (!effectiveAssigneeId) {
      setError("Выберите исполнителя");
      return;
    }
    if (cleaned.length === 0) {
      setError("Добавьте хотя бы один пункт");
      return;
    }

    setLoading(true);
    try {
      const dateKey = hasDeadline ? deadlineDate : null;
      const prevDeadlineDay = checklist?.expires_at
        ? moscowDateKeyFromIso(checklist.expires_at)
        : null;
      if (!checklist && hasDeadline && isPastMoscowDay(dateKey)) {
        setError("Нельзя указать прошедший день");
        setLoading(false);
        return;
      }
      if (
        checklist &&
        hasDeadline &&
        dateKey &&
        isPastMoscowDay(dateKey) &&
        dateKey !== prevDeadlineDay
      ) {
        setError("Нельзя указать прошедший день дедлайна");
        setLoading(false);
        return;
      }
      const expiresAt =
        hasDeadline && dateKey ? moscowDateTimeIso(dateKey, deadlineTime) : null;
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        const sameAsBefore =
          checklist?.expires_at && expiresAt === checklist.expires_at;
        if (!sameAsBefore) {
          setError("Дедлайн не может быть в прошлом");
          setLoading(false);
          return;
        }
      }
      if (checklist) {
        await api.updateChecklist(checklist.id, {
          title: title.trim(),
          assignee_id: effectiveAssigneeId,
          items: cleaned,
          has_deadline: hasDeadline,
          // Keep planner day as-is when editing deadline.
          planned_for: checklist.planned_for,
          expires_at: expiresAt,
          is_private: assignedToSelf && isPrivate,
          is_shared: isShared,
        });
      } else {
        await api.createChecklist({
          title: title.trim(),
          assignee_id: effectiveAssigneeId,
          items: cleaned.map((item) => item.title),
          has_deadline: hasDeadline,
          // Planner day only when created from planner; deadline is independent.
          planned_for: plannedDateKey || null,
          expires_at: expiresAt,
          is_private: assignedToSelf && isPrivate,
          is_shared: isShared,
        });
      }
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Изменить чеклист" : "Новый чеклист"}>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 p-5">
        {!editing && presets.length > 0 && (
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

        <div className="w-full">
          <span className="mb-2 block text-sm font-medium text-gray-700">Пункты</span>
          <div className="flex flex-col gap-2">
            {items.map((item, index) => (
              <div key={item.id ?? `new-${index}`} className="flex gap-2">
                <input
                  value={item.title}
                  onChange={(e) => updateItem(index, e.target.value)}
                  placeholder={`Пункт ${index + 1}`}
                  className={inputClass}
                  required={index === 0}
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length <= 1}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 text-gray-400 transition hover:border-red-200 hover:text-red-500 disabled:opacity-40"
                  aria-label="Удалить пункт"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700"
          >
            <Plus className="h-4 w-4" />
            Добавить пункт
          </button>
        </div>

        {plannedDateKey && (
          <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-sm text-orange-800">
            День в планировщике:{" "}
            <span className="font-semibold">{formatDayHeading(plannedDateKey)}</span>
          </div>
        )}
        {editing && checklist?.planned_for && !plannedDateKey && (
          <div className="rounded-2xl border border-orange-100 bg-orange-50/70 px-4 py-3 text-sm text-orange-800">
            День в планировщике:{" "}
            <span className="font-semibold">
              {formatDayHeading(checklist.planned_for)}
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
            hasSubordinates || checklist?.is_shared
              ? "cursor-pointer border-gray-200 bg-white hover:border-orange-200"
              : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
          }`}
        >
          <CheckboxIndicator checked={isShared} />
          <input
            type="checkbox"
            checked={isShared}
            disabled={!hasSubordinates && !checklist?.is_shared}
            onChange={(e) => setShared(e.target.checked)}
            className="sr-only"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">Общий чеклист</span>
            <span className="block text-xs text-gray-400">
              Участники берут пункты (▶), затем отмечают выполненными (✓)
            </span>
          </span>
        </label>

        {!hasSubordinates && !checklist?.is_shared && (
          <p className="text-xs text-gray-400">
            Общий чеклист можно создать, когда у вас есть подчинённые в структуре
          </p>
        )}

        {isShared ? (
          <div className="w-full rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3">
            <p className="mb-2 text-sm font-medium text-orange-800">Участники</p>
            <p className="break-words text-sm text-orange-700">
              Вы и все ваши подчинённые: {users.map((u) => u.nickname).join(", ") || "—"}
            </p>
            <p className="mt-2 text-xs text-orange-600">
              Чужой пункт может завершить только постановщик или админ
            </p>
          </div>
        ) : (
          <div className="w-full">
            <span className="mb-2 block text-sm font-medium text-gray-700">Исполнитель</span>
            <AssigneePicker
              users={users}
              selectedIds={assigneeId ? [assigneeId] : []}
              onToggle={setAssignee}
            />
          </div>
        )}

        {assignedToSelf && (
          <label className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-sky-200">
            <CheckboxIndicator checked={isPrivate} />
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="sr-only"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800">Приватный чеклист</span>
              <span className="block text-xs text-gray-400">
                Виден только вам, руководитель в списке его не увидит
              </span>
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading || (!isShared && !assigneeId)}
          className="w-full rounded-2xl py-3.5 font-medium text-white gradient-accent disabled:opacity-50"
        >
          {loading ? "Сохранение..." : editing ? "Сохранить" : "Создать"}
        </button>
      </form>
    </Modal>
  );
}

/** @deprecated use ChecklistFormDialog */
export function CreateChecklistDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  return <ChecklistFormDialog open={open} onClose={onClose} onSaved={onCreated} />;
}
