import { getDb } from "../index.js";
import type {
  ChecklistItem,
  ChecklistStatus,
  ChecklistWithDetails,
  UserPublic,
} from "../../types.js";
import { moscowDeadlineIso, moscowDeadlineIsoFromKey, moscowDateKey } from "../../utils/moscowTime.js";

function mapUser(row: { id: number; nickname: string; parent_id: number | null }): UserPublic {
  return { id: row.id, nickname: row.nickname, parent_id: row.parent_id, role_id: null };
}

function getUser(id: number): UserPublic {
  return mapUser(
    getDb()
      .prepare("SELECT id, nickname, parent_id FROM users WHERE id = ?")
      .get(id) as unknown as UserPublic
  );
}

function getItems(checklistId: number): ChecklistItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, checklist_id, title, position, completed_at, claimed_by, claimed_at
       FROM checklist_items
       WHERE checklist_id = ?
       ORDER BY position ASC, id ASC`
    )
    .all(checklistId) as {
    id: number;
    checklist_id: number;
    title: string;
    position: number;
    completed_at: string | null;
    claimed_by: number | null;
    claimed_at: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    checklist_id: row.checklist_id,
    title: row.title,
    position: row.position,
    completed_at: row.completed_at,
    claimed_by: row.claimed_by ?? null,
    claimed_at: row.claimed_at ?? null,
    claimant: row.claimed_by ? getUser(row.claimed_by) : null,
  }));
}

type ChecklistRow = {
  id: number;
  title: string;
  created_by: number;
  assignee_id: number;
  status: string;
  created_at: string;
  expires_at: string | null;
  planned_for: string | null;
  completed_at: string | null;
  auto_completed: number;
  is_private?: number;
  is_shared?: number;
};

function enrich(row: ChecklistRow): ChecklistWithDetails {
  return {
    id: row.id,
    title: row.title,
    created_by: row.created_by,
    assignee_id: row.assignee_id,
    status: row.status as ChecklistStatus,
    created_at: row.created_at,
    expires_at: row.expires_at,
    planned_for: row.planned_for ?? null,
    completed_at: row.completed_at,
    auto_completed: Boolean(row.auto_completed),
    is_private: Boolean(row.is_private),
    is_shared: Boolean(row.is_shared),
    items: getItems(row.id),
    creator: getUser(row.created_by),
    assignee: getUser(row.assignee_id),
  };
}

export function getAllChecklists(): ChecklistWithDetails[] {
  const rows = getDb()
    .prepare("SELECT * FROM checklists ORDER BY created_at DESC")
    .all() as ChecklistRow[];
  return rows.map(enrich);
}

export function getChecklistById(id: number): ChecklistWithDetails | null {
  const row = getDb()
    .prepare("SELECT * FROM checklists WHERE id = ?")
    .get(id) as ChecklistRow | undefined;
  return row ? enrich(row) : null;
}

export function createChecklist(data: {
  title: string;
  created_by: number;
  assignee_id: number;
  items: string[];
  has_deadline: boolean;
  planned_for?: string | null;
  expires_at?: string | null;
  is_private?: boolean;
  is_shared?: boolean;
}): ChecklistWithDetails {
  const db = getDb();
  const planned_for =
    data.planned_for !== undefined
      ? data.planned_for
      : data.has_deadline
        ? moscowDateKey()
        : null;
  const expires_at = !data.has_deadline
    ? null
    : data.expires_at
      ? data.expires_at
      : planned_for
        ? moscowDeadlineIsoFromKey(planned_for)
        : moscowDeadlineIso();
  const result = db
    .prepare(
      `INSERT INTO checklists (title, created_by, assignee_id, status, expires_at, planned_for, is_private, is_shared)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(
      data.title,
      data.created_by,
      data.assignee_id,
      expires_at,
      planned_for,
      data.is_private ? 1 : 0,
      data.is_shared ? 1 : 0
    );

  const checklistId = Number(result.lastInsertRowid);
  const insertItem = db.prepare(
    `INSERT INTO checklist_items (checklist_id, title, position) VALUES (?, ?, ?)`
  );

  data.items.forEach((title, index) => {
    insertItem.run(checklistId, title, index);
  });

  return getChecklistById(checklistId)!;
}

function parseCreatedAt(createdAt: string): Date {
  if (createdAt.includes("T")) return new Date(createdAt);
  return new Date(`${createdAt.replace(" ", "T")}Z`);
}

export function updateChecklist(
  checklistId: number,
  data: {
    title: string;
    assignee_id: number;
    has_deadline: boolean;
    items: { id?: number | null; title: string }[];
    planned_for?: string | null;
    expires_at?: string | null;
    is_private?: boolean;
    is_shared?: boolean;
  }
): ChecklistWithDetails | null {
  const existing = getChecklistById(checklistId);
  if (!existing) return null;

  const db = getDb();
  const planned_for =
    data.planned_for !== undefined ? data.planned_for : existing.planned_for;

  let expires_at: string | null = existing.expires_at;
  if (!data.has_deadline) {
    expires_at = null;
  } else if (data.expires_at !== undefined) {
    // Explicit value from client (including null → fall back below)
    expires_at =
      data.expires_at ??
      (planned_for
        ? moscowDeadlineIsoFromKey(planned_for)
        : existing.expires_at ??
          moscowDeadlineIso(parseCreatedAt(existing.created_at)));
  }
  // If has_deadline and expires_at omitted — keep existing (or derive once if missing)
  else if (!expires_at) {
    expires_at = planned_for
      ? moscowDeadlineIsoFromKey(planned_for)
      : moscowDeadlineIso(parseCreatedAt(existing.created_at));
  }

  const is_private = data.is_private ? 1 : 0;
  const is_shared =
    data.is_shared !== undefined ? (data.is_shared ? 1 : 0) : existing.is_shared ? 1 : 0;

  db.prepare(
    `UPDATE checklists
     SET title = ?, assignee_id = ?, expires_at = ?, planned_for = ?, is_private = ?, is_shared = ?
     WHERE id = ?`
  ).run(data.title, data.assignee_id, expires_at, planned_for, is_private, is_shared, checklistId);

  const incomingIds = new Set(
    data.items.map((item) => item.id).filter((id): id is number => typeof id === "number")
  );

  for (const old of existing.items) {
    if (!incomingIds.has(old.id)) {
      db.prepare("DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?").run(
        old.id,
        checklistId
      );
    }
  }

  const updateItem = db.prepare(
    `UPDATE checklist_items SET title = ?, position = ? WHERE id = ? AND checklist_id = ?`
  );
  const insertItem = db.prepare(
    `INSERT INTO checklist_items (checklist_id, title, position) VALUES (?, ?, ?)`
  );

  data.items.forEach((item, index) => {
    if (item.id && existing.items.some((old) => old.id === item.id)) {
      updateItem.run(item.title, index, item.id, checklistId);
    } else {
      insertItem.run(checklistId, item.title, index);
    }
  });

  const updated = getChecklistById(checklistId)!;
  const allDone =
    updated.items.length > 0 && updated.items.every((item) => item.completed_at);
  const anyOpen = updated.items.some((item) => !item.completed_at);

  if (allDone && updated.status === "open") {
    // Past-due checklists must not success-close via edit.
    if (!isChecklistPastDue(updated)) {
      return completeChecklist(checklistId, false);
    }
  }

  if (anyOpen && updated.status === "completed") {
    db.prepare(
      `UPDATE checklists
       SET status = 'open', completed_at = NULL, auto_completed = 0
       WHERE id = ?`
    ).run(checklistId);
    return getChecklistById(checklistId);
  }

  return updated;
}

/** Past deadline — items must not be toggled / success-closed. */
export function isChecklistPastDue(
  checklist: { status: string; expires_at: string | null },
  now = new Date()
): boolean {
  if (checklist.status !== "open" || !checklist.expires_at) return false;
  const due = Date.parse(checklist.expires_at);
  return Number.isFinite(due) && due <= now.getTime();
}

export function setChecklistItemCompleted(
  checklistId: number,
  itemId: number,
  completed: boolean
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || checklist.status !== "open") return null;
  if (isChecklistPastDue(checklist)) return null;

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item) return null;

  getDb()
    .prepare(
      `UPDATE checklist_items
       SET completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
       WHERE id = ? AND checklist_id = ?`
    )
    .run(completed ? 1 : 0, itemId, checklistId);

  return finalizeChecklistIfDone(checklistId);
}

/** Взять свободный пункт общего чеклиста в работу. */
export function claimChecklistItem(
  checklistId: number,
  itemId: number,
  userId: number
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || !checklist.is_shared || checklist.status !== "open") return null;
  if (isChecklistPastDue(checklist)) return null;

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item || item.completed_at || item.claimed_by) return null;

  const result = getDb()
    .prepare(
      `UPDATE checklist_items
       SET claimed_by = ?, claimed_at = datetime('now')
       WHERE id = ? AND checklist_id = ? AND claimed_by IS NULL AND completed_at IS NULL`
    )
    .run(userId, itemId, checklistId);

  if (result.changes === 0) return null;
  return getChecklistById(checklistId);
}

/** Снять плей — вернуть пункт в свободные (ещё не выполнен). */
export function unclaimChecklistItem(
  checklistId: number,
  itemId: number
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || !checklist.is_shared || checklist.status !== "open") return null;
  if (isChecklistPastDue(checklist)) return null;

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item || item.completed_at || !item.claimed_by) return null;

  const result = getDb()
    .prepare(
      `UPDATE checklist_items
       SET claimed_by = NULL, claimed_at = NULL
       WHERE id = ? AND checklist_id = ? AND completed_at IS NULL AND claimed_by IS NOT NULL`
    )
    .run(itemId, checklistId);

  if (result.changes === 0) return null;
  return getChecklistById(checklistId);
}

/** Завершить пункт (обычный или взятый в работу). */
export function completeChecklistItem(
  checklistId: number,
  itemId: number
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || checklist.status !== "open") return null;
  if (isChecklistPastDue(checklist)) return null;

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item || item.completed_at) return null;
  if (checklist.is_shared && !item.claimed_by) return null;

  getDb()
    .prepare(
      `UPDATE checklist_items
       SET completed_at = datetime('now')
       WHERE id = ? AND checklist_id = ? AND completed_at IS NULL`
    )
    .run(itemId, checklistId);

  return finalizeChecklistIfDone(checklistId);
}

/** Снять выполнение о выполнении (пункт остаётся взятым, если был). */
export function uncompleteChecklistItem(
  checklistId: number,
  itemId: number
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || checklist.status !== "open") return null;
  if (isChecklistPastDue(checklist)) return null;

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item || !item.completed_at) return null;

  getDb()
    .prepare(
      `UPDATE checklist_items
       SET completed_at = NULL
       WHERE id = ? AND checklist_id = ?`
    )
    .run(itemId, checklistId);

  return getChecklistById(checklistId);
}

function finalizeChecklistIfDone(checklistId: number): ChecklistWithDetails | null {
  const updated = getChecklistById(checklistId);
  if (!updated) return null;
  if (updated.items.length > 0 && updated.items.every((i) => i.completed_at)) {
    return completeChecklist(checklistId, false);
  }
  return updated;
}

export function completeChecklist(
  checklistId: number,
  autoCompleted: boolean
): ChecklistWithDetails | null {
  const checklist = getChecklistById(checklistId);
  if (!checklist || checklist.status !== "open") return null;
  // Success close is forbidden after the deadline; auto-fail close remains allowed.
  if (!autoCompleted && isChecklistPastDue(checklist)) return null;

  getDb()
    .prepare(
      `UPDATE checklists
       SET status = 'completed',
           completed_at = datetime('now'),
           auto_completed = ?
       WHERE id = ? AND status = 'open'`
    )
    .run(autoCompleted ? 1 : 0, checklistId);

  return getChecklistById(checklistId);
}

/** Previously auto-closed past-due checklists; deadlines now leave them open as overdue. */
export function expireDueChecklists(_now = new Date()): number {
  return 0;
}

/** Вернуть проваленный/просроченный чеклист в активные. */
export function restoreChecklist(checklistId: number): ChecklistWithDetails | null {
  const db = getDb();
  const checklist = getChecklistById(checklistId);
  if (!checklist) return null;

  const incompleteClose =
    checklist.status === "completed" &&
    (checklist.auto_completed || checklist.items.some((i) => !i.completed_at));
  const openOverdue = isChecklistPastDue(checklist);

  if (!incompleteClose && !openOverdue) return null;

  if (incompleteClose) {
    db.prepare(
      `UPDATE checklists
       SET status = 'open', completed_at = NULL, auto_completed = 0
       WHERE id = ?`
    ).run(checklistId);
  }

  const next = getChecklistById(checklistId);
  if (!next) return null;

  // Если срок уже прошёл — снимаем дедлайн, иначе снова «заморожен».
  if (isChecklistPastDue(next) || (next.expires_at && Date.parse(next.expires_at) <= Date.now())) {
    db.prepare(`UPDATE checklists SET expires_at = NULL WHERE id = ?`).run(checklistId);
  }

  return getChecklistById(checklistId);
}

export function deleteChecklist(id: number): boolean {
  const result = getDb().prepare("DELETE FROM checklists WHERE id = ?").run(id);
  return result.changes > 0;
}
