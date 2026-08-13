import { Router } from "express";
import { z } from "zod";
import {
  createFeedbackBatch,
  deleteFeedbackBatch,
  getFeedbackBatch,
  listFeedbackBatches,
  replaceFeedbackBatchItems,
  updateFeedbackItemReviews,
  type FeedbackItemInput,
} from "../db/queries/feedback.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { isRoot } from "../types.js";
import { hasPermission } from "../permissions/access.js";
import { htmlToExcerpt, sanitizeNewsHtml } from "../utils/sanitizeHtml.js";

const router = Router();

const itemSchema = z.object({
  kind: z.enum(["problem", "improvement"], {
    errorMap: () => ({ message: "Укажите тип: проблема или улучшение" }),
  }),
  title: z.string().trim().min(1, "Укажите название").max(200),
  description: z.string().max(50_000).optional().default(""),
});

const batchSchema = z.object({
  items: z
    .array(itemSchema)
    .min(1, "Добавьте хотя бы одну проблему или улучшение")
    .max(30, "Слишком много пунктов за раз"),
});

const reviewItemSchema = z.object({
  id: z.number().int().positive(),
  admin_done: z.boolean(),
  admin_comment: z.string().max(4000).optional().default(""),
});

const reviewSchema = z.object({
  items: z
    .array(reviewItemSchema)
    .min(1, "Укажите хотя бы один пункт")
    .max(30),
});

function canManageBatch(req: AuthRequest, authorId: number): boolean {
  if (!req.user) return false;
  if (req.user.id === authorId) return true;
  if (isRoot(req.user)) return true;
  return hasPermission(req.user, "app.administration");
}

function canAdminReview(req: AuthRequest): boolean {
  if (!req.user) return false;
  if (isRoot(req.user)) return true;
  return hasPermission(req.user, "app.administration");
}

function normalizeItems(
  items: z.infer<typeof itemSchema>[]
): FeedbackItemInput[] | { error: string } {
  const next: FeedbackItemInput[] = [];
  for (const item of items) {
    const description = sanitizeNewsHtml(item.description ?? "");
    if (!htmlToExcerpt(description, 8).trim()) {
      return { error: "Укажите описание у каждого пункта" };
    }
    next.push({
      kind: item.kind,
      title: item.title.trim(),
      description,
    });
  }
  return next;
}

router.get("/", requireAuth, (req: AuthRequest, res) => {
  const authorRaw = req.query.author_id;
  let authorId: number | undefined;
  if (authorRaw != null && String(authorRaw).trim() !== "") {
    const n = Number(authorRaw);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400).json({ error: "Неверный author_id" });
      return;
    }
    authorId = n;
  }
  res.json({ items: listFeedbackBatches(authorId) });
});

router.get("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const item = getFeedbackBatch(id);
  if (!item) {
    res.status(404).json({ error: "Обращение не найдено" });
    return;
  }
  res.json({ item });
});

router.post("/", requireAuth, (req: AuthRequest, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Ошибка данных" });
    return;
  }
  const items = normalizeItems(parsed.data.items);
  if ("error" in items) {
    res.status(400).json({ error: items.error });
    return;
  }
  const item = createFeedbackBatch(req.user!.id, items);
  res.status(201).json({ item });
});

router.patch("/:id/review", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  if (!canAdminReview(req)) {
    res.status(403).json({ error: "Только администратор может отмечать обращения" });
    return;
  }
  const existing = getFeedbackBatch(id);
  if (!existing) {
    res.status(404).json({ error: "Обращение не найдено" });
    return;
  }
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Ошибка данных" });
    return;
  }
  const reviews = parsed.data.items.map((row) => ({
    id: row.id,
    admin_done: row.admin_done,
    admin_comment: row.admin_comment.trim(),
  }));
  const item = updateFeedbackItemReviews(id, reviews);
  if (!item) {
    res.status(400).json({ error: "Пункт не принадлежит этому обращению" });
    return;
  }
  res.json({ item });
});

router.patch("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const existing = getFeedbackBatch(id);
  if (!existing) {
    res.status(404).json({ error: "Обращение не найдено" });
    return;
  }
  if (!canManageBatch(req, existing.author_id)) {
    res.status(403).json({ error: "Нельзя изменить чужое обращение" });
    return;
  }
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Ошибка данных" });
    return;
  }
  const items = normalizeItems(parsed.data.items);
  if ("error" in items) {
    res.status(400).json({ error: items.error });
    return;
  }
  const item = replaceFeedbackBatchItems(id, items);
  res.json({ item });
});

router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const existing = getFeedbackBatch(id);
  if (!existing) {
    res.status(404).json({ error: "Обращение не найдено" });
    return;
  }
  if (!canManageBatch(req, existing.author_id)) {
    res.status(403).json({ error: "Нельзя удалить чужое обращение" });
    return;
  }
  deleteFeedbackBatch(id);
  res.json({ ok: true });
});

export default router;
