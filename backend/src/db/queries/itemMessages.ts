import { getDb } from "../index.js";

export type MessageKind = "task" | "checklist";

export type ItemMessage = {
  id: number;
  kind: MessageKind;
  ref_id: number;
  user_id: number;
  body: string;
  created_at: string;
  author_nickname: string;
};

export type ChatIndicator = {
  message_count: number;
  has_unread: boolean;
};

export function listMessages(kind: MessageKind, refId: number): ItemMessage[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.kind, m.ref_id, m.user_id, m.body, m.created_at,
              u.nickname AS author_nickname
       FROM item_messages m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.kind = ? AND m.ref_id = ?
       ORDER BY m.id ASC`
    )
    .all(kind, refId) as ItemMessage[];
}

export function createMessage(
  kind: MessageKind,
  refId: number,
  userId: number,
  body: string
): ItemMessage {
  const result = getDb()
    .prepare(
      `INSERT INTO item_messages (kind, ref_id, user_id, body)
       VALUES (?, ?, ?, ?)`
    )
    .run(kind, refId, userId, body);

  const row = getDb()
    .prepare(
      `SELECT m.id, m.kind, m.ref_id, m.user_id, m.body, m.created_at,
              u.nickname AS author_nickname
       FROM item_messages m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as ItemMessage | undefined;

  if (!row) throw new Error("Failed to create message");
  markThreadRead(kind, refId, userId, row.id);
  return row;
}

export function getLastMessageId(kind: MessageKind, refId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(id), 0) AS last_id
       FROM item_messages WHERE kind = ? AND ref_id = ?`
    )
    .get(kind, refId) as { last_id: number };
  return Number(row.last_id) || 0;
}

export function markThreadRead(
  kind: MessageKind,
  refId: number,
  userId: number,
  lastMessageId?: number
): void {
  const lastId =
    lastMessageId != null ? lastMessageId : getLastMessageId(kind, refId);
  getDb()
    .prepare(
      `INSERT INTO item_message_reads (user_id, kind, ref_id, last_read_message_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, kind, ref_id) DO UPDATE SET
         last_read_message_id = CASE
           WHEN excluded.last_read_message_id > item_message_reads.last_read_message_id
           THEN excluded.last_read_message_id
           ELSE item_message_reads.last_read_message_id
         END`
    )
    .run(userId, kind, refId, lastId);
}

export function getChatIndicator(
  kind: MessageKind,
  refId: number,
  userId: number
): ChatIndicator {
  const map = getChatIndicators(kind, [refId], userId);
  return map.get(refId) ?? { message_count: 0, has_unread: false };
}

export function getChatIndicators(
  kind: MessageKind,
  refIds: number[],
  userId: number
): Map<number, ChatIndicator> {
  const result = new Map<number, ChatIndicator>();
  for (const id of refIds) {
    result.set(id, { message_count: 0, has_unread: false });
  }
  if (refIds.length === 0) return result;

  const placeholders = refIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT m.ref_id AS ref_id,
              COUNT(*) AS message_count,
              MAX(m.id) AS last_id,
              COALESCE(r.last_read_message_id, 0) AS last_read
       FROM item_messages m
       LEFT JOIN item_message_reads r
         ON r.user_id = ? AND r.kind = m.kind AND r.ref_id = m.ref_id
       WHERE m.kind = ? AND m.ref_id IN (${placeholders})
       GROUP BY m.ref_id`
    )
    .all(userId, kind, ...refIds) as {
    ref_id: number;
    message_count: number;
    last_id: number;
    last_read: number;
  }[];

  for (const row of rows) {
    const count = Number(row.message_count) || 0;
    const lastId = Number(row.last_id) || 0;
    const lastRead = Number(row.last_read) || 0;
    result.set(row.ref_id, {
      message_count: count,
      has_unread: count > 0 && lastId > lastRead,
    });
  }
  return result;
}

export function withChat<T extends { id: number }>(
  kind: MessageKind,
  items: T[],
  userId: number
): (T & { chat: ChatIndicator })[] {
  const map = getChatIndicators(
    kind,
    items.map((i) => i.id),
    userId
  );
  return items.map((item) => ({
    ...item,
    chat: map.get(item.id) ?? { message_count: 0, has_unread: false },
  }));
}
