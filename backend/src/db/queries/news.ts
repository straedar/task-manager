import { getDb } from "../index.js";
import { htmlToExcerpt } from "../../utils/sanitizeHtml.js";

type AuthorRow = { id: number; nickname: string; parent_id: number | null };

export type NewsChannel = "company" | "warehouse" | "patch";

export type NewsAuthor = {
  id: number;
  nickname: string;
};

export type NewsPostListItem = {
  id: number;
  title: string;
  excerpt: string;
  channel: NewsChannel;
  author: NewsAuthor;
  created_at: string;
  updated_at: string;
  readers_count: number;
  read_by_me: boolean;
};

export type NewsReader = {
  id: number;
  nickname: string;
  read_at: string;
};

export type NewsPostDetail = {
  id: number;
  title: string;
  body_html: string;
  channel: NewsChannel;
  author: NewsAuthor;
  author_id: number;
  created_at: string;
  updated_at: string;
  readers: NewsReader[];
  readers_count: number;
  read_by_me: boolean;
};

function mapAuthor(row: AuthorRow | undefined): NewsAuthor {
  if (!row) return { id: 0, nickname: "—" };
  return { id: row.id, nickname: row.nickname };
}

function normalizeChannel(value: string | null | undefined): NewsChannel {
  if (value === "warehouse" || value === "patch" || value === "company") return value;
  return "company";
}

export function listNewsPosts(
  viewerId: number,
  channel: NewsChannel
): NewsPostListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT
         p.id,
         p.title,
         p.body_html,
         p.channel,
         p.author_id,
         p.created_at,
         p.updated_at,
         u.id AS uid,
         u.nickname,
         u.parent_id,
         (SELECT COUNT(*) FROM news_reads r WHERE r.post_id = p.id) AS readers_count,
         EXISTS(
           SELECT 1 FROM news_reads r2
           WHERE r2.post_id = p.id AND r2.user_id = ?
         ) AS read_by_me
       FROM news_posts p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.channel = ?
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(viewerId, channel) as Array<{
    id: number;
    title: string;
    body_html: string;
    channel: string;
    author_id: number;
    created_at: string;
    updated_at: string;
    uid: number | null;
    nickname: string | null;
    parent_id: number | null;
    readers_count: number;
    read_by_me: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    excerpt: htmlToExcerpt(row.body_html),
    channel: normalizeChannel(row.channel),
    author: mapAuthor(
      row.uid != null
        ? { id: row.uid, nickname: row.nickname ?? "—", parent_id: row.parent_id }
        : undefined
    ),
    created_at: row.created_at,
    updated_at: row.updated_at,
    readers_count: Number(row.readers_count) || 0,
    read_by_me: Boolean(row.read_by_me),
  }));
}

export function getNewsPost(id: number): {
  id: number;
  title: string;
  body_html: string;
  channel: NewsChannel;
  author_id: number;
  created_at: string;
  updated_at: string;
} | null {
  const row = getDb()
    .prepare(
      `SELECT id, title, body_html, channel, author_id, created_at, updated_at
       FROM news_posts WHERE id = ?`
    )
    .get(id) as
    | {
        id: number;
        title: string;
        body_html: string;
        channel: string;
        author_id: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return { ...row, channel: normalizeChannel(row.channel) };
}

export function listNewsReaders(postId: number): NewsReader[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.nickname, r.read_at
       FROM news_reads r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ?
       ORDER BY r.read_at ASC, u.nickname COLLATE NOCASE ASC`
    )
    .all(postId) as NewsReader[];
}

export function markNewsRead(postId: number, userId: number): void {
  getDb()
    .prepare(
      `INSERT INTO news_reads (post_id, user_id, read_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(post_id, user_id) DO NOTHING`
    )
    .run(postId, userId);
}

export function getNewsPostDetail(
  id: number,
  viewerId: number
): NewsPostDetail | null {
  const post = getNewsPost(id);
  if (!post) return null;

  const authorRow = getDb()
    .prepare(`SELECT id, nickname, parent_id FROM users WHERE id = ?`)
    .get(post.author_id) as AuthorRow | undefined;

  const readers = listNewsReaders(id);
  return {
    id: post.id,
    title: post.title,
    body_html: post.body_html,
    channel: post.channel,
    author: mapAuthor(authorRow),
    author_id: post.author_id,
    created_at: post.created_at,
    updated_at: post.updated_at,
    readers,
    readers_count: readers.length,
    read_by_me: readers.some((r) => r.id === viewerId),
  };
}

export function createNewsPost(data: {
  title: string;
  body_html: string;
  author_id: number;
  channel: NewsChannel;
}): NewsPostDetail {
  const result = getDb()
    .prepare(
      `INSERT INTO news_posts (title, body_html, author_id, channel)
       VALUES (?, ?, ?, ?)`
    )
    .run(data.title, data.body_html, data.author_id, data.channel);

  const id = Number(result.lastInsertRowid);
  markNewsRead(id, data.author_id);
  const detail = getNewsPostDetail(id, data.author_id);
  if (!detail) throw new Error("Не удалось создать новость");
  return detail;
}

export function updateNewsPost(
  id: number,
  data: { title: string; body_html: string }
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE news_posts
       SET title = ?, body_html = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(data.title, data.body_html, id);
  return result.changes > 0;
}

export function deleteNewsPost(id: number): boolean {
  const result = getDb().prepare(`DELETE FROM news_posts WHERE id = ?`).run(id);
  return result.changes > 0;
}
