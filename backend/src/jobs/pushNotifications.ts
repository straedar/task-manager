import { getDb } from "../db/index.js";
import { claimPushSend, prunePushSendLog } from "../db/queries/push.js";
import { notifyUser, type TaskPriority } from "../services/notify.js";
import { moscowDateKey } from "../utils/moscowTime.js";

const INTERVAL_MS = 60_000;
const REMIND_BEFORE_MS = 60 * 60 * 1000; // окно: дедлайн в ближайший час

function moscowHour(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")!.value);
}

function formatMoscowTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`));
}

function parseDeadline(iso: string): Date {
  return new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
}

function pluralMinutes(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "минута";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "минуты";
  return "минут";
}

/** Текст остатка до дедлайна: «остался час» или «осталось N минут». */
function formatRemainingLabel(deadlineIso: string, now: Date): string {
  const ms = parseDeadline(deadlineIso).getTime() - now.getTime();
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes >= 60) return "остался час";
  return `осталось ${minutes} ${pluralMinutes(minutes)}`;
}

function taskPriority(id: number): TaskPriority | null {
  const row = getDb()
    .prepare(`SELECT priority FROM tasks WHERE id = ?`)
    .get(id) as { priority: string } | undefined;
  if (!row) return null;
  if (row.priority === "low" || row.priority === "medium" || row.priority === "high") {
    return row.priority;
  }
  return null;
}

async function remindChecklistDeadlines(now: Date) {
  const until = new Date(now.getTime() + REMIND_BEFORE_MS).toISOString();
  const nowIso = now.toISOString();

  const rows = getDb()
    .prepare(
      `SELECT id, title, assignee_id, expires_at
       FROM checklists
       WHERE status = 'open'
         AND expires_at IS NOT NULL
         AND expires_at > ?
         AND expires_at <= ?`
    )
    .all(nowIso, until) as {
    id: number;
    title: string;
    assignee_id: number;
    expires_at: string;
  }[];

  for (const row of rows) {
    const key = `checklist-remind:${row.id}:${row.expires_at}`;
    if (!claimPushSend(key)) continue;

    const time = formatMoscowTime(row.expires_at);
    const remaining = formatRemainingLabel(row.expires_at, now);
    await notifyUser(row.assignee_id, "checklist_remind", {
      title: "Скоро истекает срок чеклиста",
      body: `«${row.title}» — до ${time} МСК ${remaining}`,
      url: "/tasks",
      tag: `checklist-remind-${row.id}`,
    });
  }
}

async function notifyOverdueChecklists(now: Date) {
  const nowIso = now.toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id, title, assignee_id, expires_at FROM checklists
       WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at <= ?`
    )
    .all(nowIso) as {
    id: number;
    title: string;
    assignee_id: number;
    expires_at: string | null;
  }[];

  for (const row of rows) {
    const key = `checklist-overdue:${row.id}`;
    if (!claimPushSend(key)) continue;

    const time = row.expires_at ? formatMoscowTime(row.expires_at) : null;
    await notifyUser(row.assignee_id, "checklist_overdue", {
      title: "Чеклист просрочен",
      body: time
        ? `«${row.title}» не выполнен — срок истёк в ${time}`
        : `«${row.title}» не выполнен — срок истёк`,
      url: "/tasks",
      tag: `checklist-overdue-${row.id}`,
    });
  }
}

async function remindTaskDeadlines(now: Date) {
  const until = new Date(now.getTime() + REMIND_BEFORE_MS).toISOString();
  const nowIso = now.toISOString();

  const rows = getDb()
    .prepare(
      `SELECT id, title, due_at, priority FROM tasks
       WHERE status != 'completed'
         AND due_at IS NOT NULL
         AND due_at > ?
         AND due_at <= ?`
    )
    .all(nowIso, until) as {
    id: number;
    title: string;
    due_at: string;
    priority: string;
  }[];

  for (const row of rows) {
    const assignees = getDb()
      .prepare(`SELECT user_id FROM task_assignees WHERE task_id = ?`)
      .all(row.id) as { user_id: number }[];
    if (assignees.length === 0) continue;

    const key = `task-remind:${row.id}:${row.due_at}`;
    if (!claimPushSend(key)) continue;

    const time = formatMoscowTime(row.due_at);
    const remaining = formatRemainingLabel(row.due_at, now);
    const priority = taskPriority(row.id);
    for (const a of assignees) {
      await notifyUser(
        a.user_id,
        "task_remind_1h",
        {
          title: "Скоро истекает срок задачи",
          body: `«${row.title}» — до ${time} МСК ${remaining}`,
          url: "/tasks",
          tag: `task-remind-${row.id}`,
        },
        { priority }
      );
    }
  }
}

async function notifyOverdueTasks(now: Date) {
  const nowIso = now.toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id, title, due_at, priority FROM tasks
       WHERE status != 'completed' AND due_at IS NOT NULL AND due_at <= ?`
    )
    .all(nowIso) as {
    id: number;
    title: string;
    due_at: string | null;
    priority: string;
  }[];

  for (const row of rows) {
    const assignees = getDb()
      .prepare(`SELECT user_id FROM task_assignees WHERE task_id = ?`)
      .all(row.id) as { user_id: number }[];
    if (assignees.length === 0) continue;

    const key = `task-overdue:${row.id}`;
    if (!claimPushSend(key)) continue;

    const time = row.due_at ? formatMoscowTime(row.due_at) : null;
    const priority = taskPriority(row.id);
    for (const a of assignees) {
      await notifyUser(
        a.user_id,
        "task_overdue",
        {
          title: "Задача просрочена",
          body: time
            ? `«${row.title}» не выполнена — срок истёк в ${time}`
            : `«${row.title}» не выполнена — срок истёк`,
          url: "/tasks",
          tag: `task-overdue-${row.id}`,
        },
        { priority }
      );
    }
  }
}

async function remindTasksForToday(now: Date) {
  const hour = moscowHour(now);
  if (hour !== 9) return;

  const today = moscowDateKey(now);
  const tasks = getDb()
    .prepare(
      `SELECT id, title, priority FROM tasks
       WHERE status != 'completed'
         AND planned_for = ?`
    )
    .all(today) as { id: number; title: string; priority: string }[];

  for (const task of tasks) {
    const assignees = getDb()
      .prepare(`SELECT user_id FROM task_assignees WHERE task_id = ?`)
      .all(task.id) as { user_id: number }[];
    if (assignees.length === 0) continue;

    const key = `task-today:${task.id}:${today}`;
    if (!claimPushSend(key)) continue;

    const priority = taskPriority(task.id);
    for (const a of assignees) {
      await notifyUser(
        a.user_id,
        "task_remind_morning",
        {
          title: "Задача на сегодня",
          body: `«${task.title}»`,
          url: "/tasks",
          tag: `task-today-${task.id}`,
        },
        { priority }
      );
    }
  }
}

async function remindUnfinishedTasks(now: Date) {
  const hour = moscowHour(now);
  if (hour !== 18) return;

  const today = moscowDateKey(now);
  const nowIso = now.toISOString();

  const tasks = getDb()
    .prepare(
      `SELECT id, title, priority FROM tasks
       WHERE status != 'completed'
         AND (
           planned_for = ?
           OR planned_for < ?
           OR (due_at IS NOT NULL AND due_at < ?)
         )`
    )
    .all(today, today, nowIso) as { id: number; title: string; priority: string }[];

  for (const task of tasks) {
    const assignees = getDb()
      .prepare(`SELECT user_id FROM task_assignees WHERE task_id = ?`)
      .all(task.id) as { user_id: number }[];
    if (assignees.length === 0) continue;

    const key = `task-unfinished:${task.id}:${today}`;
    if (!claimPushSend(key)) continue;

    const priority = taskPriority(task.id);
    for (const a of assignees) {
      await notifyUser(
        a.user_id,
        "task_unfinished",
        {
          title: "Незавершённая задача",
          body: `«${task.title}» всё ещё не выполнена`,
          url: "/tasks",
          tag: `task-unfinished-${task.id}`,
        },
        { priority }
      );
    }
  }
}

export function startPushJobs() {
  const tick = async () => {
    try {
      prunePushSendLog(14);

      await notifyOverdueChecklists(new Date());
      await notifyOverdueTasks(new Date());

      const now = new Date();
      await remindChecklistDeadlines(now);
      await remindTaskDeadlines(now);
      await remindTasksForToday(now);
      await remindUnfinishedTasks(now);
    } catch (err) {
      console.error("[push] job failed", err);
    }
  };

  void tick();
  return setInterval(() => void tick(), INTERVAL_MS);
}
