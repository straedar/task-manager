/**
 * Permission catalog — derived from the feature registry.
 * Prefer editing registry.ts when adding apps/objects/rights.
 */
import {
  deriveHubApps,
  derivePermissionCodes,
  derivePermissionGroups,
  deriveSeedPermissions,
  objectPerm,
  type CrudAction,
} from "./registry.js";

export const PERMISSION_CODES = derivePermissionCodes() as readonly string[];

/** Permission code string (registry-driven; not a fixed union). */
export type PermissionCode = string;

export const PERMISSION_SET = new Set<string>(PERMISSION_CODES);

export type PermissionGroup = {
  id: string;
  label: string;
  permissions: { code: PermissionCode; label: string }[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = derivePermissionGroups();

export const HUB_APPS = deriveHubApps();

export const EMPLOYEE_PERMISSIONS: PermissionCode[] = deriveSeedPermissions("employee");

export const WAREHOUSE_MANAGER_PERMISSIONS: PermissionCode[] =
  deriveSeedPermissions("warehouse_manager");

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_SET.has(value);
}

export function sanitizePermissions(values: unknown): PermissionCode[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<PermissionCode>();
  for (const item of values) {
    if (typeof item === "string" && isPermissionCode(item)) {
      unique.add(item);
    }
  }
  return [...unique];
}

export { objectPerm };
export type { CrudAction };
