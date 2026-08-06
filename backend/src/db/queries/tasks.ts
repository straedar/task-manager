import { getDb, runTransaction } from "../index.js";
import type { TaskPriority, TaskStatus, TaskWithAssignees, UserPublic } from "../../types.js";

function mapUser(row: { id: number; nickname: string; parent_id: number | null }): UserPublic {
  return { id: row.id, nickname: row.nickname, parent_id: row.parent_id, role_id: null };
}

function enrichTask(task: {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_by: number;
  created_at: string;
  completed_at: string | null;
  completed_by: number | null;
  is_shared: number | boolean;
  is_private?: number | boolean;
  due_at?: string | null;
  planned_for?: string | null;
  auto_completed?: number | boolean;
}): TaskWithAssignees {
  const db = getDb();
  const userSql = "SELECT id, nickname, parent_id FROM users WHERE id = ?";

  const assignees = (
    db
      .prepare(
        `SELECT u.id, u.nickname, u.parent_id, ta.completed_at
       FROM users u
       JOIN task_assignees ta ON ta.user_id = u.id
       WHERE ta.task_id = ? ORDER BY u.nickname`
      )
      .all(task.id) as unknown as { id: number; nickname: string; parent_id: number | null; completed_at: string | null }[]
  ).map((row) => ({
    ...mapUser(row),
    completed_at: row.completed_at,
  }));

  const creator = mapUser(
    db.prepare(userSql).get(task.created_by) as unknown as UserPublic
  );

  let completed_by_user: UserPublic | null = null;
  if (task.completed_by) {
    completed_by_user = mapUser(
      db.prepare(userSql).get(task.completed_by) as unknown as UserPublic
    );
  }

  return {
    ...task,
    due_at: task.due_at ?? null,
    planned_for: task.planned_for ?? null,
    auto_completed: Boolean(task.auto_completed),
    priority: task.priority as TaskPriority,
    status: task.status as TaskStatus,
    is_shared: Boolean(task.is_shared),
    is_private: Boolean(task.is_private),
    assignees,
    creator,
    completed_by_user,
  };
}

export function getAllTasks(): TaskWithAssignees[] {
  const tasks = getDb()
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
    .all() as Parameters<typeof enrichTask>[0][];
  return tasks.map(enrichTask);
}

export function getTaskById(id: number): TaskWithAssignees | undefined {
  const task = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as Parameters<typeof enrichTask>[0] | undefined;
  return task ? enrichTask(task) : undefined;
}

export function createTask(data: {
  title: string;
  description: string;
  priority: TaskPriority;
  created_by: number;
  assigneeIds: number[];
  is_shared: boolean;
  is_private?: boolean;
  due_at?: string | null;
  planned_for?: string | null;
}): TaskWithAssignees {
  const db = getDb();
  const planned_for = data.planned_for ?? null;
  const due_at =
    data.due_at ?? (planned_for ? new Date(`${planned_for}T12:00:00+03:00`).toISOString() : null);
  const is_private = data.is_private ? 1 : 0;

  const taskId = runTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO tasks (title, description, priority, status, created_by, is_shared, is_private, due_at, planned_for)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .run(
        data.title,
        data.description,
        data.priority,
        data.created_by,
        data.is_shared ? 1 : 0,
        is_private,
        due_at,
        planned_for
      );

    const id = Number(result.lastInsertRowid);
    const insertAssignee = db.prepare(
      "INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)"
    );
    for (const userId of data.assigneeIds) {
      insertAssignee.run(id, userId);
    }
    return id;
  });
  return getTaskById(taskId)!;
}

export function completeTask(taskId: number, userId: number): TaskWithAssignees | null {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task || (task.status !== "pending" && task.status !== "in_progress")) return null;

  if (task.is_shared) {
    db.prepare(
      `UPDATE tasks SET status = 'completed', completed_at = datetime('now'), completed_by = ?, auto_completed = 0
       WHERE id = ? AND status IN ('pending', 'in_progress')`
    ).run(userId, taskId);
    db.prepare(
      `UPDATE task_assignees SET completed_at = datetime('now')
       WHERE task_id = ? AND completed_at IS NULL`
    ).run(taskId);
  } else {
    db.prepare(
      `UPDATE task_assignees SET completed_at = datetime('now')
       WHERE task_id = ? AND user_id = ? AND completed_at IS NULL`
    ).run(taskId, userId);

    const pending = db
      .prepare(
        `SELECT COUNT(*) as count FROM task_assignees
         WHERE task_id = ? AND completed_at IS NULL`
      )
      .get(taskId) as { count: number };

    if (pending.count === 0) {
      db.prepare(
        `UPDATE tasks SET status = 'completed', completed_at = datetime('now'), completed_by = ?, auto_completed = 0
         WHERE id = ?`
      ).run(userId, taskId);
    }
  }

  return getTaskById(taskId) ?? null;
}

export function startTask(taskId: number): TaskWithAssignees | null {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task || task.status !== "pending") return null;

  db.prepare(
    `UPDATE tasks SET status = 'in_progress' WHERE id = ? AND status = 'pending'`
  ).run(taskId);

  return getTaskById(taskId) ?? null;
}

export function updateTask(
  taskId: number,
  data: {
    title: string;
    description: string;
    priority: TaskPriority;
    assigneeIds: number[];
    is_shared: boolean;
    is_private?: boolean;
    due_at?: string | null;
    planned_for?: string | null;
  }
): TaskWithAssignees | null {
  const db = getDb();
  const existing = getTaskById(taskId);
  if (!existing) return null;

  const previousCompletion = new Map(
    existing.assignees.map((a) => [a.id, a.completed_at] as const)
  );
  const planned_for =
    data.planned_for !== undefined ? data.planned_for : existing.planned_for;
  const dueAt =
    data.due_at !== undefined
      ? data.due_at
      : planned_for
        ? new Date(`${planned_for}T12:00:00+03:00`).toISOString()
        : existing.due_at;
  const is_private = data.is_private ? 1 : 0;

  runTransaction(() => {
    db.prepare(
      `UPDATE tasks
       SET title = ?, description = ?, priority = ?, is_shared = ?, is_private = ?, due_at = ?, planned_for = ?
       WHERE id = ?`
    ).run(
      data.title,
      data.description,
      data.priority,
      data.is_shared ? 1 : 0,
      is_private,
      dueAt,
      planned_for,
      taskId
    );

    db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(taskId);
    const insertAssignee = db.prepare(
      "INSERT INTO task_assignees (task_id, user_id, completed_at) VALUES (?, ?, ?)"
    );
    for (const userId of data.assigneeIds) {
      insertAssignee.run(taskId, userId, previousCompletion.get(userId) ?? null);
    }

    // Для не-общих задач: если все исполнители уже завершили — закрыть задачу
    if (!data.is_shared && existing.status !== "completed") {
      const pending = db
        .prepare(
          `SELECT COUNT(*) as count FROM task_assignees
           WHERE task_id = ? AND completed_at IS NULL`
        )
        .get(taskId) as { count: number };

      if (pending.count === 0 && data.assigneeIds.length > 0) {
        db.prepare(
          `UPDATE tasks SET status = 'completed', completed_at = datetime('now'), completed_by = ?, auto_completed = 0
           WHERE id = ?`
        ).run(data.assigneeIds[0], taskId);
      }
    }

    // Если задача была завершена, а после правки появились незавершённые исполнители — снова открыть
    if (!data.is_shared && existing.status === "completed") {
      const pending = db
        .prepare(
          `SELECT COUNT(*) as count FROM task_assignees
           WHERE task_id = ? AND completed_at IS NULL`
        )
        .get(taskId) as { count: number };

      if (pending.count > 0) {
        db.prepare(
          `UPDATE tasks SET status = 'in_progress', completed_at = NULL, completed_by = NULL, auto_completed = 0
           WHERE id = ?`
        ).run(taskId);
      }
    }

    // Общая задача: если уже completed и остаётся хотя бы один исполнитель — оставить completed
    if (data.is_shared && existing.status === "completed") {
      db.prepare(
        `UPDATE task_assignees SET completed_at = COALESCE(completed_at, datetime('now'))
         WHERE task_id = ?`
      ).run(taskId);
    }
  });

  return getTaskById(taskId) ?? null;
}

export function deleteTask(taskId: number): boolean {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task) return false;

  runTransaction(() => {
    db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  });

  return true;
}

/** Previously auto-closed past-due tasks; deadlines now leave tasks open as overdue. */
export function expireDueTasks(_now = new Date()): number[] {
  return [];
}

export function getTaskAssigneeIds(taskId: number): number[] {
  const rows = getDb()
    .prepare("SELECT user_id FROM task_assignees WHERE task_id = ?")
    .all(taskId) as { user_id: number }[];
  return rows.map((r) => r.user_id);
}
