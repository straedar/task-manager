import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Idea, IdeaPrivacy, IdeaTag } from "../types";
import { IDEA_PRIVACY_LABELS, IDEA_TAG_LABELS } from "../types";
import { beginEditing, endEditing } from "../lib/editingLock";
import { Modal } from "./Modal";
import { CheckboxIndicator } from "./CheckboxIndicator";

interface IdeaFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  idea?: Idea | null;
}

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

const TAGS: IdeaTag[] = ["entertainment", "work"];
const PRIVACIES: IdeaPrivacy[] = ["personal", "public"];

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function IdeaFormDialog({ open, onClose, onSaved, idea }: IdeaFormDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState<IdeaTag>("work");
  const [privacy, setPrivacy] = useState<IdeaPrivacy>("personal");
  const [hasDue, setHasDue] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    beginEditing();
    return () => endEditing();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (idea) {
      setTitle(idea.title);
      setDescription(idea.description);
      setTag(idea.tag);
      setPrivacy(idea.privacy);
      setHasDue(Boolean(idea.due_at));
      setDueAt(toLocalInputValue(idea.due_at));
    } else {
      setTitle("");
      setDescription("");
      setTag("work");
      setPrivacy("personal");
      setHasDue(false);
      setDueAt("");
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when dialog opens / switches idea
  }, [open, idea?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const payload = {
      title,
      description,
      tag,
      privacy,
      due_at: hasDue && dueAt ? new Date(dueAt).toISOString() : null,
    };
    try {
      if (idea) {
        await api.updateIdea(idea.id, payload);
      } else {
        await api.createIdea(payload);
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
    <Modal open={open} onClose={onClose} title={idea ? "Изменить идею" : "Новая идея"}>
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
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Тег</span>
          <div className="flex w-full rounded-2xl bg-gray-100 p-1">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(t)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                  tag === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                }`}
              >
                {IDEA_TAG_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Приватность</span>
          <div className="flex w-full rounded-2xl bg-gray-100 p-1">
            {PRIVACIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrivacy(p)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                  privacy === p ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                }`}
              >
                {IDEA_PRIVACY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <CheckboxIndicator checked={hasDue} />
          <input
            type="checkbox"
            checked={hasDue}
            onChange={(e) => setHasDue(e.target.checked)}
            className="sr-only"
          />
          <span className="text-sm font-medium text-gray-800">Срок выполнения</span>
        </label>

        {hasDue && (
          <label className="block w-full">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Выполнить до</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={inputClass}
              required={hasDue}
            />
          </label>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl py-3.5 font-medium text-white gradient-accent disabled:opacity-50"
        >
          {loading ? "Сохранение..." : idea ? "Сохранить" : "Создать"}
        </button>
      </form>
    </Modal>
  );
}
