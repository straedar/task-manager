import type { Checklist, ChecklistItem } from "../types";

export type ChecklistItemAction = "claim" | "complete" | "uncomplete";

/** Следующее действие по клику на пункт (null — клик недоступен). */
export function nextChecklistItemAction(
  checklist: Checklist,
  item: ChecklistItem,
  userId: number,
  isAdmin: boolean
): ChecklistItemAction | null {
  if (checklist.status !== "open") return null;

  const checked = Boolean(item.completed_at);
  const claimed = Boolean(item.claimed_by);
  const isCreator = checklist.created_by === userId;
  const canManageOthers = isCreator || isAdmin;

  if (checklist.is_shared) {
    if (checked) {
      if (item.claimed_by === userId || canManageOthers) return "uncomplete";
      return null;
    }
    if (!claimed) return "claim";
    if (item.claimed_by === userId || canManageOthers) return "complete";
    return null;
  }

  const canToggle = checklist.assignee_id === userId || isAdmin;
  if (!canToggle) return null;
  return checked ? "uncomplete" : "complete";
}

export function canActOnChecklistItem(
  checklist: Checklist,
  item: ChecklistItem,
  userId: number,
  isAdmin: boolean
): boolean {
  return nextChecklistItemAction(checklist, item, userId, isAdmin) !== null;
}
