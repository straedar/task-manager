import { getDb } from "../index.js";
import type { TaskStatus } from "../../types.js";
import { getUserAuthById, getUserById } from "./users.js";

export type ProfileKpi = {
  completed: number;
  expired: number;
  active: number;
  expecting: number;
};

export type ProfileDto = {
  id: number;
  nickname: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role_id: number | null;
  role_name: string | null;
  parent_id: number | null;
  kpi: ProfileKpi;
};

/**
 * KPI aligned with task-manager tabs / card badges:
 * - expired = closed as failed by deadline («Просрочена» / «Просрочен» in Завершённые)
 * - completed = successfully finished for this user
 * - active / expecting = still open for this user (including currently overdue open items)
 */
export function getTaskKpiForUser(userId: number): ProfileKpi {
  const db = getDb();
  const kpi: ProfileKpi = { completed: 0, expired: 0, active: 0, expecting: 0 };

  const tasks = db
    .prepare(
      `SELECT t.status AS status, t.auto_completed AS auto_completed,
              t.is_shared AS is_shared, ta.completed_at AS my_completed_at
       FROM tasks t
       INNER JOIN task_assignees ta ON ta.task_id = t.id
       WHERE ta.user_id = ?`
    )
    .all(userId) as {
    status: TaskStatus;
    auto_completed: number;
    is_shared: number;
    my_completed_at: string | null;
  }[];

  for (const row of tasks) {
    const autoFailed = row.status === "completed" && Boolean(row.auto_completed);
    if (autoFailed) {
      kpi.expired += 1;
      continue;
    }

    const shared = Boolean(row.is_shared);
    const personallyDone = row.my_completed_at != null;
    const taskClosedOk = row.status === "completed";
    // Same idea as isTaskCompletedForUser: shared waits for task close; solo can finish per-assignee.
    const doneForUser = shared ? taskClosedOk : taskClosedOk || personallyDone;

    if (doneForUser) {
      kpi.completed += 1;
      continue;
    }

    if (row.status === "in_progress") kpi.active += 1;
    else kpi.expecting += 1;
  }

  const checklists = db
    .prepare(
      `SELECT c.status AS status, c.auto_completed AS auto_completed,
              EXISTS (
                SELECT 1 FROM checklist_items i
                WHERE i.checklist_id = c.id AND i.completed_at IS NULL
              ) AS has_open_items,
              EXISTS (
                SELECT 1 FROM checklist_items i
                WHERE i.checklist_id = c.id AND i.completed_at IS NOT NULL
              ) AS has_done_items
       FROM checklists c
       WHERE c.assignee_id = ?`
    )
    .all(userId) as {
    status: string;
    auto_completed: number;
    has_open_items: number;
    has_done_items: number;
  }[];

  for (const row of checklists) {
    if (row.status === "completed") {
      // Auto-closed or closed with unfinished items → «Просрочен» / «Не выполнен»
      if (row.auto_completed || row.has_open_items) kpi.expired += 1;
      else kpi.completed += 1;
      continue;
    }
    // Open checklist (even if past due on the card) stays in work metrics, not «Просрочено».
    if (row.has_done_items) kpi.active += 1;
    else kpi.expecting += 1;
  }

  return kpi;
}

export function getProfile(userId: number): ProfileDto | null {
  const auth = getUserAuthById(userId);
  if (!auth) return null;
  const row = getDb()
    .prepare(
      `SELECT first_name, last_name, avatar_url FROM users WHERE id = ?`
    )
    .get(userId) as
    | { first_name: string; last_name: string; avatar_url: string | null }
    | undefined;
  return {
    id: auth.id,
    nickname: auth.nickname,
    first_name: row?.first_name ?? "",
    last_name: row?.last_name ?? "",
    avatar_url: row?.avatar_url ?? null,
    role_id: auth.role_id,
    role_name: auth.role_name ?? null,
    parent_id: auth.parent_id,
    kpi: getTaskKpiForUser(userId),
  };
}

export function updateProfile(
  userId: number,
  data: { first_name: string; last_name: string }
): ProfileDto | null {
  if (!getUserById(userId)) return null;
  getDb()
    .prepare(
      `UPDATE users SET first_name = ?, last_name = ? WHERE id = ?`
    )
    .run(data.first_name.trim(), data.last_name.trim(), userId);
  return getProfile(userId);
}

export function setAvatarUrl(userId: number, avatarUrl: string | null): ProfileDto | null {
  if (!getUserById(userId)) return null;
  getDb().prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(avatarUrl, userId);
  return getProfile(userId);
}

export function getAvatarUrl(userId: number): string | null {
  const row = getDb()
    .prepare(`SELECT avatar_url FROM users WHERE id = ?`)
    .get(userId) as { avatar_url: string | null } | undefined;
  return row?.avatar_url ?? null;
}
