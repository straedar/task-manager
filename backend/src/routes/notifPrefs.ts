import { Router } from "express";
import { z } from "zod";
import {
  DEFAULT_NOTIF_PREFS,
  getNotifPrefs,
  setNotifPrefs,
  type NotifPrefs,
} from "../db/queries/notifPrefs.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const boolKeys = Object.keys(DEFAULT_NOTIF_PREFS) as (keyof NotifPrefs)[];

const prefsSchema = z.object(
  Object.fromEntries(boolKeys.map((k) => [k, z.boolean().optional()])) as Record<
    keyof NotifPrefs,
    z.ZodOptional<z.ZodBoolean>
  >
);

router.use(requireAuth);

router.get("/", (req: AuthRequest, res) => {
  res.json({
    prefs: getNotifPrefs(req.user!.id),
    meta: {
      quiet_hours: "22:00–08:00 МСК — без уведомлений",
      weekend: "В выходные приходят только новости (задачи молчат)",
      low_priority: "Задачи с низким приоритетом не уведомляют",
    },
  });
});

router.put("/", (req: AuthRequest, res) => {
  const parsed = prefsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Неверные данные" });
    return;
  }
  const prefs = setNotifPrefs(req.user!.id, parsed.data as Partial<NotifPrefs>);
  res.json({ prefs });
});

export default router;
