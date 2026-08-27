import type { Checklist, ChecklistItem } from "../types";
import { CheckboxIndicator } from "./CheckboxIndicator";
import {
  canActOnChecklistItem,
  canUnclaimChecklistItem,
  nextChecklistItemAction,
  type ChecklistItemAction,
} from "../utils/checklistItemAction";
import { useLongPress } from "../hooks/useLongPress";

type Props = {
  checklist: Checklist;
  item: ChecklistItem;
  currentUserId: number;
  isAdmin: boolean;
  overdue: boolean;
  showFailedItems: boolean;
  incompleteAfterClose: boolean;
  acting?: boolean;
  onToggle: (
    itemId: number,
    payload: boolean | { action: ChecklistItemAction }
  ) => void;
};

export function ChecklistItemRow({
  checklist,
  item,
  currentUserId,
  isAdmin,
  overdue,
  showFailedItems,
  incompleteAfterClose,
  acting = false,
  onToggle,
}: Props) {
  const checked = Boolean(item.completed_at);
  const claimed = Boolean(item.claimed_by) && !checked;
  const failed = showFailedItems && !checked;
  const action =
    !overdue && nextChecklistItemAction(checklist, item, currentUserId, isAdmin);
  const canAct =
    Boolean(action) &&
    !overdue &&
    canActOnChecklistItem(checklist, item, currentUserId, isAdmin);
  const canUnclaim =
    !overdue &&
    canUnclaimChecklistItem(checklist, item, currentUserId, isAdmin);

  const { bind, consumeClickSkip } = useLongPress(
    canUnclaim && !acting
      ? () => onToggle(item.id, { action: "unclaim" })
      : null
  );

  return (
    <li>
      <button
        type="button"
        disabled={(!canAct && !canUnclaim) || acting}
        {...(canUnclaim ? bind : {})}
        onClick={(e) => {
          e.stopPropagation();
          if (consumeClickSkip()) return;
          if (!action || !canAct) return;
          if (checklist.is_shared) {
            onToggle(item.id, { action });
          } else {
            onToggle(item.id, action === "complete");
          }
        }}
        title={
          canUnclaim
            ? "Зажмите, чтобы отказаться от пункта"
            : undefined
        }
        className={`flex w-full items-start gap-3 rounded-2xl px-2 py-1.5 text-left transition touch-manipulation select-none ${
          canAct || canUnclaim ? "hover:bg-black/5" : "cursor-default"
        } ${acting ? "opacity-60" : ""}`}
        style={canUnclaim ? { WebkitTouchCallout: "none" } : undefined}
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
              {canUnclaim ? " · зажмите, чтобы отказаться" : ""}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
