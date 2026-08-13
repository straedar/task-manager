import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../index.js";

const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePlainCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/** Create a one-time restore code for a user. Invalidates previous unused codes. */
export function createPasswordRestoreCode(
  userId: number,
  createdBy: number
): { code: string; expires_at: string } {
  const db = getDb();
  db.prepare(
    `UPDATE password_restore_codes
     SET used_at = datetime('now')
     WHERE user_id = ? AND used_at IS NULL`
  ).run(userId);

  const code = generatePlainCode(8);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO password_restore_codes (user_id, code_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?)`
  ).run(userId, bcrypt.hashSync(code, 10), expiresAt, createdBy);

  return { code, expires_at: expiresAt };
}

export type RedeemResult =
  | { ok: true; user_id: number }
  | { ok: false; error: string };

/** Redeem nickname + restore code; caller updates password after success. */
export function redeemPasswordRestoreCode(
  nickname: string,
  code: string
): RedeemResult {
  const db = getDb();
  const user = db
    .prepare(`SELECT id FROM users WHERE nickname = ? COLLATE NOCASE`)
    .get(nickname.trim()) as { id: number } | undefined;
  if (!user) return { ok: false, error: "Неверный никнейм или код" };

  const rows = db
    .prepare(
      `SELECT id, code_hash, expires_at
       FROM password_restore_codes
       WHERE user_id = ? AND used_at IS NULL
       ORDER BY id DESC
       LIMIT 5`
    )
    .all(user.id) as { id: number; code_hash: string; expires_at: string }[];

  const now = Date.now();
  const normalized = code.trim().toUpperCase();
  for (const row of rows) {
    const exp = Date.parse(row.expires_at);
    if (!Number.isFinite(exp) || exp < now) continue;
    if (!bcrypt.compareSync(normalized, row.code_hash)) continue;

    db.prepare(
      `UPDATE password_restore_codes SET used_at = datetime('now') WHERE id = ?`
    ).run(row.id);
    return { ok: true, user_id: user.id };
  }

  return { ok: false, error: "Неверный никнейм или код" };
}
