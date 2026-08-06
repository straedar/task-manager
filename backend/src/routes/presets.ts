import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  createPreset,
  deletePreset,
  getPresetById,
  listPresets,
  updatePreset,
  type PresetKind,
} from "../db/queries/presets.js";

const router = Router();

const taskCreateSchema = z.object({
  kind: z.literal("task"),
  name: z.string().trim().min(1, "Введите название пресета"),
  title: z.string().trim().min(1, "Введите название задачи"),
  description: z.string().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

const checklistCreateSchema = z.object({
  kind: z.literal("checklist"),
  name: z.string().trim().min(1, "Введите название пресета"),
  title: z.string().trim().min(1, "Введите название чеклиста"),
  has_deadline: z.boolean().default(true),
  items: z.array(z.string().trim().min(1, "Пункт не может быть пустым")).min(1, "Добавьте хотя бы один пункт"),
});

const createSchema = z.discriminatedUnion("kind", [taskCreateSchema, checklistCreateSchema]);

const taskUpdateSchema = z.object({
  name: z.string().trim().min(1, "Введите название пресета"),
  title: z.string().trim().min(1, "Введите название задачи"),
  description: z.string().default(""),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

const checklistUpdateSchema = z.object({
  name: z.string().trim().min(1, "Введите название пресета"),
  title: z.string().trim().min(1, "Введите название чеклиста"),
  has_deadline: z.boolean().default(true),
  items: z.array(z.string().trim().min(1, "Пункт не может быть пустым")).min(1, "Добавьте хотя бы один пункт"),
});

router.get("/", requireAuth, (req: AuthRequest, res) => {
  const kindParam = req.query.kind;
  const kind =
    kindParam === "task" || kindParam === "checklist" ? (kindParam as PresetKind) : undefined;
  const presets = listPresets(req.user!.id, kind);
  res.json({ presets });
});

router.post("/", requireAuth, (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const data = parsed.data;
  const preset =
    data.kind === "task"
      ? createPreset({
          created_by: req.user!.id,
          kind: "task",
          name: data.name,
          title: data.title,
          description: data.description,
          priority: data.priority,
        })
      : createPreset({
          created_by: req.user!.id,
          kind: "checklist",
          name: data.name,
          title: data.title,
          has_deadline: data.has_deadline,
          items: data.items,
        });

  res.status(201).json({ preset });
});

router.patch("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = getPresetById(id);
  if (!existing || existing.created_by !== req.user!.id) {
    res.status(404).json({ error: "Пресет не найден" });
    return;
  }

  if (existing.kind === "task") {
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const preset = updatePreset(id, parsed.data);
    res.json({ preset });
    return;
  }

  const parsed = checklistUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const preset = updatePreset(id, parsed.data);
  res.json({ preset });
});

router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = getPresetById(id);
  if (!existing || existing.created_by !== req.user!.id) {
    res.status(404).json({ error: "Пресет не найден" });
    return;
  }
  deletePreset(id);
  res.json({ ok: true });
});

export default router;
