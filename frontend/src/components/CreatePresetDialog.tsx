import { useCallback, useEffect, useState } from "react";
import { CheckSquare, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useDialog } from "../context/DialogContext";
import type { Preset, PresetKind, TaskPriority } from "../types";
import { Modal } from "./Modal";
import { PriorityToggle } from "./PriorityToggle";

interface CreatePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

function resetFormFields(setters: {
  setName: (v: string) => void;
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setPriority: (v: TaskPriority) => void;
  setItems: (v: string[]) => void;
  setHasDeadline: (v: boolean) => void;
}) {
  setters.setName("");
  setters.setTitle("");
  setters.setDescription("");
  setters.setPriority("medium");
  setters.setItems([""]);
  setters.setHasDeadline(true);
}

export function CreatePresetDialog({ open, onOpenChange, onCreated }: CreatePresetDialogProps) {
  const { confirm } = useDialog();
  const [kind, setKind] = useState<PresetKind | null>(null);
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [items, setItems] = useState<string[]>([""]);
  const [hasDeadline, setHasDeadline] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadPresets = useCallback(async () => {
    try {
      const { presets: next } = await api.getPresets();
      setPresets(next);
    } catch {
      setPresets([]);
    }
  }, []);

  const goToList = useCallback(() => {
    setKind(null);
    setEditingPreset(null);
    setError("");
    resetFormFields({ setName, setTitle, setDescription, setPriority, setItems, setHasDeadline });
    loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setEditingPreset(null);
    resetFormFields({ setName, setTitle, setDescription, setPriority, setItems, setHasDeadline });
    setError("");
    setDeletingId(null);
    loadPresets();
  }, [open, loadPresets]);

  const close = () => onOpenChange(false);

  const startCreate = (nextKind: PresetKind) => {
    setEditingPreset(null);
    resetFormFields({ setName, setTitle, setDescription, setPriority, setItems, setHasDeadline });
    setError("");
    setKind(nextKind);
  };

  const startEdit = (preset: Preset) => {
    setEditingPreset(preset);
    setKind(preset.kind);
    setName(preset.name);
    setTitle(preset.title);
    setDescription(preset.description ?? "");
    setPriority(preset.priority ?? "medium");
    setItems(preset.items.length > 0 ? [...preset.items] : [""]);
    setHasDeadline(preset.has_deadline !== false);
    setError("");
  };

  const handleDelete = async (preset: Preset) => {
    const ok = await confirm({
      title: `Удалить пресет «${preset.name}»?`,
      description: "Пресет исчезнет из списка шаблонов.",
    });
    if (!ok) return;
    setDeletingId(preset.id);
    setError("");
    try {
      await api.deletePreset(preset.id);
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  };

  const updateItem = (index: number, value: string) => {
    setItems((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addItem = () => setItems((prev) => [...prev, ""]);

  const removeItem = (index: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    setError("");
    setLoading(true);
    try {
      const presetName = name.trim() || title.trim();
      if (kind === "task") {
        const payload = {
          name: presetName,
          title: title.trim(),
          description,
          priority,
        };
        if (editingPreset) {
          await api.updatePreset(editingPreset.id, payload);
        } else {
          await api.createPreset({ kind: "task", ...payload });
        }
      } else {
        const cleaned = items.map((item) => item.trim()).filter(Boolean);
        if (cleaned.length === 0) {
          setError("Добавьте хотя бы один пункт");
          setLoading(false);
          return;
        }
        const payload = {
          name: presetName,
          title: title.trim(),
          has_deadline: hasDeadline,
          items: cleaned,
        };
        if (editingPreset) {
          await api.updatePreset(editingPreset.id, payload);
        } else {
          await api.createPreset({ kind: "checklist", ...payload });
        }
      }

      if (editingPreset) {
        goToList();
        onCreated?.();
      } else {
        close();
        onCreated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const taskPresets = presets.filter((p) => p.kind === "task");
  const checklistPresets = presets.filter((p) => p.kind === "checklist");

  const formTitle =
    editingPreset
      ? kind === "task"
        ? "Изменить пресет задачи"
        : "Изменить пресет чеклиста"
      : kind === "task"
        ? "Пресет задачи"
        : kind === "checklist"
          ? "Пресет чеклиста"
          : "Пресеты";

  const renderPresetRow = (preset: Preset) => {
    const isTask = preset.kind === "task";
    return (
      <div
        key={preset.id}
        className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            isTask ? "bg-orange-50 text-orange-500" : "bg-sky-50 text-sky-600"
          }`}
        >
          {isTask ? <ListTodo className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
        </span>
        <button
          type="button"
          onClick={() => startEdit(preset)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900 hover:text-orange-600"
          title="Изменить"
        >
          {preset.name}
        </button>
        <button
          type="button"
          onClick={() => startEdit(preset)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition hover:bg-orange-50 hover:text-orange-500"
          aria-label={`Изменить пресет ${preset.name}`}
          title="Изменить"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleDelete(preset)}
          disabled={deletingId === preset.id}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
          aria-label={`Удалить пресет ${preset.name}`}
          title="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <Modal open={open} onClose={close} title={formTitle}>
      {!kind ? (
        <div className="flex flex-col gap-4 p-5">
          {presets.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Ваши пресеты</p>
              {taskPresets.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Задачи
                  </p>
                  {taskPresets.map(renderPresetRow)}
                </div>
              )}
              {checklistPresets.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Чеклисты
                  </p>
                  {checklistPresets.map(renderPresetRow)}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Создать новый</p>
            <button
              type="button"
              onClick={() => startCreate("task")}
              className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-orange-200 hover:bg-orange-50/50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                <ListTodo className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">Пресет задачи</span>
                <span className="block text-xs text-gray-500">
                  Название, описание и приоритет
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => startCreate("checklist")}
              className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-sky-200 hover:bg-sky-50/50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                <CheckSquare className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-900">Пресет чеклиста</span>
                <span className="block text-xs text-gray-500">Пункты и срок по умолчанию</span>
              </span>
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 p-5">
          <button
            type="button"
            onClick={goToList}
            className="self-start text-xs font-medium text-gray-400 hover:text-gray-600"
          >
            ← Назад к списку
          </button>

          <label className="block w-full">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Название пресета
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Ежедневный обход"
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-gray-400">
              Если пусто — возьмём название {kind === "task" ? "задачи" : "чеклиста"}
            </span>
          </label>

          <label className="block w-full">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              {kind === "task" ? "Название задачи" : "Название чеклиста"}
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              required
            />
          </label>

          {kind === "task" ? (
            <>
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
            </>
          ) : (
            <>
              <div className="w-full">
                <span className="mb-2 block text-sm font-medium text-gray-700">Пункты</span>
                <div className="flex flex-col gap-2">
                  {items.map((item, index) => (
                    <div key={`preset-item-${index}`} className="flex gap-2">
                      <input
                        value={item}
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

              <div className="w-full">
                <span className="mb-2 block text-sm font-medium text-gray-700">Дедлайн</span>
                <div className="flex w-full rounded-2xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setHasDeadline(true)}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                      hasDeadline ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                    }`}
                  >
                    Со сроком
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasDeadline(false)}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                      !hasDeadline ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                    }`}
                  >
                    Без срока
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl py-3.5 font-medium text-white gradient-accent disabled:opacity-50"
          >
            {loading
              ? "Сохранение..."
              : editingPreset
                ? "Сохранить изменения"
                : "Сохранить пресет"}
          </button>
        </form>
      )}
    </Modal>
  );
}
