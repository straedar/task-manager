import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";
import {
  createChecklist,
  deleteChecklist,
  getAllChecklists,
  getChecklistById,
  setChecklistItemCompleted,
  updateChecklist,
} from "../db/queries/checklists.js";
import {
  canCreateChecklist,
  canDeleteChecklist,
  canEditChecklist,
  canToggleChecklistItem,
  filterVisibleChecklists,
} from "../permissions.js";
import { isPastMoscowDay } from "../utils/moscowTime.js";

const router = Router();

router.use(requireAuth, requirePermission("app.tasks"));

const itemSchema = z.object({
  id: z.number().optional().nullable(),
  title: z.string().trim().min(1, "Пункт не может быть пустым"),
});

const createSchema = z.object({
  title: z.string().min(1, "Введите название"),
  assignee_id: z.number({ required_error: "Выберите исполнителя" }),
  items: z.array(z.string().trim().min(1, "Пункт не может быть пустым")).min(1, "Добавьте хотя бы один пункт"),
  has_deadline: z.boolean().default(true),
  planned_for: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  is_private: z.boolean().default(false),
});

const updateSchema = z.object({
  title: z.string().min(1, "Введите название"),
  assignee_id: z.number({ required_error: "Выберите исполнителя" }),
  items: z.array(itemSchema).min(1, "Добавьте хотя бы один пункт"),
  has_deadline: z.boolean(),
  planned_for: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  is_private: z.boolean().default(false),
});

const toggleSchema = z.object({
  completed: z.boolean(),
});

router.get("/", requireAuth, (req: AuthRequest, res) => {
  const checklists = filterVisibleChecklists(req.user!, getAllChecklists());
  res.json({ checklists });
});

router.post("/", requireAuth, (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const user = req.user!;
  const { title, assignee_id, items, has_deadline, planned_for, expires_at, is_private } =
    parsed.data;

  if (!canCreateChecklist(user, assignee_id)) {
    res.status(403).json({ error: "Нет прав для назначения выбранного исполнителя" });
    return;
  }

  if (is_private && assignee_id !== user.id) {
    res.status(400).json({ error: "Приватным может быть только чеклист, назначенный себе" });
    return;
  }

  if (isPastMoscowDay(planned_for ?? null)) {
    res.status(400).json({ error: "Нельзя создать чеклист на прошедший день" });
    return;
  }

  const checklist = createChecklist({
    title,
    created_by: user.id,
    assignee_id,
    items,
    has_deadline,
    planned_for: planned_for ?? null,
    expires_at: expires_at ?? null,
    is_private,
  });

  res.status(201).json({ checklist });
});

router.patch("/:id", requireAuth, (req: AuthRequest, res) => {
  const checklistId = Number(req.params.id);
  if (Number.isNaN(checklistId)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const checklist = getChecklistById(checklistId);
  if (!checklist) {
    res.status(404).json({ error: "Чеклист не найден" });
    return;
  }

  if (!canEditChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет прав для изменения" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { title, assignee_id, items, has_deadline, planned_for, expires_at, is_private } =
    parsed.data;

  if (!canCreateChecklist(req.user!, assignee_id)) {
    res.status(403).json({ error: "Нет прав для назначения выбранного исполнителя" });
    return;
  }

  if (is_private && assignee_id !== checklist.created_by) {
    res.status(400).json({
      error: "Приватным может быть только чеклист, назначенный создателю",
    });
    return;
  }

  if (
    planned_for !== undefined &&
    isPastMoscowDay(planned_for) &&
    planned_for !== checklist.planned_for
  ) {
    res.status(400).json({ error: "Нельзя перенести чеклист на прошедший день" });
    return;
  }

  const updated = updateChecklist(checklistId, {
    title,
    assignee_id,
    has_deadline,
    items,
    planned_for,
    expires_at,
    is_private,
  });

  if (!updated) {
    res.status(400).json({ error: "Не удалось сохранить" });
    return;
  }

  res.json({ checklist: updated });
});

router.post("/:id/items/:itemId/toggle", requireAuth, (req: AuthRequest, res) => {
  const checklistId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (Number.isNaN(checklistId) || Number.isNaN(itemId)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const checklist = getChecklistById(checklistId);
  if (!checklist) {
    res.status(404).json({ error: "Чеклист не найден" });
    return;
  }

  if (!canToggleChecklistItem(req.user!, checklist)) {
    res.status(403).json({ error: "Нет прав для изменения пунктов" });
    return;
  }

  const updated = setChecklistItemCompleted(checklistId, itemId, parsed.data.completed);
  if (!updated) {
    res.status(400).json({ error: "Нельзя изменить пункт" });
    return;
  }

  res.json({ checklist: updated });
});

router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const checklistId = Number(req.params.id);
  if (Number.isNaN(checklistId)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }

  const checklist = getChecklistById(checklistId);
  if (!checklist) {
    res.status(404).json({ error: "Чеклист не найден" });
    return;
  }

  if (!canDeleteChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет прав для удаления" });
    return;
  }

  deleteChecklist(checklistId);
  res.json({ ok: true });
});

export default router;
