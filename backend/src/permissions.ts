import type { ChecklistWithDetails, TaskWithAssignees, UserPublic } from "./types.js";
import { isRoot } from "./types.js";
import {
  getAllUsers,
  getAssignableUserIds,
  getDescendantIds,
  getSubtreeIds,
} from "./db/queries/users.js";
import { getTaskAssigneeIds } from "./db/queries/tasks.js";
import { hasPermission } from "./permissions/access.js";

export function getAssignableUsers(user: UserPublic): UserPublic[] {
  const ids = getAssignableUserIds(user);
  const all = getAllUsers();
  return all.filter((u) => ids.includes(u.id));
}

export function hasSubordinates(user: UserPublic): boolean {
  return getDescendantIds(user.id).length > 0;
}

/** Участники общей задачи: создатель + все его подчинённые */
export function getSharedTaskAssigneeIds(ownerId: number): number[] {
  return getSubtreeIds(ownerId);
}

export function canCreateSharedTask(user: UserPublic): boolean {
  return hasSubordinates(user);
}

export function canAssignToUsers(user: UserPublic, assigneeIds: number[]): boolean {
  if (assigneeIds.length === 0) return false;
  const allowed = new Set(getAssignableUserIds(user));
  return assigneeIds.every((id) => allowed.has(id));
}

export function canCreateTask(user: UserPublic, assigneeIds: number[]): boolean {
  if (!hasPermission(user, "tasks.create")) return false;
  return canAssignToUsers(user, assigneeIds);
}

export function canViewTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (!hasPermission(user, "tasks.view")) return false;
  if (task.is_private) return task.created_by === user.id;

  const subtree = new Set(getSubtreeIds(user.id));

  if (subtree.has(task.created_by)) return true;
  if (task.assignees.some((a) => subtree.has(a.id))) return true;

  return false;
}

export function canStartTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (task.status !== "pending") return false;
  return task.assignees.some((a) => a.id === user.id);
}

export function canCompleteTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (task.status !== "pending" && task.status !== "in_progress") return false;
  const assignee = task.assignees.find((a) => a.id === user.id);
  if (!assignee) return false;
  if (task.is_shared) return true;
  return assignee.completed_at === null;
}

/** Восстановить проваленную по сроку задачу: исполнитель или редактор. */
export function canRestoreTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (task.status !== "completed" || !task.auto_completed) return false;
  if (task.assignees.some((a) => a.id === user.id)) return true;
  return canEditTask(user, task);
}

export function canDeleteTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (task.is_private) {
    return task.created_by === user.id && hasPermission(user, "tasks.delete_own");
  }
  if (hasPermission(user, "tasks.manage_any") || isRoot(user)) return true;
  return task.created_by === user.id && hasPermission(user, "tasks.delete_own");
}

export function canEditTask(user: UserPublic, task: TaskWithAssignees): boolean {
  if (task.is_private) {
    return task.created_by === user.id && hasPermission(user, "tasks.edit_own");
  }
  if (hasPermission(user, "tasks.manage_any") || isRoot(user)) return true;
  return task.created_by === user.id && hasPermission(user, "tasks.edit_own");
}

export function filterVisibleTasks(user: UserPublic, tasks: TaskWithAssignees[]): TaskWithAssignees[] {
  return tasks.filter((task) => canViewTask(user, task));
}

export function canViewChecklist(user: UserPublic, checklist: ChecklistWithDetails): boolean {
  if (!hasPermission(user, "tasks.view")) return false;
  if (checklist.is_private) return checklist.created_by === user.id;

  const subtree = new Set(getSubtreeIds(user.id));
  if (checklist.is_shared) {
    // Общий: видят постановщик и все из его ветки (как у общей задачи)
    return subtree.has(checklist.created_by) || getSubtreeIds(checklist.created_by).includes(user.id);
  }
  return subtree.has(checklist.created_by) || subtree.has(checklist.assignee_id);
}

function checklistItemsEditable(
  user: UserPublic,
  checklist: ChecklistWithDetails
): boolean {
  if (checklist.status !== "open") return false;
  if (checklist.expires_at) {
    const due = Date.parse(checklist.expires_at);
    if (Number.isFinite(due) && due <= Date.now()) return false;
  }
  return true;
}

/** Может ли пользователь менять пункты обычного (не общего) чеклиста. */
export function canToggleChecklistItem(user: UserPublic, checklist: ChecklistWithDetails): boolean {
  if (!checklistItemsEditable(user, checklist)) return false;
  if (checklist.is_shared) return false;
  if (checklist.is_private) return checklist.assignee_id === user.id;
  return (
    checklist.assignee_id === user.id ||
    hasPermission(user, "tasks.manage_any") ||
    isRoot(user)
  );
}

export function canManageSharedChecklistItem(
  user: UserPublic,
  checklist: ChecklistWithDetails
): boolean {
  return (
    checklist.created_by === user.id ||
    hasPermission(user, "tasks.manage_any") ||
    isRoot(user)
  );
}

export function canClaimChecklistItem(
  user: UserPublic,
  checklist: ChecklistWithDetails,
  item: ChecklistWithDetails["items"][number]
): boolean {
  if (!checklist.is_shared) return false;
  if (!checklistItemsEditable(user, checklist)) return false;
  if (!canViewChecklist(user, checklist)) return false;
  if (item.completed_at || item.claimed_by) return false;
  return true;
}

export function canCompleteSharedChecklistItem(
  user: UserPublic,
  checklist: ChecklistWithDetails,
  item: ChecklistWithDetails["items"][number]
): boolean {
  if (!checklist.is_shared) return false;
  if (!checklistItemsEditable(user, checklist)) return false;
  if (item.completed_at || !item.claimed_by) return false;
  if (item.claimed_by === user.id) return true;
  return canManageSharedChecklistItem(user, checklist);
}

/** Снять плей: отказаться от пункта, взятого в работу (ещё не выполненного). */
export function canUnclaimChecklistItem(
  user: UserPublic,
  checklist: ChecklistWithDetails,
  item: ChecklistWithDetails["items"][number]
): boolean {
  if (!checklist.is_shared) return false;
  if (!checklistItemsEditable(user, checklist)) return false;
  if (item.completed_at || !item.claimed_by) return false;
  if (item.claimed_by === user.id) return true;
  return canManageSharedChecklistItem(user, checklist);
}

export function canUncompleteSharedChecklistItem(
  user: UserPublic,
  checklist: ChecklistWithDetails,
  item: ChecklistWithDetails["items"][number]
): boolean {
  if (!checklist.is_shared) return false;
  if (!checklistItemsEditable(user, checklist)) return false;
  if (!item.completed_at) return false;
  if (item.claimed_by === user.id) return true;
  return canManageSharedChecklistItem(user, checklist);
}

export function canCreateSharedChecklist(user: UserPublic): boolean {
  return hasPermission(user, "tasks.create") && hasSubordinates(user);
}

export function canDeleteChecklist(user: UserPublic, checklist: ChecklistWithDetails): boolean {
  if (checklist.is_private) {
    return checklist.created_by === user.id && hasPermission(user, "tasks.delete_own");
  }
  if (hasPermission(user, "tasks.manage_any") || isRoot(user)) return true;
  return checklist.created_by === user.id && hasPermission(user, "tasks.delete_own");
}

export function canEditChecklist(user: UserPublic, checklist: ChecklistWithDetails): boolean {
  if (checklist.is_private) {
    return checklist.created_by === user.id && hasPermission(user, "tasks.edit_own");
  }
  if (hasPermission(user, "tasks.manage_any") || isRoot(user)) return true;
  return checklist.created_by === user.id && hasPermission(user, "tasks.edit_own");
}

/** Вернуть проваленный/просроченный чеклист в работу: исполнитель или редактор. */
export function canRestoreChecklist(
  user: UserPublic,
  checklist: ChecklistWithDetails
): boolean {
  const failedCompleted =
    checklist.status === "completed" &&
    (Boolean(checklist.auto_completed) ||
      checklist.items.some((i) => !i.completed_at));
  const openOverdue =
    checklist.status === "open" &&
    Boolean(checklist.expires_at) &&
    Number.isFinite(Date.parse(checklist.expires_at!)) &&
    Date.parse(checklist.expires_at!) <= Date.now();
  if (!failedCompleted && !openOverdue) return false;
  if (checklist.assignee_id === user.id) return true;
  return canEditChecklist(user, checklist);
}

export function canCreateChecklist(user: UserPublic, assigneeId: number): boolean {
  if (!hasPermission(user, "tasks.create")) return false;
  return canAssignToUsers(user, [assigneeId]);
}

export function filterVisibleChecklists(
  user: UserPublic,
  checklists: ChecklistWithDetails[]
): ChecklistWithDetails[] {
  return checklists.filter((c) => canViewChecklist(user, c));
}

export { getTaskAssigneeIds };
