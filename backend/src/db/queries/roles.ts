import { getDb } from "../index.js";
import {
  EMPLOYEE_PERMISSIONS,
  sanitizePermissions,
  WAREHOUSE_MANAGER_PERMISSIONS,
  type PermissionCode,
} from "../../permissions/catalog.js";

export type RoleRow = {
  id: number;
  name: string;
  description: string;
  created_at: string;
};

export type RoleWithPermissions = RoleRow & {
  permissions: PermissionCode[];
};

export function listRoles(): RoleWithPermissions[] {
  const roles = getDb()
    .prepare(
      `SELECT id, name, description, created_at FROM roles ORDER BY name COLLATE NOCASE`
    )
    .all() as RoleRow[];
  return roles.map((role) => ({
    ...role,
    permissions: getRolePermissions(role.id),
  }));
}

export function getRoleById(id: number): RoleWithPermissions | undefined {
  const role = getDb()
    .prepare(`SELECT id, name, description, created_at FROM roles WHERE id = ?`)
    .get(id) as RoleRow | undefined;
  if (!role) return undefined;
  return { ...role, permissions: getRolePermissions(role.id) };
}

export function getRolePermissions(roleId: number): PermissionCode[] {
  const rows = getDb()
    .prepare(`SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission`)
    .all(roleId) as { permission: string }[];
  return sanitizePermissions(rows.map((r) => r.permission));
}

export function createRole(data: {
  name: string;
  description: string;
  permissions: PermissionCode[];
}): RoleWithPermissions {
  const db = getDb();
  const result = db
    .prepare(`INSERT INTO roles (name, description) VALUES (?, ?)`)
    .run(data.name, data.description);
  const id = Number(result.lastInsertRowid);
  replaceRolePermissions(id, data.permissions);
  return getRoleById(id)!;
}

export function updateRole(
  id: number,
  data: {
    name?: string;
    description?: string;
    permissions?: PermissionCode[];
  }
): RoleWithPermissions | null {
  const existing = getRoleById(id);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  getDb()
    .prepare(`UPDATE roles SET name = ?, description = ? WHERE id = ?`)
    .run(name, description, id);

  if (data.permissions) {
    replaceRolePermissions(id, data.permissions);
  }
  return getRoleById(id)!;
}

export function countUsersWithRole(roleId: number): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role_id = ?`)
      .get(roleId) as { n: number }
  ).n;
}

export function deleteRole(id: number): { ok: boolean; error?: string } {
  if (!getRoleById(id)) {
    return { ok: false, error: "Роль не найдена" };
  }
  const used = countUsersWithRole(id);
  if (used > 0) {
    return {
      ok: false,
      error: `Роль назначена ${used} сотрудникам — сначала смените их роли`,
    };
  }
  getDb().prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(id);
  getDb().prepare(`DELETE FROM roles WHERE id = ?`).run(id);
  return { ok: true };
}

function replaceRolePermissions(roleId: number, permissions: PermissionCode[]) {
  const db = getDb();
  db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).run(roleId);
  const insert = db.prepare(
    `INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`
  );
  for (const permission of permissions) {
    insert.run(roleId, permission);
  }
}

export function getRoleByName(name: string): RoleWithPermissions | undefined {
  const role = getDb()
    .prepare(
      `SELECT id, name, description, created_at FROM roles WHERE name = ? COLLATE NOCASE`
    )
    .get(name) as RoleRow | undefined;
  if (!role) return undefined;
  return { ...role, permissions: getRolePermissions(role.id) };
}

export function getDefaultEmployeeRoleId(): number | null {
  return getRoleByName("Сотрудник")?.id ?? null;
}

/** Ensure default roles exist; assign «Сотрудник» to non-root users without a role. */
export function seedDefaultRoles() {
  const db = getDb();
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM roles`).get() as { n: number }).n;

  let employeeId: number | undefined;
  if (count === 0) {
    const employee = createRole({
      name: "Сотрудник",
      description: "Базовый доступ к задачам и карте склада",
      permissions: EMPLOYEE_PERMISSIONS,
    });
    createRole({
      name: "Менеджер склада",
      description: "Просмотр и редактирование карты склада",
      permissions: WAREHOUSE_MANAGER_PERMISSIONS,
    });
    employeeId = employee.id;
  } else {
    const employee = db
      .prepare(`SELECT id FROM roles WHERE name = ? COLLATE NOCASE`)
      .get("Сотрудник") as { id: number } | undefined;
    employeeId = employee?.id;
  }

  if (employeeId == null) return;

  db.prepare(
    `UPDATE users SET role_id = ?
     WHERE parent_id IS NOT NULL AND role_id IS NULL`
  ).run(employeeId);
}
