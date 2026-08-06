import { getDb } from "../index.js";

export interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export function upsertPushSubscription(
  userId: number,
  data: { endpoint: string; p256dh: string; auth: string }
): void {
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`
    )
    .run(userId, data.endpoint, data.p256dh, data.auth);
}

export function deletePushSubscription(userId: number, endpoint: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .run(userId, endpoint);
  return result.changes > 0;
}

export function deletePushSubscriptionByEndpoint(endpoint: string): void {
  getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function listSubscriptionsForUser(userId: number): PushSubscriptionRow[] {
  return getDb()
    .prepare(
      `SELECT id, user_id, endpoint, p256dh, auth, created_at
       FROM push_subscriptions WHERE user_id = ?`
    )
    .all(userId) as unknown as PushSubscriptionRow[];
}

export function listSubscriptionsForUsers(userIds: number[]): PushSubscriptionRow[] {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT id, user_id, endpoint, p256dh, auth, created_at
       FROM push_subscriptions WHERE user_id IN (${placeholders})`
    )
    .all(...userIds) as unknown as PushSubscriptionRow[];
}

/** Returns true if this notification key was not sent before (and records it). */
export function claimPushSend(key: string): boolean {
  try {
    getDb()
      .prepare("INSERT INTO push_send_log (key, sent_at) VALUES (?, datetime('now'))")
      .run(key);
    return true;
  } catch {
    return false;
  }
}

export function prunePushSendLog(olderThanDays = 14): void {
  getDb()
    .prepare(
      `DELETE FROM push_send_log
       WHERE sent_at < datetime('now', ?)`
    )
    .run(`-${olderThanDays} days`);
}
