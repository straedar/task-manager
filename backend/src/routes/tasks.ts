import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";
import {
  getAllTasks,
  createTask,
  completeTask,
  startTask,
  restoreTask,
  deleteTask,
  updateTask,
  getTaskById,
} from "../db/queries/tasks.js";
import {
  canCreateTask,
  canCompleteTask,
  canStartTask,
  canRestoreTask,
  canDeleteTask,
  canEditTask,
  canViewTask,
  canAssignToUsers,
  canCreateSharedTask,
  getSharedTaskAssigneeIds,
  filterVisibleTasks,
  getAssignableUsers,
  hasSubordinates,
} from "../permissions.js";
import { getUserPublicById } from "../db/queries/users.js";
import { createMessage, listMessages, markThreadRead, withChat, getChatIndicator } from "../db/queries/itemMessages.js";
import { notifyUsers } from "../services/notify.js";
import { isPastMoscowDay } from "../utils/moscowTime.js";

const router = Router();

router.use(requireAuth, requirePermission("app.tasks"));

const messageSchema = z.object({
  body: z.string().trim().min(1, "Введите сообщение").max(2000, "Максимум 2000 символов"),
});

const createTaskSchema = z
  .object({
    title: z.string().min(1, "Введите название"),
    description: z.string().default(""),
    priority: z.enum(["low", "medium", "high"]),
    assigneeIds: z.array(z.number()).default([]),
    is_shared: z.boolean().default(false),
    is_private: z.boolean().default(false),
    due_at: z.string().nullable().optional(),
    planned_for: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.is_shared && data.assigneeIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Выберите хотя бы одного исполнителя",
        path: ["assigneeIds"],
      });
    }
    if (data.is_private && data.is_shared) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Общая задача не может быть приватной",
        path: ["is_private"],
      });
    }
  });

router.get("/", requireAuth, (req: AuthRequest, res) => {
  const tasks = filterVisibleTasks(req.user!, getAllTasks());
  res.json({ tasks: withChat("task", tasks, req.user!.id) });
});

router.get("/assignable-users", requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  res.json({
    users: getAssignableUsers(user),
    has_subordinates: hasSubordinates(user),
  });
});

router.get("/:id/messages", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }
  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }
  if (!canViewTask(req.user!, task)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }
  markThreadRead("task", taskId, req.user!.id);
  res.json({ messages: listMessages("task", taskId) });
});

router.post("/:id/messages", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }
  if (!canViewTask(req.user!, task)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }

  const message = createMessage("task", taskId, req.user!.id, parsed.data.body);
  const recipients = [
    task.created_by,
    ...task.assignees.map((a) => a.id),
  ].filter((id) => id !== req.user!.id);

  if (recipients.length > 0) {
    void notifyUsers(
      recipients,
      "task_comments",
      {
        title: "Новое сообщение в задаче",
        body: `«${task.title}»`,
        url: `/tasks/t/${taskId}`,
        tag: `task-msg-${taskId}`,
      },
      { priority: task.priority }
    );
  }

  res.status(201).json({ message });
});

router.get("/:id", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }
  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }
  if (!canViewTask(req.user!, task)) {
    res.status(403).json({ error: "Нет доступа" });
    return;
  }
  res.json({
    task: { ...task, chat: getChatIndicator("task", task.id, req.user!.id) },
  });
});

router.post("/", requireAuth, (req: AuthRequest, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { title, description, priority, is_shared, due_at, planned_for } = parsed.data;
  let { assigneeIds } = parsed.data;
  let is_private = parsed.data.is_private;
  const user = req.user!;

  if (is_shared) {
    if (!canCreateSharedTask(user)) {
      res.status(403).json({
        error: "Общую задачу может создать только пользователь с подчинёнными",
      });
      return;
    }
    assigneeIds = getSharedTaskAssigneeIds(user.id);
    is_private = false;
  } else if (!canCreateTask(user, assigneeIds)) {
    res.status(403).json({ error: "Нет прав для назначения выбранных исполнителей" });
    return;
  }

  if (is_private) {
    if (!(assigneeIds.length === 1 && assigneeIds[0] === user.id)) {
      res.status(400).json({
        error: "Приватной может быть только задача, назначенная себе",
      });
      return;
    }
  }

  if (isPastMoscowDay(planned_for ?? null)) {
    res.status(400).json({ error: "Нельзя создать задачу на прошедший день" });
    return;
  }

  const task = createTask({
    title,
    description,
    priority,
    created_by: user.id,
    assigneeIds,
    is_shared,
    is_private,
    due_at: due_at ?? null,
    planned_for: planned_for ?? null,
  });

  const recipients = assigneeIds.filter((id) => id !== user.id);
  if (recipients.length > 0) {
    void notifyUsers(
      recipients,
      "task_assigned",
      {
        title: "Новая задача",
        body: `«${title}» от ${user.nickname}`,
        url: "/tasks",
        tag: `task-new-${task.id}`,
      },
      { priority, groupTitle: title }
    );
  }

  res.status(201).json({ task });
});

router.post("/:id/complete", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }

  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }

  if (!canCompleteTask(req.user!, task)) {
    res.status(403).json({ error: "Нет прав для завершения этой задачи" });
    return;
  }

  const wasComplete = task.status === "completed";
  const completed = completeTask(taskId, req.user!.id);
  if (!completed) {
    res.status(400).json({ error: "Не удалось завершить" });
    return;
  }

  const actor = req.user!;
  const creatorId = completed.created_by;
  if (creatorId !== actor.id && !wasComplete) {
    if (completed.status === "completed") {
      void notifyUsers(
        [creatorId],
        "task_fully_done",
        {
          title: "Задача выполнена",
          body: `«${completed.title}» — все исполнители готовы`,
          url: "/tasks",
          tag: `task-done-${completed.id}`,
        },
        { priority: completed.priority }
      );
    } else {
      void notifyUsers(
        [creatorId],
        "task_assignee_done",
        {
          title: "Исполнитель отметил готовность",
          body: `${actor.nickname}: «${completed.title}»`,
          url: "/tasks",
          tag: `task-part-${completed.id}-${actor.id}`,
        },
        { priority: completed.priority }
      );
    }
  }

  res.json({ task: completed });
});

router.post("/:id/start", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }

  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }

  if (!canStartTask(req.user!, task)) {
    res.status(403).json({ error: "Нет прав для начала работы над задачей" });
    return;
  }

  const started = startTask(taskId);
  res.json({ task: started });
});

router.post("/:id/restore", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }

  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }

  if (!canRestoreTask(req.user!, task)) {
    res.status(403).json({ error: "Нет прав для восстановления этой задачи" });
    return;
  }

  const restored = restoreTask(taskId);
  if (!restored) {
    res.status(400).json({ error: "Можно восстановить только просроченную завершённую задачу" });
    return;
  }

  res.json({ task: restored });
});

router.patch("/:id", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }

  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }

  if (!canEditTask(req.user!, task)) {
    res.status(403).json({ error: "Нет прав для изменения этой задачи" });
    return;
  }

  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { title, description, priority, is_shared, due_at, planned_for } = parsed.data;
  let { assigneeIds } = parsed.data;
  let is_private = parsed.data.is_private;

  if (is_shared) {
    const owner = getUserPublicById(task.created_by);
    if (!owner || !canCreateSharedTask(owner)) {
      res.status(400).json({
        error: "Общую задачу можно назначить только если у создателя есть подчинённые",
      });
      return;
    }
    assigneeIds = getSharedTaskAssigneeIds(task.created_by);
    is_private = false;
  } else if (!canAssignToUsers(req.user!, assigneeIds)) {
    res.status(403).json({ error: "Нет прав для назначения выбранных исполнителей" });
    return;
  }

  if (is_private) {
    if (!(assigneeIds.length === 1 && assigneeIds[0] === task.created_by)) {
      res.status(400).json({
        error: "Приватной может быть только задача, назначенная создателю",
      });
      return;
    }
  }

  if (
    planned_for !== undefined &&
    isPastMoscowDay(planned_for ?? null) &&
    (planned_for ?? null) !== task.planned_for
  ) {
    res.status(400).json({ error: "Нельзя перенести задачу на прошедший день" });
    return;
  }

  const updated = updateTask(taskId, {
    title,
    description,
    priority,
    assigneeIds,
    is_shared,
    is_private,
    ...(due_at !== undefined ? { due_at } : {}),
    ...(planned_for !== undefined ? { planned_for } : {}),
  });

  if (updated) {
    const changed =
      task.title !== updated.title ||
      task.description !== updated.description ||
      task.priority !== updated.priority ||
      task.due_at !== updated.due_at ||
      task.planned_for !== updated.planned_for;
    if (changed) {
      const recipients = updated.assignees
        .map((a) => a.id)
        .filter((id) => id !== req.user!.id);
      if (recipients.length > 0) {
        void notifyUsers(
          recipients,
          "task_changed",
          {
            title: "Задача изменена",
            body: `«${updated.title}»`,
            url: "/tasks",
            tag: `task-edit-${updated.id}`,
          },
          { priority: updated.priority, groupTitle: updated.title }
        );
      }
    }
  }

  res.json({ task: updated });
});

router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const taskId = Number(req.params.id);
  if (Number.isNaN(taskId)) {
    res.status(400).json({ error: "Неверный ID задачи" });
    return;
  }

  const task = getTaskById(taskId);
  if (!task) {
    res.status(404).json({ error: "Задача не найдена" });
    return;
  }

  if (!canDeleteTask(req.user!, task)) {
    res.status(403).json({ error: "Нет прав для удаления этой задачи" });
    return;
  }

  deleteTask(taskId);
  res.json({ ok: true });
});

export default router;
