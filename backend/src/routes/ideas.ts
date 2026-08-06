import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";
import { hasPermission } from "../permissions/access.js";
import {
  completeIdea,
  createIdea,
  deleteIdea,
  getIdeaById,
  getVisibleIdeas,
  updateIdea,
} from "../db/queries/ideas.js";

const router = Router();

const ideaSchema = z.object({
  title: z.string().min(1, "Введите название"),
  description: z.string().default(""),
  tag: z.enum(["entertainment", "work"]),
  due_at: z.string().nullable().optional(),
  privacy: z.enum(["personal", "public"]),
});

function canViewIdea(userId: number, idea: { privacy: string; created_by: number }): boolean {
  return idea.privacy === "public" || idea.created_by === userId;
}

function canManageIdea(
  user: AuthRequest["user"],
  idea: { created_by: number }
): boolean {
  if (!user) return false;
  if (hasPermission(user, "tasks.manage_any")) return true;
  return idea.created_by === user.id;
}

function normalizeDueAt(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Store as ISO; comparisons with Date work on frontend
  return date.toISOString();
}

const ideasGate = requirePermission("tasks.ideas");

router.get("/", requireAuth, ideasGate, (req: AuthRequest, res) => {
  res.json({ ideas: getVisibleIdeas(req.user!.id) });
});

router.post("/", requireAuth, ideasGate, (req: AuthRequest, res) => {
  const parsed = ideaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const idea = createIdea({
    title: parsed.data.title,
    description: parsed.data.description,
    tag: parsed.data.tag,
    due_at: normalizeDueAt(parsed.data.due_at ?? null),
    privacy: parsed.data.privacy,
    created_by: req.user!.id,
  });

  res.status(201).json({ idea });
});

router.patch("/:id", requireAuth, ideasGate, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const idea = getIdeaById(id);
  if (!idea) {
    res.status(404).json({ error: "Идея не найдена" });
    return;
  }
  if (!canManageIdea(req.user!, idea)) {
    res.status(403).json({ error: "Нет прав для изменения этой идеи" });
    return;
  }

  const parsed = ideaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const updated = updateIdea(id, {
    title: parsed.data.title,
    description: parsed.data.description,
    tag: parsed.data.tag,
    due_at: normalizeDueAt(parsed.data.due_at ?? null),
    privacy: parsed.data.privacy,
  });

  res.json({ idea: updated });
});

router.post("/:id/complete", requireAuth, ideasGate, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const idea = getIdeaById(id);
  if (!idea) {
    res.status(404).json({ error: "Идея не найдена" });
    return;
  }
  if (!canViewIdea(req.user!.id, idea)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }
  if (!canManageIdea(req.user!, idea)) {
    res.status(403).json({ error: "Нет прав для завершения этой идеи" });
    return;
  }

  const completed = completeIdea(id);
  res.json({ idea: completed });
});

router.delete("/:id", requireAuth, ideasGate, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const idea = getIdeaById(id);
  if (!idea) {
    res.status(404).json({ error: "Идея не найдена" });
    return;
  }
  if (!canManageIdea(req.user!, idea)) {
    res.status(403).json({ error: "Нет прав для удаления этой идеи" });
    return;
  }

  deleteIdea(id);
  res.json({ ok: true });
});

export default router;
