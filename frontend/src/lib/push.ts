const SW_PATH = "/sw.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isSecureForPush(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register(SW_PATH);
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await getPushRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await getPushRegistration();
  if (!reg) throw new Error("Service Worker недоступен");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Разрешение на уведомления отклонено");
  }

  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getExistingSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

export function subscriptionToJson(sub: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Некорректная подписка");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}
