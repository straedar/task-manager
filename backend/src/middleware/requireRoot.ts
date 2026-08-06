import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";
import { isRoot } from "../types.js";
import { hasPermission } from "../permissions/access.js";
import type { PermissionCode } from "../permissions/catalog.js";

export function requireRoot(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }
  if (!isRoot(req.user)) {
    res.status(403).json({ error: "Доступ только для корневого пользователя" });
    return;
  }
  next();
}

/** Root always passes; otherwise requires the given permission. */
export function requirePermission(code: PermissionCode) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Не авторизован" });
      return;
    }
    if (!hasPermission(req.user, code)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }
    next();
  };
}
