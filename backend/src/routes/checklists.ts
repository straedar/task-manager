import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";
import {
  createChecklist,
  deleteChecklist,
  getAllChecklists,
  getChecklistById,
  restoreChecklist,
  setChecklistItemCompleted,
  claimChecklistItem,
  completeChecklistItem,
  unclaimChecklistItem,
  uncompleteChecklistItem,
  updateChecklist,
} from "../db/queries/checklists.js";
import {
  canClaimChecklistItem,
  canCompleteSharedChecklistItem,
  canCreateChecklist,
  canCreateSharedChecklist,
  canDeleteChecklist,
  canEditChecklist,
  canRestoreChecklist,
  canToggleChecklistItem,
  canUnclaimChecklistItem,
  canUncompleteSharedChecklistItem,
  canViewChecklist,
  filterVisibleChecklists,
} from "../permissions.js";
import { createMessage, listMessages, markThreadRead, withChat, getChatIndicator } from "../db/queries/itemMessages.js";
import { notifyUsers } from "../services/notify.js";
import { isPastMoscowDay } from "../utils/moscowTime.js";

const router = Router();

router.use(requireAuth, requirePermission("app.tasks"));

const itemSchema = z.object({
  id: z.number().optional().nullable(),
  title: z.string().trim().min(1, "Пункт не может быть пустым"),
});

const createSchema = z
  .object({
    title: z.string().min(1, "Введите название"),
    assignee_id: z.number({ required_error: "Выберите исполнителя" }),
    items: z
      .array(z.string().trim().min(1, "Пункт не может быть пустым"))
      .min(1, "Добавьте хотя бы один пункт"),
    has_deadline: z.boolean().default(true),
    planned_for: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    is_private: z.boolean().default(false),
    is_shared: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.is_private && data.is_shared) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Общий чеклист не может быть приватным",
        path: ["is_private"],
      });
    }
  });

const updateSchema = z
  .object({
    title: z.string().min(1, "Введите название"),
    assignee_id: z.number({ required_error: "Выберите исполнителя" }),
    items: z.array(itemSchema).min(1, "Добавьте хотя бы один пункт"),
    has_deadline: z.boolean(),
    planned_for: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    is_private: z.boolean().default(false),
    is_shared: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.is_private && data.is_shared) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Общий чеклист не может быть приватным",
        path: ["is_private"],
      });
    }
  });

const toggleSchema = z.object({
  action: z.enum(["claim", "unclaim", "complete", "uncomplete"]).optional(),
  completed: z.boolean().optional(),
});

const messageSchema = z.object({
  body: z.string().trim().min(1, "Введите сообщение").max(2000, "Максимум 2000 символов"),
});

router.get("/", requireAuth, (req: AuthRequest, res) => {
  const checklists = filterVisibleChecklists(req.user!, getAllChecklists());
  res.json({ checklists: withChat("checklist", checklists, req.user!.id) });
});

router.get("/:id/messages", requireAuth, (req: AuthRequest, res) => {
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
  if (!canViewChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }
  markThreadRead("checklist", checklistId, req.user!.id);
  res.json({ messages: listMessages("checklist", checklistId) });
});

router.post("/:id/messages", requireAuth, (req: AuthRequest, res) => {
  const checklistId = Number(req.params.id);
  if (Number.isNaN(checklistId)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const checklist = getChecklistById(checklistId);
  if (!checklist) {
    res.status(404).json({ error: "Чеклист не найден" });
    return;
  }
  if (!canViewChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }

  const message = createMessage(
    "checklist",
    checklistId,
    req.user!.id,
    parsed.data.body
  );
  const recipients = [checklist.created_by, checklist.assignee_id].filter(
    (id) => id !== req.user!.id
  );
  if (recipients.length > 0) {
    void notifyUsers(recipients, "task_comments", {
      title: "Новое сообщение в чеклисте",
      body: `«${checklist.title}»`,
      url: `/tasks/c/${checklistId}`,
      tag: `checklist-msg-${checklistId}`,
    });
  }

  res.status(201).json({ message });
});

router.get("/:id", requireAuth, (req: AuthRequest, res) => {
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
  if (!canViewChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }
  res.json({
    checklist: {
      ...checklist,
      chat: getChatIndicator("checklist", checklist.id, req.user!.id),
    },
  });
});

router.post("/", requireAuth, (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const user = req.user!;
  let { title, assignee_id, items, has_deadline, planned_for, expires_at, is_private, is_shared } =
    parsed.data;

  if (is_shared) {
    if (!canCreateSharedChecklist(user)) {
      res.status(403).json({
        error: "Общий чеклист может создать только пользователь с подчинёнными",
      });
      return;
    }
    assignee_id = user.id;
    is_private = false;
  } else if (!canCreateChecklist(user, assignee_id)) {
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
    is_shared,
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

  let { title, assignee_id, items, has_deadline, planned_for, expires_at, is_private, is_shared } =
    parsed.data;

  if (is_shared) {
    if (!canCreateSharedChecklist(req.user!) && !checklist.is_shared) {
      res.status(403).json({
        error: "Общий чеклист может создать только пользователь с подчинёнными",
      });
      return;
    }
    // При редактировании общий остаётся у постановщика; участники — его ветка
    assignee_id = checklist.created_by;
    is_private = false;
  } else if (!canCreateChecklist(req.user!, assignee_id)) {
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
    expires_at: expires_at ?? null,
    is_private,
    is_shared,
  });

  if (!updated) {
    res.status(400).json({ error: "Не удалось сохранить" });
    return;
  }

  res.json({ checklist: updated });
});

router.post("/:id/restore", requireAuth, (req: AuthRequest, res) => {
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

  if (!canRestoreChecklist(req.user!, checklist)) {
    res.status(403).json({ error: "Нет прав для восстановления этого чеклиста" });
    return;
  }

  const restored = restoreChecklist(checklistId);
  if (!restored) {
    res.status(400).json({
      error: "Можно восстановить только просроченный или невыполненный чеклист",
    });
    return;
  }

  res.json({ checklist: restored });
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

  const pastDue =
    checklist.status === "open" &&
    checklist.expires_at &&
    Number.isFinite(Date.parse(checklist.expires_at)) &&
    Date.parse(checklist.expires_at) <= Date.now();

  const deny = (message: string) => {
    res.status(403).json({
      error: pastDue ? "Чеклист просрочен — пункты нельзя отмечать" : message,
    });
  };

  const item = checklist.items.find((i) => i.id === itemId);
  if (!item) {
    res.status(404).json({ error: "Пункт не найден" });
    return;
  }

  const user = req.user!;
  let action = parsed.data.action;
  if (!action) {
    if (parsed.data.completed === true) action = "complete";
    else if (parsed.data.completed === false) action = "uncomplete";
    else if (checklist.is_shared && !item.claimed_by && !item.completed_at) action = "claim";
    else if (checklist.is_shared && item.claimed_by && !item.completed_at) action = "complete";
    else {
      res.status(400).json({ error: "Укажите действие" });
      return;
    }
  }

  if (checklist.is_shared) {
    let updated = null;
    if (action === "claim") {
      if (!canClaimChecklistItem(user, checklist, item)) {
        deny("Нет прав взять пункт в работу");
        return;
      }
      updated = claimChecklistItem(checklistId, itemId, user.id);
    } else if (action === "unclaim") {
      if (!canUnclaimChecklistItem(user, checklist, item)) {
        deny(
          item.claimed_by && item.claimed_by !== user.id
            ? "Чужой пункт может освободить только постановщик или админ"
            : "Нет прав снять пункт с работы"
        );
        return;
      }
      updated = unclaimChecklistItem(checklistId, itemId);
    } else if (action === "complete") {
      if (!canCompleteSharedChecklistItem(user, checklist, item)) {
        deny(
          item.claimed_by && item.claimed_by !== user.id
            ? "Чужой пункт может завершить только постановщик или админ"
            : "Нет прав завершить пункт"
        );
        return;
      }
      updated = completeChecklistItem(checklistId, itemId);
    } else {
      if (!canUncompleteSharedChecklistItem(user, checklist, item)) {
        deny("Нет прав снять отметку");
        return;
      }
      updated = uncompleteChecklistItem(checklistId, itemId);
    }

    if (!updated) {
      res.status(400).json({ error: "Нельзя изменить пункт" });
      return;
    }
    res.json({ checklist: updated });
    return;
  }

  if (!canToggleChecklistItem(user, checklist)) {
    deny("Нет прав для изменения пунктов");
    return;
  }

  const completed = action === "complete";
  if (action !== "complete" && action !== "uncomplete") {
    res.status(400).json({ error: "Недопустимое действие" });
    return;
  }

  const updated = setChecklistItemCompleted(checklistId, itemId, completed);
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
