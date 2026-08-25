import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DatabaseSync } from "node:sqlite";

export type Role = "admin" | "user";

export type AuthUser = {
  id: number;
  login: string;
  role: Role;
  permissions: string[];
  canEditMap: boolean;
  canEditShelves: boolean;
  requireShelfConfirm: boolean;
  /** Корневой админ TaskMaster (parent_id = null). */
  isRoot: boolean;
};

type SharedUserRow = {
  id: number;
  nickname: string;
  parent_id: number | null;
  role_id: number | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_SESSION_COOKIE = "session";

let sharedEnvCache: Record<string, string> | null = null;
let sharedUsersDb: DatabaseSync | null = null;

function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function readDotEnv(filePath: string) {
  const out: Record<string, string> = {};
  if (!existsSync(filePath)) return out;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getSharedEnv() {
  if (sharedEnvCache) return sharedEnvCache;
  const envPath = resolve(__dirname, "../../backend/.env");
  sharedEnvCache = readDotEnv(envPath);
  return sharedEnvCache;
}

function getSessionSecret() {
  const secret =
    process.env.TASKMASTER_SESSION_SECRET ??
    process.env.SESSION_SECRET ??
    getSharedEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error("TaskMaster SESSION_SECRET is not available for stockmap auth");
  }
  return secret;
}

function getUsersDb() {
  if (sharedUsersDb) return sharedUsersDb;
  const dbPath =
    process.env.TASKMASTER_DB_PATH ??
    getSharedEnv().DB_PATH ??
    resolve(__dirname, "../../backend/data/app.db");
  sharedUsersDb = new DatabaseSync(resolve(dbPath), { readOnly: true });
  return sharedUsersDb;
}

/** Shared TaskMaster DB (users + reference catalog). */
export function getSharedUsersDb() {
  return getUsersDb();
}

function parseMainSessionToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;

    const payload = decoded.slice(0, lastDot);
    const signature = decoded.slice(lastDot + 1);
    const expected = createHmac("sha256", getSessionSecret())
      .update(payload)
      .digest("hex");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(payload) as { userId?: number; exp?: number };
    if (!Number.isInteger(data.userId) || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data.userId;
  } catch {
    return null;
  }
}

function loadPermissions(user: SharedUserRow): string[] {
  if (user.parent_id === null) {
    return [
      "stockmap.view",
      "stockmap.edit_map",
      "stockmap.edit_shelves",
      "app.stockmap",
    ];
  }
  if (user.role_id == null) return [];
  try {
    const rows = getUsersDb()
      .prepare(`SELECT permission FROM role_permissions WHERE role_id = ?`)
      .all(user.role_id) as { permission: string }[];
    return rows.map((r) => r.permission);
  } catch {
    return [];
  }
}

function toAuthUser(user: SharedUserRow): AuthUser | null {
  const permissions = loadPermissions(user);
  const isRootUser = user.parent_id === null;
  const canView =
    isRootUser ||
    permissions.includes("stockmap.view") ||
    permissions.includes("app.stockmap");
  if (!canView) return null;

  const canEditMap = isRootUser || permissions.includes("stockmap.edit_map");
  const canEditShelves =
    isRootUser || permissions.includes("stockmap.edit_shelves");
  const requireShelfConfirm =
    !isRootUser && permissions.includes("stockmap.require_shelf_confirm");

  return {
    id: user.id,
    login: user.nickname,
    role: canEditMap ? "admin" : "user",
    permissions,
    canEditMap,
    canEditShelves,
    requireShelfConfirm,
    isRoot: isRootUser,
  };
}

function loadUser(request: FastifyRequest): AuthUser | null {
  const token = parseCookies(request.headers.cookie)[MAIN_SESSION_COOKIE];
  if (!token) return null;

  const userId = parseMainSessionToken(token);
  if (!userId) return null;

  let row: SharedUserRow | undefined;
  try {
    row = getUsersDb()
      .prepare(
        "SELECT id, nickname, parent_id, role_id FROM users WHERE id = ?"
      )
      .get(userId) as SharedUserRow | undefined;
  } catch {
    // Older DBs before role_id migration
    row = getUsersDb()
      .prepare("SELECT id, nickname, parent_id FROM users WHERE id = ?")
      .get(userId) as SharedUserRow | undefined;
    if (row) row.role_id = null;
  }

  return row ? toAuthUser(row) : null;
}

function clearMainSessionCookie(reply: FastifyReply) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${MAIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function setupAuth(app: FastifyInstance, _db: DatabaseSync) {
  app.addHook("preHandler", async (request) => {
    request.user = loadUser(request) ?? undefined;
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Не авторизован" });
    }
    return request.user;
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearMainSessionCookie(reply);
    return reply.code(204).send();
  });
}

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthUser | null {
  if (!request.user) {
    reply.code(401).send({ error: "Войдите в TaskMaster" });
    return null;
  }
  return request.user;
}

export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthUser | null {
  const user = requireAuth(request, reply);
  if (!user) return null;
  if (!user.canEditMap) {
    reply.code(403).send({ error: "Недостаточно прав для изменения карты" });
    return null;
  }
  return user;
}
