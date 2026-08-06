import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "../db/queries/push.js";
import { getVapidPublicKey, isPushConfigured, sendPushToUser } from "../services/push.js";

const router = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

router.get("/vapid-public-key", (_req, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Push не настроен на сервере" });
    return;
  }
  res.json({ publicKey: getVapidPublicKey() });
});

router.post("/subscribe", requireAuth, (req: AuthRequest, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Push не настроен на сервере" });
    return;
  }

  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Неверные данные" });
    return;
  }

  upsertPushSubscription(req.user!.id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  });

  res.json({ ok: true });
});

router.delete("/subscribe", requireAuth, (req: AuthRequest, res) => {
  const endpoint = z.string().url().safeParse(req.body?.endpoint);
  if (!endpoint.success) {
    res.status(400).json({ error: "Укажите endpoint" });
    return;
  }

  deletePushSubscription(req.user!.id, endpoint.data);
  res.json({ ok: true });
});

router.post("/test", requireAuth, async (req: AuthRequest, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: "Push не настроен на сервере" });
    return;
  }

  const sent = await sendPushToUser(req.user!.id, {
    title: "Пуш включены",
    body: "Уведомления приходят даже когда сайт закрыт",
    url: "/",
    tag: "push-test",
  });

  if (sent === 0) {
    res.status(400).json({ error: "Нет активной подписки на этом устройстве" });
    return;
  }

  res.json({ ok: true, sent });
});

export default router;
