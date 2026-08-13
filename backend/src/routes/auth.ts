import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  getUserByNickname,
  getUserById,
  createUser,
  getAllUsers,
  getUserAuthById,
  updateUserParent,
  updateUserRole,
  updateUserPassword,
  deleteUser,
  wouldCreateCycle,
} from "../db/queries/users.js";
import { getRoleById, getDefaultEmployeeRoleId } from "../db/queries/roles.js";
import {
  createPasswordRestoreCode,
  redeemPasswordRestoreCode,
} from "../db/queries/passwordRestore.js";
import {
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";

const router = Router();

const loginSchema = z.object({
  nickname: z.string().min(1, "Введите никнейм"),
  password: z.string().min(1, "Введите пароль"),
});

const createUserSchema = z.object({
  nickname: z.string().min(3).max(30),
  password: z.string(),
  parent_id: z.number().int().positive().nullable(),
  role_id: z.number().int().positive().nullable().optional(),
});

const patchUserSchema = z.object({
  parent_id: z.number().int().positive().nullable().optional(),
  role_id: z.number().int().positive().nullable().optional(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Введите текущий пароль"),
  new_password: z.string().min(4, "Новый пароль — минимум 4 символа"),
});

const restorePasswordSchema = z.object({
  nickname: z.string().min(1, "Введите никнейм"),
  code: z.string().min(4, "Введите код восстановления"),
  new_password: z.string().min(4, "Новый пароль — минимум 4 символа"),
});

function resolveRoleId(roleId: number | null | undefined): {
  ok: true;
  role_id: number | null;
} | { ok: false; error: string } {
  if (roleId === undefined) return { ok: true, role_id: null };
  if (roleId === null) return { ok: true, role_id: null };
  if (!getRoleById(roleId)) {
    return { ok: false, error: "Роль не найдена" };
  }
  return { ok: true, role_id: roleId };
}

router.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { nickname, password } = parsed.data;
  const user = getUserByNickname(nickname);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Неверный никнейм или пароль" });
    return;
  }

  setSessionCookie(res, user.id);
  res.json({ user: getUserAuthById(user.id) });
});

router.post("/register", (_req, res) => {
  res.status(403).json({
    error: "Регистрация закрыта. Аккаунт создаёт администратор.",
  });
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

router.post("/change-password", requireAuth, (req: AuthRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const user = getUserById(req.user!.id);
  if (!user) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  const { current_password, new_password } = parsed.data;
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    res.status(400).json({ error: "Неверный текущий пароль" });
    return;
  }

  if (current_password === new_password) {
    res.status(400).json({ error: "Новый пароль должен отличаться от текущего" });
    return;
  }

  updateUserPassword(user.id, bcrypt.hashSync(new_password, 10));
  res.json({ ok: true });
});

router.post("/restore-password", (req, res) => {
  const parsed = restorePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const redeemed = redeemPasswordRestoreCode(parsed.data.nickname, parsed.data.code);
  if (!redeemed.ok) {
    res.status(400).json({ error: redeemed.error });
    return;
  }

  updateUserPassword(redeemed.user_id, bcrypt.hashSync(parsed.data.new_password, 10));
  setSessionCookie(res, redeemed.user_id);
  res.json({ user: getUserAuthById(redeemed.user_id) });
});

router.get("/users", (_req, res) => {
  res.json({ users: getAllUsers() });
});

const adminGate = requirePermission("app.administration");

router.get("/admin/tree", requireAuth, adminGate, (_req, res) => {
  res.json({ users: getAllUsers() });
});

router.post("/admin/users", requireAuth, adminGate, (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  if (getUserByNickname(parsed.data.nickname)) {
    res.status(409).json({ error: "Никнейм занят" });
    return;
  }

  if (parsed.data.parent_id !== null && !getUserById(parsed.data.parent_id)) {
    res.status(400).json({ error: "Родитель не найден" });
    return;
  }

  const roleResolved = resolveRoleId(
    parsed.data.role_id !== undefined
      ? parsed.data.role_id
      : getDefaultEmployeeRoleId()
  );
  if (!roleResolved.ok) {
    res.status(400).json({ error: roleResolved.error });
    return;
  }

  const user = createUser({
    nickname: parsed.data.nickname,
    password_hash: bcrypt.hashSync(parsed.data.password, 10),
    parent_id: parsed.data.parent_id,
    role_id: roleResolved.role_id,
  });

  res.status(201).json({ user });
});

router.patch("/admin/users/:id", requireAuth, adminGate, (req, res) => {
  const id = Number(req.params.id);
  const parsed = patchUserSchema.safeParse(req.body);
  if (Number.isNaN(id) || !parsed.success) {
    res.status(400).json({
      error: parsed.success ? "Неверные данные" : parsed.error.errors[0].message,
    });
    return;
  }

  if (
    parsed.data.parent_id === undefined &&
    parsed.data.role_id === undefined
  ) {
    res.status(400).json({ error: "Нет данных для обновления" });
    return;
  }

  const existing = getUserById(id);
  if (!existing) {
    res.status(404).json({ error: "Пользователь не найден" });
    return;
  }

  if (parsed.data.parent_id !== undefined) {
    if (existing.parent_id === null && parsed.data.parent_id !== null) {
      res.status(400).json({ error: "Нельзя переместить корневого пользователя" });
      return;
    }

    if (parsed.data.parent_id !== null && !getUserById(parsed.data.parent_id)) {
      res.status(400).json({ error: "Родитель не найден" });
      return;
    }

    if (wouldCreateCycle(id, parsed.data.parent_id)) {
      res.status(400).json({ error: "Нельзя переместить внутрь подчинённого" });
      return;
    }

    updateUserParent(id, parsed.data.parent_id);
  }

  if (parsed.data.role_id !== undefined) {
    if (existing.parent_id === null) {
      res.status(400).json({ error: "Корневому админу роль не назначается" });
      return;
    }
    const roleResolved = resolveRoleId(parsed.data.role_id);
    if (!roleResolved.ok) {
      res.status(400).json({ error: roleResolved.error });
      return;
    }
    updateUserRole(id, roleResolved.role_id);
  }

  res.json({ user: getAllUsers().find((u) => u.id === id) ?? getUserAuthById(id) });
});

router.delete("/admin/users/:id", requireAuth, adminGate, (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const result = deleteUser(id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

router.post("/admin/users/:id/restore-code", requireAuth, adminGate, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: "Пользователь не найден" });
    return;
  }
  const { code, expires_at } = createPasswordRestoreCode(id, req.user!.id);
  res.json({
    code,
    expires_at,
    nickname: target.nickname,
  });
});

export default router;
