import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { FeedbackBatch, FeedbackItemInput, FeedbackKind } from "../types";

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-from)]";

type DraftRow = FeedbackItemInput & { key: string };

function blankRow(kind: FeedbackKind = "problem"): DraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: "",
    description: "",
  };
}

type Props = {
  open: boolean;
  initial?: FeedbackBatch | null;
  onClose: () => void;
  onSaved: (batch: FeedbackBatch) => void;
};

export function FeedbackFormDialog({ open, initial, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (initial && initial.items.length > 0) {
      setRows(
        initial.items.map((item) => ({
          key: `edit-${item.id}`,
          kind: item.kind,
          title: item.title,
          description: item.description,
        }))
      );
    } else {
      setRows([blankRow("problem")]);
    }
  }, [open, initial]);

  const updateRow = (key: string, patch: Partial<FeedbackItemInput>) => {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  };

  const addRow = (kind: FeedbackKind) => {
    setRows((prev) => [...prev, blankRow(kind)]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const items = rows.map(({ kind, title, description }) => ({
      kind,
      title: title.trim(),
      description: description.trim(),
    }));
    if (items.some((item) => !item.title || !item.description)) {
      setError("Заполните название и описание у каждого пункта");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = initial
        ? await api.updateFeedback(initial.id, items)
        : await api.createFeedback(items);
      onSaved(res.item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={initial ? "Изменить обращение" : "Проблема / улучшение"}
      maxWidth="sm:max-w-xl"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4 p-5">
        <p className="text-sm text-[var(--text-muted)]">
          Добавьте одну или несколько проблем и предложений. Всё отправится одним
          нажатием.
        </p>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)]/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex gap-1 rounded-xl bg-[var(--surface)] p-1">
                  <button
                    type="button"
                    onClick={() => updateRow(row.key, { kind: "problem" })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      row.kind === "problem"
                        ? "bg-red-500 text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Проблема
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRow(row.key, { kind: "improvement" })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      row.kind === "improvement"
                        ? "bg-emerald-500 text-white"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Улучшение
                  </button>
                </div>
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(row.key)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-red-500 disabled:opacity-30"
                  aria-label={`Удалить пункт ${index + 1}`}
                  title="Удалить пункт"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <label className="mb-2 block">
                <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Название
                </span>
                <input
                  value={row.title}
                  onChange={(e) => updateRow(row.key, { title: e.target.value })}
                  maxLength={200}
                  placeholder={
                    row.kind === "problem"
                      ? "Кратко о проблеме"
                      : "Кратко о предложении"
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Описание
                </span>
                <textarea
                  value={row.description}
                  onChange={(e) =>
                    updateRow(row.key, { description: e.target.value })
                  }
                  maxLength={5000}
                  rows={3}
                  placeholder="Подробности…"
                  className={`${inputClass} resize-y`}
                />
              </label>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addRow("problem")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:border-red-300 hover:text-red-600"
          >
            <Plus className="h-4 w-4" />
            Проблема
          </button>
          <button
            type="button"
            onClick={() => addRow("improvement")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:border-emerald-300 hover:text-emerald-600"
          >
            <Plus className="h-4 w-4" />
            Улучшение
          </button>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-xl py-3 text-sm font-medium text-white gradient-accent disabled:opacity-50"
          >
            {saving ? "Отправка..." : initial ? "Сохранить" : "Отправить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
