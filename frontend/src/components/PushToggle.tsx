import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { api } from "../api/client";
import {
  getExistingSubscription,
  isPushSupported,
  isSecureForPush,
  subscribeToPush,
  subscriptionToJson,
  unsubscribeFromPush,
} from "../lib/push";

type Status = "loading" | "unsupported" | "insecure" | "off" | "on" | "busy";

export function PushToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!isPushSupported()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (!isSecureForPush()) {
        if (!cancelled) setStatus("insecure");
        return;
      }
      try {
        const sub = await getExistingSubscription();
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const showHint = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(null), 4000);
  };

  const toggle = async () => {
    if (status === "busy" || status === "loading") return;

    if (status === "unsupported") {
      showHint("Браузер не поддерживает пуш-уведомления");
      return;
    }

    if (status === "insecure") {
      showHint("Нужен HTTPS — без него Android не даёт пуши");
      return;
    }

    setStatus("busy");
    try {
      if (status === "on") {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await api.unsubscribePush(endpoint);
        setStatus("off");
        showHint("Пуш-уведомления выключены");
        return;
      }

      const { publicKey } = await api.getVapidPublicKey();
      const sub = await subscribeToPush(publicKey);
      await api.subscribePush(subscriptionToJson(sub));
      try {
        await api.testPush();
      } catch {
        /* subscription saved; test may fail if FCM lag */
      }
      setStatus("on");
      showHint("Пуш включены — проверьте уведомление");
    } catch (err) {
      setStatus("off");
      showHint(err instanceof Error ? err.message : "Не удалось включить пуш");
    }
  };

  const Icon = status === "on" ? BellRing : status === "insecure" || status === "unsupported" ? BellOff : Bell;
  const active = status === "on";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={status === "busy" || status === "loading"}
        className={`flex h-10 w-10 items-center justify-center rounded-full shadow-soft transition ${
          active
            ? "bg-orange-500 text-white"
            : "bg-white text-gray-500 hover:text-orange-500"
        } disabled:opacity-60`}
        aria-label={active ? "Выключить уведомления" : "Включить уведомления"}
        title={
          status === "insecure"
            ? "Нужен HTTPS"
            : active
              ? "Пуш включены"
              : "Включить пуш-уведомления"
        }
      >
        <Icon className="h-5 w-5" />
      </button>
      {hint && (
        <div className="absolute right-0 top-12 z-50 w-56 rounded-xl bg-gray-900 px-3 py-2 text-xs leading-snug text-white shadow-soft">
          {hint}
        </div>
      )}
    </div>
  );
}
