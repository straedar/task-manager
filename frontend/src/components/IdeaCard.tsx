import { useState } from "react";
import { Check, Lock, Pencil, Trash2, Users } from "lucide-react";
import type { Idea } from "../types";
import { IDEA_PRIVACY_LABELS, IDEA_TAG_LABELS } from "../types";
import { formatTaskDate, parseTaskDate } from "../utils/date";
import { useDialog } from "../context/DialogContext";
import { IdeaFormDialog } from "./IdeaFormDialog";

const tagStyles = {
  entertainment: "bg-violet-100 text-violet-700",
  work: "bg-sky-100 text-sky-700",
};

const actionBtn =
  "flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-50";

const checkBtn =
  "flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition disabled:opacity-50";

interface IdeaCardProps {
  idea: Idea;
  currentUserId: number;
  isAdmin: boolean;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdated: () => void;
  actingId?: number | null;
}

export function isIdeaOverdue(idea: Idea, now = new Date()): boolean {
  if (idea.status === "completed" || !idea.due_at) return false;
  const due = parseTaskDate(idea.due_at);
  if (!due) return false;
  return due.getTime() < now.getTime();
}

export function IdeaCard({
  idea,
  currentUserId,
  isAdmin,
  onComplete,
  onDelete,
  onUpdated,
  actingId,
}: IdeaCardProps) {
  const { confirm } = useDialog();
  const [editOpen, setEditOpen] = useState(false);
  const canManage = isAdmin || idea.created_by === currentUserId;
  const overdue = isIdeaOverdue(idea);
  const showCompleteAction = canManage && idea.status === "open";
  const showCompletedMark = idea.status === "completed";
  const hasCornerCheck = showCompleteAction || showCompletedMark;

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Удалить идею «${idea.title}»?`,
      description: "Это действие нельзя отменить.",
    });
    if (!ok) return;
    onDelete(idea.id);
  };

  return (
    <>
      <div
        className={`relative rounded-3xl p-3.5 shadow-soft transition ${
          overdue ? "card-accent-alert" : "bg-white"
        }`}
      >
        {showCompleteAction && (
          <button
            onClick={() => onComplete(idea.id)}
            disabled={actingId === idea.id}
            className={`${checkBtn} absolute right-3 top-3 z-10 bg-gray-900 text-white hover:bg-gray-800`}
            aria-label="Выполнить"
            title="Выполнить"
          >
            <Check className="h-6 w-6" strokeWidth={2.5} />
          </button>
        )}
        {showCompletedMark && (
          <div
            className={`${checkBtn} absolute right-3 top-3 z-10 bg-green-100 text-green-600`}
            aria-label="Выполнено"
            title="Выполнено"
          >
            <Check className="h-6 w-6" strokeWidth={2.5} />
          </div>
        )}

        <h3
          className={`break-words text-[15px] font-semibold leading-snug text-gray-900 ${
            hasCornerCheck ? "pr-12" : ""
          }`}
        >
          {idea.title}
        </h3>

        <div className="mt-1 flex flex-wrap gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tagStyles[idea.tag]}`}>
            {IDEA_TAG_LABELS[idea.tag]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {idea.privacy === "personal" ? (
              <Lock className="h-3 w-3" />
            ) : (
              <Users className="h-3 w-3" />
            )}
            {IDEA_PRIVACY_LABELS[idea.privacy]}
          </span>
          {idea.status === "completed" && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
              Выполнена
            </span>
          )}
          {overdue && (
            <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
              Просрочена
            </span>
          )}
        </div>

        {idea.description && (
          <p
            className={`mt-2 break-words whitespace-pre-wrap text-sm leading-snug ${
              overdue ? "card-accent-desc" : "text-gray-600"
            }`}
          >
            {idea.description}
          </p>
        )}

        <div
          className={`mt-2.5 flex items-end gap-2 border-t border-black/5 pt-2.5 ${
            canManage ? "justify-between" : ""
          }`}
        >
          <div className="min-w-0 flex-1 space-y-0.5 text-xs text-gray-400">
            <p className="truncate">Автор: {idea.creator.nickname}</p>
            <p>Создана: {formatTaskDate(idea.created_at)}</p>
            {idea.due_at && (
              <p className={overdue ? "text-accent-alert" : undefined}>
                Срок: {formatTaskDate(idea.due_at)}
              </p>
            )}
            {idea.completed_at && (
              <p className="text-green-600">Выполнена: {formatTaskDate(idea.completed_at)}</p>
            )}
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setEditOpen(true)}
                disabled={actingId === idea.id}
                className={`${actionBtn} bg-orange-50 text-orange-500 hover:bg-orange-100`}
                aria-label="Изменить"
                title="Изменить"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={actingId === idea.id}
                className={`${actionBtn} bg-red-50 text-red-500 hover:bg-red-100`}
                aria-label="Удалить"
                title="Удалить"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {canManage && (
        <IdeaFormDialog
          open={editOpen}
          idea={idea}
          onClose={() => setEditOpen(false)}
          onSaved={onUpdated}
        />
      )}
    </>
  );
}
