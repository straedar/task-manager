import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { DiscussionIcon } from "./DiscussionIcon";
import type { Checklist } from "../types";
import { formatTaskDate, formatMoscowDeadline } from "../utils/date";
import {
  checklistShowsFailedItems,
  isChecklistOverdue,
} from "../utils/checklistStatus";
import {
  canActOnChecklistItem,
  nextChecklistItemAction,
  type ChecklistItemAction,
} from "../utils/checklistItemAction";
import { useDialog } from "../context/DialogContext";
import { CheckboxIndicator } from "./CheckboxIndicator";
import { ChecklistFormDialog } from "./CreateChecklistDialog";

interface ChecklistCardProps {
  checklist: Checklist;
  currentUserId: number;
  isAdmin: boolean;
  onToggleItem: (
    checklistId: number,
    itemId: number,
    payload: boolean | { action: ChecklistItemAction }
  ) => void;
  onDelete: (id: number) => void;
  onUpdated: () => void;
  acting?: boolean;
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
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const [editOpen, setEditOpen] = useState(false);
  const overdue = isChecklistOverdue(checklist);
  const showFailedItems = checklistShowsFailedItems(checklist);
  const canManage = isAdmin || checklist.created_by === currentUserId;
  const doneCount = checklist.items.filter((i) => i.completed_at).length;
  const total = checklist.items.length;
  const incompleteAfterClose =
    checklist.status === "completed" &&
    (checklist.auto_completed || checklist.items.some((i) => !i.completed_at));

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
        role="link"
        tabIndex={0}
        onClick={() => navigate(`/tasks/c/${checklist.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(`/tasks/c/${checklist.id}`);
          }
        }}
        className={`cursor-pointer rounded-3xl p-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md ${
          incompleteAfterClose || overdue ? "card-accent-alert" : "bg-white"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-gray-900">
              {checklist.title}
            </h3>
            <DiscussionIcon chat={checklist.chat} className="mt-0.5 h-4 w-4" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
              Чеклист
            </span>
            {checklist.is_shared && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                Общий
              </span>
            )}
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
            const claimed = Boolean(item.claimed_by) && !checked;
            const failed = showFailedItems && !checked;
            const action =
              !overdue &&
              nextChecklistItemAction(checklist, item, currentUserId, isAdmin);
            const canAct =
              Boolean(action) &&
              !overdue &&
              canActOnChecklistItem(checklist, item, currentUserId, isAdmin);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!canAct || acting}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!action) return;
                    if (checklist.is_shared) {
                      onToggleItem(checklist.id, item.id, { action });
                    } else {
                      onToggleItem(checklist.id, item.id, action === "complete");
                    }
                  }}
                  className={`flex w-full items-start gap-3 rounded-2xl px-2 py-1.5 text-left transition ${
                    canAct ? "hover:bg-black/5" : "cursor-default"
                  } ${acting ? "opacity-60" : ""}`}
                >
                  <CheckboxIndicator
                    checked={checked}
                    claimed={claimed}
                    failed={failed}
                    className="mt-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block break-words text-sm leading-6 ${
                        failed
                          ? "card-accent-desc line-through opacity-80"
                          : checked
                            ? incompleteAfterClose || overdue
                              ? "card-accent-desc line-through opacity-70"
                              : "text-gray-400 line-through"
                            : "text-gray-800"
                      }`}
                    >
                      {item.title}
                    </span>
                    {claimed && item.claimant && (
                      <span className="mt-0.5 block text-[11px] text-sky-600">
                        В работе: {item.claimant.nickname}
                      </span>
                    )}
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
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-xs text-gray-400">
              {checklist.is_shared
                ? `Постановщик: ${checklist.creator.nickname}`
                : `Исполнитель: ${checklist.assignee.nickname}`}
            </p>
            <p className="text-xs text-gray-400">
              Создан: {formatTaskDate(checklist.created_at)}
            </p>
            {checklist.status === "open" && checklist.expires_at && (
              <p className="text-xs text-accent-alert">
                {overdue
                  ? `Просрочен с ${formatMoscowDeadline(checklist.expires_at)}`
                  : `Срок до ${formatMoscowDeadline(checklist.expires_at)}`}
              </p>
            )}
            {checklist.completed_at && (
              <p
                className={`text-xs ${
                  incompleteAfterClose ? "text-accent-alert" : "text-green-600"
                }`}
              >
                Закрыт: {formatTaskDate(checklist.completed_at)}
                {checklist.auto_completed ? " · по сроку" : ""}
              </p>
            )}
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditOpen(true);
                }}
                disabled={acting}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-500 transition hover:bg-orange-100 disabled:opacity-50"
                aria-label="Изменить"
                title="Изменить"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete();
                }}
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
