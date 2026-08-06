import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  getAvatarUrl,
  getProfile,
  setAvatarUrl,
  updateProfile,
} from "../db/queries/profile.js";
import { getUserAuthById } from "../db/queries/users.js";
import { hasPermission } from "../permissions/access.js";
import { imageUpload, imageUploadErrorMessage } from "../uploads/index.js";
import { deleteUploadByUrl, saveUploadBuffer } from "../uploads/store.js";

const router = Router();

const patchSchema = z.object({
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
});

router.use(requireAuth);

router.get("/", (req: AuthRequest, res) => {
  const profile = getProfile(req.user!.id);
  if (!profile) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ profile });
});

/** Read-only profile of another user (Структура) or self by id. */
router.get("/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Неверный id" });
    return;
  }
  const isSelf = id === req.user!.id;
  if (!isSelf && !hasPermission(req.user!, "app.structure")) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  const profile = getProfile(id);
  if (!profile) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ profile });
});

router.patch("/", (req: AuthRequest, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  const current = getProfile(req.user!.id);
  if (!current) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  const profile = updateProfile(req.user!.id, {
    first_name: parsed.data.first_name ?? current.first_name,
    last_name: parsed.data.last_name ?? current.last_name,
  });
  res.json({
    profile,
    user: getUserAuthById(req.user!.id),
  });
});

router.post("/avatar", (req: AuthRequest, res) => {
  imageUpload.single("avatar")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: imageUploadErrorMessage(err) });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Выберите изображение" });
      return;
    }
    try {
      const prev = getAvatarUrl(req.user!.id);
      const saved = saveUploadBuffer({
        kind: "avatars",
        buffer: file.buffer,
        mime: file.mimetype,
      });
      const profile = setAvatarUrl(req.user!.id, saved.url);
      deleteUploadByUrl(prev);
      res.json({
        profile,
        user: getUserAuthById(req.user!.id),
      });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "Не удалось сохранить",
      });
    }
  });
});

router.delete("/avatar", (req: AuthRequest, res) => {
  const prev = getAvatarUrl(req.user!.id);
  const profile = setAvatarUrl(req.user!.id, null);
  deleteUploadByUrl(prev);
  res.json({
    profile,
    user: getUserAuthById(req.user!.id),
  });
});

export default router;
