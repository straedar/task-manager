import webpush from "web-push";
import {
  deletePushSubscriptionByEndpoint,
  listSubscriptionsForUser,
  listSubscriptionsForUsers,
  type PushSubscriptionRow,
} from "../db/queries/push.js";

let configured = false;

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@task-manager.local",
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

async function sendToSubscription(
  sub: PushSubscriptionRow,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) return;

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    );
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      deletePushSubscriptionByEndpoint(sub.endpoint);
      return;
    }
    console.error("[push] send failed", status ?? err);
  }
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<number> {
  const subs = listSubscriptionsForUser(userId);
  await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
  return subs.length;
}

export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload
): Promise<number> {
  const unique = [...new Set(userIds)];
  const subs = listSubscriptionsForUsers(unique);
  await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
  return subs.length;
}
