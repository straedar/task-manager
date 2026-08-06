import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Checklist } from "../types";
import { formatTaskDate, formatMoscowDeadline, parseTaskDate } from "../utils/date";
import { useDialog } from "../context/DialogContext";
import { CheckboxIndicator } from "./CheckboxIndicator";
import { ChecklistFormDialog } from "./CreateChecklistDialog";

interface ChecklistCardProps {
  checklist: Checklist;
  currentUserId: number;
  isAdmin: boolean;
  onToggleItem: (checklistId: number, itemId: number, completed: boolean) => void;
  onDelete: (id: number) => void;
  onUpdated: () => void;
  acting?: boolean;
}

function isChecklistOverdue(checklist: Checklist): boolean {
  if (checklist.status !== "open" || !checklist.expires_at) return false;
  const due = parseTaskDate(checklist.expires_at);
  return Boolean(due && due.getTime() < Date.now());
}

export function ChecklistCard({
  checklist,
  currentUserId,
  isAdmin,
  onToggleItem,
  onDelete,
  onUpdated,
  acting,
}: ChecklistCardProps) {
  const { confirm } = useDialog();
  const [editOpen, setEditOpen] = useState(false);
  const canToggle =
    checklist.status === "open" &&
    (checklist.assignee_id === currentUserId || isAdmin);
  const canManage = isAdmin || checklist.created_by === currentUserId;
  const doneCount = checklist.items.filter((i) => i.completed_at).length;
  const total = checklist.items.length;
  const incompleteAfterClose =
    checklist.status === "completed" &&
    (checklist.auto_completed || checklist.items.some((i) => !i.completed_at));
  const overdue = isChecklistOverdue(checklist);

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Удалить чеклист «${checklist.title}»?`,
      description: "Это действие нельзя отменить.",
    });
    if (!ok) return;
    onDelete(checklist.id);
  };

  return (
    <>
      <div
        className={`rounded-3xl p-3.5 shadow-soft ${
          incompleteAfterClose || overdue ? "card-accent-alert" : "bg-white"
        }`}
      >
        <div className="min-w-0">
          <h3 className="break-words text-[15px] font-semibold leading-snug text-gray-900">
            {checklist.title}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
              Чеклист
            </span>
            {checklist.is_private && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                Приватный
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              {doneCount}/{total}
            </span>
            {overdue && (
              <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                Просрочен
              </span>
            )}
            {checklist.status === "completed" && checklist.auto_completed && (
              <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                Просрочен
              </span>
            )}
            {incompleteAfterClose && !checklist.auto_completed && (
              <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                Не выполнен
              </span>
            )}
            {checklist.status === "completed" &&
              !incompleteAfterClose &&
              !checklist.auto_completed && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  Выполнен
                </span>
              )}
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {checklist.items.map((item) => {
            const checked = Boolean(item.completed_at);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!canToggle || acting}
                  onClick={() => onToggleItem(checklist.id, item.id, !checked)}
                  className={`flex w-full items-start gap-3 rounded-2xl px-2 py-1.5 text-left transition ${
                    canToggle ? "hover:bg-black/5" : "cursor-default"
                  } ${acting ? "opacity-60" : ""}`}
                >
                  <CheckboxIndicator checked={checked} className="mt-0" />
                  <span
                    className={`min-w-0 flex-1 break-words text-sm leading-6 ${
                      checked && !incompleteAfterClose
                        ? "text-gray-400 line-through"
                        : incompleteAfterClose
                          ? checked
                            ? "card-accent-desc line-through opacity-70"
                            : "card-accent-desc"
                          : "text-gray-800"
                    }`}
                  >
                    {item.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div
          className={`mt-2.5 flex items-end gap-2 border-t border-black/5 pt-2.5 ${
            canManage ? "justify-between" : ""
          }`}
        >
          <div className="min-w-0 flex-1 space-y-0.5 text-xs text-gray-400">
            <p className="truncate">Исполнитель: {checklist.assignee.nickname}</p>
            <p>Создан: {formatTaskDate(checklist.created_at)}</p>
            {checklist.status === "open" && checklist.expires_at && (
              <p className="text-accent-alert">
                {overdue
                  ? `Просрочен с ${formatMoscowDeadline(checklist.expires_at)}`
                  : `Срок до ${formatMoscowDeadline(checklist.expires_at)}`}
              </p>
            )}
            {checklist.status === "open" && !checklist.expires_at && (
              <p className="text-gray-400">Без срока</p>
            )}
            {checklist.completed_at && (
              <p className={incompleteAfterClose ? "text-accent-alert" : "text-green-600"}>
                Закрыт: {formatTaskDate(checklist.completed_at)}
                {checklist.auto_completed ? " · по сроку" : ""}
              </p>
            )}
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                disabled={acting}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-500 transition hover:bg-orange-100 disabled:opacity-50"
                aria-label="Изменить"
                title="Изменить"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={acting}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100 disabled:opacity-50"
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
        <ChecklistFormDialog
          open={editOpen}
          checklist={checklist}
          onClose={() => setEditOpen(false)}
          onSaved={onUpdated}
        />
      )}
    </>
  );
}
