import type { Checklist } from "../types";
import { parseTaskDate } from "./date";

/** Open checklist past its expires_at — frozen, counts as expired (not active work). */
export function isChecklistOverdue(checklist: Checklist, now = Date.now()): boolean {
  if (checklist.status !== "open" || !checklist.expires_at) return false;
  const due = parseTaskDate(checklist.expires_at);
  return Boolean(due && due.getTime() < now);
}

/** Unfinished items should show failed (red X) when overdue or closed incomplete. */
export function checklistShowsFailedItems(checklist: Checklist): boolean {
  if (isChecklistOverdue(checklist)) return true;
  if (checklist.status !== "completed") return false;
  return (
    Boolean(checklist.auto_completed) ||
    checklist.items.some((i) => !i.completed_at)
  );
}
