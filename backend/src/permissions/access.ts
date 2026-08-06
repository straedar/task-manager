import type { UserPublic } from "../types.js";
import { isRoot } from "../types.js";
import {
  PERMISSION_CODES,
  type PermissionCode,
} from "./catalog.js";
import { getRolePermissions } from "../db/queries/roles.js";

export function getUserPermissions(user: UserPublic): PermissionCode[] {
  if (isRoot(user)) {
    return [...PERMISSION_CODES];
  }
  if (user.role_id == null) {
    return [];
  }
  return getRolePermissions(user.role_id);
}

export function hasPermission(user: UserPublic, code: PermissionCode): boolean {
  if (isRoot(user)) return true;
  if (user.role_id == null) return false;
  return getRolePermissions(user.role_id).includes(code);
}

export function hasAnyPermission(
  user: UserPublic,
  codes: PermissionCode[]
): boolean {
  return codes.some((code) => hasPermission(user, code));
}
