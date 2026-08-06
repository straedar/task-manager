import { getDb } from "../index.js";
import type { User, UserPublic } from "../../types.js";
import { getRoleById } from "./roles.js";
import { getUserPermissions } from "../../permissions/access.js";

const USER_COLS =
  "id, nickname, password_hash, parent_id, role_id, first_name, last_name, avatar_url";
const PUBLIC_COLS =
  "id, nickname, parent_id, role_id, first_name, last_name, avatar_url";

export function getUserById(id: number): User | undefined {
  return getDb()
    .prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`)
    .get(id) as User | undefined;
}

export function getUserByNickname(nickname: string): User | undefined {
  return getDb()
    .prepare(`SELECT ${USER_COLS} FROM users WHERE nickname = ?`)
    .get(nickname) as User | undefined;
}

export function toPublic(user: User | UserPublic): UserPublic {
  return {
    id: user.id,
    nickname: user.nickname,
    parent_id: user.parent_id,
    role_id: user.role_id ?? null,
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    avatar_url: user.avatar_url ?? null,
  };
}

export function toAuthUser(user: User | UserPublic): UserPublic {
  const base = toPublic(user);
  const role =
    base.role_id != null ? getRoleById(base.role_id) : undefined;
  return {
    ...base,
    role_name: role?.name ?? null,
    permissions: getUserPermissions(base),
  };
}

export function getUserPublicById(id: number): UserPublic | undefined {
  const user = getUserById(id);
  return user ? toPublic(user) : undefined;
}

export function getUserAuthById(id: number): UserPublic | undefined {
  const user = getUserById(id);
  return user ? toAuthUser(user) : undefined;
}

export function getAllUsers(): UserPublic[] {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.nickname, u.parent_id, u.role_id, u.first_name, u.last_name, u.avatar_url,
              r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.nickname`
    )
    .all() as unknown as (UserPublic & { role_name: string | null })[];
  return rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    parent_id: row.parent_id,
    role_id: row.role_id,
    role_name: row.role_name,
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    avatar_url: row.avatar_url ?? null,
  }));
}

export function getRootUser(): UserPublic | undefined {
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_COLS} FROM users WHERE parent_id IS NULL LIMIT 1`
    )
    .get() as UserPublic | undefined;
}

export function getDescendantIds(rootId: number): number[] {
  const users = getAllUsers();
  const ids: number[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const u of users) {
      if (u.parent_id === current && !ids.includes(u.id)) {
        ids.push(u.id);
        queue.push(u.id);
      }
    }
  }
  return ids;
}

export function getSubtreeIds(userId: number): number[] {
  return [userId, ...getDescendantIds(userId)];
}

export function getAssignableUserIds(user: UserPublic): number[] {
  return getSubtreeIds(user.id);
}

export function wouldCreateCycle(userId: number, newParentId: number | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === userId) return true;
  return getDescendantIds(userId).includes(newParentId);
}

export function createUser(data: {
  nickname: string;
  password_hash: string;
  parent_id: number | null;
  role_id?: number | null;
}): UserPublic {
  const result = getDb()
    .prepare(
      "INSERT INTO users (nickname, password_hash, parent_id, role_id) VALUES (?, ?, ?, ?)"
    )
    .run(
      data.nickname,
      data.password_hash,
      data.parent_id,
      data.role_id ?? null
    );
  return getUserPublicById(Number(result.lastInsertRowid))!;
}

export function updateUserParent(id: number, parent_id: number | null): UserPublic | null {
  if (!getUserById(id)) return null;
  getDb().prepare("UPDATE users SET parent_id = ? WHERE id = ?").run(parent_id, id);
  return getUserPublicById(id) ?? null;
}

export function updateUserRole(id: number, role_id: number | null): UserPublic | null {
  if (!getUserById(id)) return null;
  getDb().prepare("UPDATE users SET role_id = ? WHERE id = ?").run(role_id, id);
  return getUserPublicById(id) ?? null;
}

export function updateUserPassword(id: number, password_hash: string): boolean {
  const result = getDb()
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(password_hash, id);
  return result.changes > 0;
}

export function deleteUser(id: number): { ok: boolean; error?: string } {
  const children = getDb()
    .prepare("SELECT COUNT(*) as count FROM users WHERE parent_id = ?")
    .get(id) as { count: number };
  if (children.count > 0) {
    return { ok: false, error: "Сначала удалите или переместите подчинённых" };
  }

  const user = getUserById(id);
  if (user?.parent_id === null) {
    return { ok: false, error: "Нельзя удалить корневого пользователя" };
  }

  const assigned = getDb()
    .prepare("SELECT COUNT(*) as count FROM task_assignees WHERE user_id = ?")
    .get(id) as { count: number };
  if (assigned.count > 0) {
    return { ok: false, error: "Пользователь назначен на задачи" };
  }

  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  return { ok: true };
}

export function getUsersInIds(ids: number[]): UserPublic[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT ${PUBLIC_COLS} FROM users WHERE id IN (${placeholders}) ORDER BY nickname`
    )
    .all(...ids) as unknown as UserPublic[];
}
