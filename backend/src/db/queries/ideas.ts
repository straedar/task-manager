import { getDb } from "../index.js";
import type {
  IdeaPrivacy,
  IdeaStatus,
  IdeaTag,
  IdeaWithCreator,
  UserPublic,
} from "../../types.js";

function mapUser(row: { id: number; nickname: string; parent_id: number | null }): UserPublic {
  return { id: row.id, nickname: row.nickname, parent_id: row.parent_id, role_id: null };
}

function enrichIdea(row: {
  id: number;
  title: string;
  description: string;
  tag: string;
  due_at: string | null;
  privacy: string;
  status: string;
  created_by: number;
  created_at: string;
  completed_at: string | null;
}): IdeaWithCreator {
  const creator = mapUser(
    getDb()
      .prepare("SELECT id, nickname, parent_id FROM users WHERE id = ?")
      .get(row.created_by) as unknown as UserPublic
  );

  return {
    ...row,
    tag: row.tag as IdeaTag,
    privacy: row.privacy as IdeaPrivacy,
    status: row.status as IdeaStatus,
    creator,
  };
}

export function getVisibleIdeas(userId: number): IdeaWithCreator[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ideas
       WHERE privacy = 'public' OR created_by = ?
       ORDER BY created_at DESC`
    )
    .all(userId) as Parameters<typeof enrichIdea>[0][];
  return rows.map(enrichIdea);
}

export function getIdeaById(id: number): IdeaWithCreator | undefined {
  const row = getDb()
    .prepare("SELECT * FROM ideas WHERE id = ?")
    .get(id) as Parameters<typeof enrichIdea>[0] | undefined;
  return row ? enrichIdea(row) : undefined;
}

export function createIdea(data: {
  title: string;
  description: string;
  tag: IdeaTag;
  due_at: string | null;
  privacy: IdeaPrivacy;
  created_by: number;
}): IdeaWithCreator {
  const result = getDb()
    .prepare(
      `INSERT INTO ideas (title, description, tag, due_at, privacy, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(
      data.title,
      data.description,
      data.tag,
      data.due_at,
      data.privacy,
      data.created_by
    );

  return getIdeaById(Number(result.lastInsertRowid))!;
}

export function updateIdea(
  id: number,
  data: {
    title: string;
    description: string;
    tag: IdeaTag;
    due_at: string | null;
    privacy: IdeaPrivacy;
  }
): IdeaWithCreator | null {
  if (!getIdeaById(id)) return null;
  getDb()
    .prepare(
      `UPDATE ideas
       SET title = ?, description = ?, tag = ?, due_at = ?, privacy = ?
       WHERE id = ?`
    )
    .run(data.title, data.description, data.tag, data.due_at, data.privacy, id);
  return getIdeaById(id) ?? null;
}

export function completeIdea(id: number): IdeaWithCreator | null {
  const idea = getIdeaById(id);
  if (!idea || idea.status !== "open") return null;
  getDb()
    .prepare(
      `UPDATE ideas SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    )
    .run(id);
  return getIdeaById(id) ?? null;
}

export function deleteIdea(id: number): boolean {
  if (!getIdeaById(id)) return false;
  getDb().prepare("DELETE FROM ideas WHERE id = ?").run(id);
  return true;
}
