import { getDb } from "../index.js";

export type NotifPrefs = {
  channel_tasks: boolean;
  channel_news: boolean;
  channel_orders: boolean;
  channel_reference: boolean;
  channel_stockmap: boolean;

  task_assigned: boolean;
  task_changed: boolean;
  task_assignee_done: boolean;
  task_fully_done: boolean;
  task_remind_1h: boolean;
  task_remind_morning: boolean;
  task_overdue: boolean;
  task_comments: boolean;

  news_any: boolean;
};

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  channel_tasks: true,
  channel_news: true,
  channel_orders: false,
  channel_reference: false,
  channel_stockmap: false,

  task_assigned: true,
  task_changed: true,
  task_assignee_done: true,
  task_fully_done: true,
  task_remind_1h: true,
  task_remind_morning: true,
  task_overdue: true,
  task_comments: true,

  news_any: true,
};

function mergePrefs(raw: unknown): NotifPrefs {
  const base = { ...DEFAULT_NOTIF_PREFS };
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof NotifPrefs)[]) {
    if (typeof obj[key] === "boolean") base[key] = obj[key] as boolean;
  }
  return base;
}

export function getNotifPrefs(userId: number): NotifPrefs {
  const row = getDb()
    .prepare(`SELECT prefs_json FROM notification_prefs WHERE user_id = ?`)
    .get(userId) as { prefs_json: string } | undefined;
  if (!row) return { ...DEFAULT_NOTIF_PREFS };
  try {
    return mergePrefs(JSON.parse(row.prefs_json));
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

export function setNotifPrefs(userId: number, prefs: Partial<NotifPrefs>): NotifPrefs {
  const next = mergePrefs({ ...getNotifPrefs(userId), ...prefs });
  getDb()
    .prepare(
      `INSERT INTO notification_prefs (user_id, prefs_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         prefs_json = excluded.prefs_json,
         updated_at = excluded.updated_at`
    )
    .run(userId, JSON.stringify(next));
  return next;
}
