import type { NotifPrefs } from "../db/queries/notifPrefs.js";
import { getNotifPrefs } from "../db/queries/notifPrefs.js";
import { sendPushToUser, type PushPayload } from "./push.js";

export type NotifEvent =
  | "task_assigned"
  | "task_changed"
  | "task_assignee_done"
  | "task_fully_done"
  | "task_remind_1h"
  | "task_remind_morning"
  | "task_overdue"
  | "task_unfinished"
  | "checklist_remind"
  | "checklist_overdue"
  | "news_new"
  | "task_comments";

const EVENT_PREF: Partial<Record<NotifEvent, keyof NotifPrefs>> = {
  task_assigned: "task_assigned",
  task_changed: "task_changed",
  task_assignee_done: "task_assignee_done",
  task_fully_done: "task_fully_done",
  task_remind_1h: "task_remind_1h",
  task_remind_morning: "task_remind_morning",
  task_overdue: "task_overdue",
  task_unfinished: "task_remind_morning",
  checklist_remind: "task_remind_1h",
  checklist_overdue: "task_overdue",
  news_new: "news_any",
  task_comments: "task_comments",
};

const TASK_LIKE = new Set<NotifEvent>([
  "task_assigned",
  "task_changed",
  "task_assignee_done",
  "task_fully_done",
  "task_remind_1h",
  "task_remind_morning",
  "task_overdue",
  "task_unfinished",
  "checklist_remind",
  "checklist_overdue",
  "task_comments",
]);

export type TaskPriority = "low" | "medium" | "high";

function moscowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  return { hour, isWeekend };
}

/** 22:00–07:59 Moscow — silence everything. */
export function isQuietNight(date = new Date()): boolean {
  const { hour } = moscowParts(date);
  return hour >= 22 || hour < 8;
}

export function isMoscowWeekend(date = new Date()): boolean {
  return moscowParts(date).isWeekend;
}

export function allowsNotification(
  userId: number,
  event: NotifEvent,
  opts?: { priority?: TaskPriority | null }
): boolean {
  if (isQuietNight()) return false;

  const prefs = getNotifPrefs(userId);

  if (event === "news_new") {
    return Boolean(prefs.channel_news && prefs.news_any);
  }

  if (TASK_LIKE.has(event)) {
    if (!prefs.channel_tasks) return false;
    if (isMoscowWeekend()) return false;
    if (opts?.priority === "low") return false;
    const key = EVENT_PREF[event];
    if (key && !prefs[key]) return false;
    return true;
  }

  return false;
}

type BufferItem = { title: string; url?: string };
type BufferEntry = {
  items: BufferItem[];
  timer: ReturnType<typeof setTimeout> | null;
  baseTitle: string;
  tag: string;
};

const groupBuffers = new Map<string, BufferEntry>();
const GROUP_FLUSH_MS = 45_000;

/** Soft anti-spam for non-grouped events (1/min per user+event). */
const lastSentAt = new Map<string, number>();
const MIN_GAP_MS = 60_000;

function bufferKey(userId: number, event: NotifEvent): string {
  return `${userId}:${event}`;
}

async function flushGroup(userId: number, event: NotifEvent) {
  const key = bufferKey(userId, event);
  const buf = groupBuffers.get(key);
  if (!buf || buf.items.length === 0) {
    groupBuffers.delete(key);
    return;
  }
  groupBuffers.delete(key);
  if (buf.timer) clearTimeout(buf.timer);

  const n = buf.items.length;
  let payload: PushPayload;
  if (n === 1) {
    payload = {
      title: buf.baseTitle,
      body: `«${buf.items[0].title}»`,
      url: buf.items[0].url ?? "/tasks",
      tag: buf.tag,
    };
  } else {
    const preview = buf.items
      .slice(0, 3)
      .map((i) => `«${i.title}»`)
      .join(", ");
    const more = n > 3 ? ` и ещё ${n - 3}` : "";
    payload = {
      title:
        event === "task_changed" ? `Изменено задач: ${n}` : `Новых задач: ${n}`,
      body: `${preview}${more}`,
      url: "/tasks",
      tag: `${buf.tag}-group`,
    };
  }

  await sendPushToUser(userId, payload);
}

export async function notifyUser(
  userId: number,
  event: NotifEvent,
  payload: PushPayload,
  opts?: { priority?: TaskPriority | null; groupTitle?: string }
): Promise<boolean> {
  if (!allowsNotification(userId, event, { priority: opts?.priority })) {
    return false;
  }

  if (event === "task_assigned" || event === "task_changed") {
    const key = bufferKey(userId, event);
    let buf = groupBuffers.get(key);
    if (!buf) {
      buf = {
        items: [],
        timer: null,
        baseTitle: payload.title,
        tag: payload.tag ?? event,
      };
      groupBuffers.set(key, buf);
    }
    buf.items.push({
      title: opts?.groupTitle ?? payload.body,
      url: payload.url,
    });
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      void flushGroup(userId, event);
    }, GROUP_FLUSH_MS);
    return true;
  }

  // News: always send (quiet night already checked). Others: 1/min soft cap.
  if (event !== "news_new") {
    const gapKey = `${userId}:${event}`;
    const last = lastSentAt.get(gapKey) ?? 0;
    if (Date.now() - last < MIN_GAP_MS) return false;
    lastSentAt.set(gapKey, Date.now());
  }

  await sendPushToUser(userId, payload);
  return true;
}

export async function notifyUsers(
  userIds: number[],
  event: NotifEvent,
  payload: PushPayload,
  opts?: { priority?: TaskPriority | null; groupTitle?: string }
): Promise<void> {
  await Promise.all(
    [...new Set(userIds)].map((id) => notifyUser(id, event, payload, opts))
  );
}
