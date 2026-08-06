import { Router } from "express";
import { z } from "zod";
import {
  createRole,
  deleteRole,
  getRoleById,
  listRoles,
  updateRole,
} from "../db/queries/roles.js";
import { hasPermission } from "../permissions/access.js";
import type { PermissionCode } from "../permissions/catalog.js";
import {
  PERMISSION_GROUPS,
  sanitizePermissions,
} from "../permissions/catalog.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";

const router = Router();

function requireAnyPermission(...codes: PermissionCode[]) {
  return (req: AuthRequest, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Не авторизован" });
      return;
    }
    if (!codes.some((code) => hasPermission(req.user!, code))) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }
    next();
  };
}

const roleBodySchema = z.object({
  name: z.string().min(2, "Название слишком короткое").max(60),
  description: z.string().max(300).optional().default(""),
  permissions: z.array(z.string()),
});

router.get(
  "/catalog",
  requireAuth,
  requirePermission("roles.manage"),
  (_req, res) => {
    res.json({ groups: PERMISSION_GROUPS });
  }
);

router.get(
  "/",
  requireAuth,
  requireAnyPermission("roles.manage", "app.administration"),
  (_req, res) => {
    res.json({ roles: listRoles() });
  }
);

router.get(
  "/:id",
  requireAuth,
  requirePermission("roles.manage"),
  (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Неверный ID" });
      return;
    }
    const role = getRoleById(id);
    if (!role) {
      res.status(404).json({ error: "Роль не найдена" });
      return;
    }
    res.json({ role });
  }
);

router.post(
  "/",
  requireAuth,
  requirePermission("roles.manage"),
  (req: AuthRequest, res) => {
    const parsed = roleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const permissions = sanitizePermissions(parsed.data.permissions);
    try {
      const role = createRole({
        name: parsed.data.name.trim(),
        description: parsed.data.description.trim(),
        permissions,
      });
      res.status(201).json({ role });
    } catch {
      res.status(409).json({ error: "Роль с таким названием уже есть" });
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requirePermission("roles.manage"),
  (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Неверный ID" });
      return;
    }
    const parsed = roleBodySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    try {
      const role = updateRole(id, {
        name: parsed.data.name?.trim(),
        description: parsed.data.description?.trim(),
        permissions: parsed.data.permissions
          ? sanitizePermissions(parsed.data.permissions)
          : undefined,
      });
      if (!role) {
        res.status(404).json({ error: "Роль не найдена" });
        return;
      }
      res.json({ role });
    } catch {
      res.status(409).json({ error: "Роль с таким названием уже есть" });
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  requirePermission("roles.manage"),
  (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Неверный ID" });
      return;
    }
    const result = deleteRole(id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  }
);

export default router;
