import { getDb, runTransaction } from "../index.js";

export type FeedbackKind = "problem" | "improvement";

export type FeedbackAuthor = {
  id: number;
  nickname: string;
  first_name: string;
  last_name: string;
};

export type FeedbackItem = {
  id: number;
  kind: FeedbackKind;
  title: string;
  description: string;
  sort_order: number;
  admin_done: boolean;
  admin_comment: string;
};

export type FeedbackBatch = {
  id: number;
  author: FeedbackAuthor;
  author_id: number;
  created_at: string;
  updated_at: string;
  items: FeedbackItem[];
};

export type FeedbackItemInput = {
  kind: FeedbackKind;
  title: string;
  description: string;
};

export type FeedbackItemReviewInput = {
  id: number;
  admin_done: boolean;
  admin_comment: string;
};

function mapAuthor(row: {
  author_id: number;
  nickname: string | null;
  first_name: string | null;
  last_name: string | null;
}): FeedbackAuthor {
  return {
    id: row.author_id,
    nickname: row.nickname ?? "—",
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
  };
}

function loadItems(batchId: number): FeedbackItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, kind, title, description, sort_order,
              COALESCE(admin_done, 0) AS admin_done,
              COALESCE(admin_comment, '') AS admin_comment
       FROM feedback_items
       WHERE batch_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(batchId) as Array<{
    id: number;
    kind: FeedbackKind;
    title: string;
    description: string;
    sort_order: number;
    admin_done: number;
    admin_comment: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    sort_order: row.sort_order,
    admin_done: Boolean(row.admin_done),
    admin_comment: row.admin_comment ?? "",
  }));
}

function mapBatch(row: {
  id: number;
  author_id: number;
  created_at: string;
  updated_at: string;
  nickname: string | null;
  first_name: string | null;
  last_name: string | null;
}): FeedbackBatch {
  return {
    id: row.id,
    author_id: row.author_id,
    author: mapAuthor(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: loadItems(row.id),
  };
}

const batchSelect = `
  SELECT
    b.id,
    b.author_id,
    b.created_at,
    b.updated_at,
    u.nickname,
    u.first_name,
    u.last_name
  FROM feedback_batches b
  LEFT JOIN users u ON u.id = b.author_id
`;

export function listFeedbackBatches(authorId?: number): FeedbackBatch[] {
  const rows =
    authorId != null
      ? (getDb()
          .prepare(
            `${batchSelect}
             WHERE b.author_id = ?
             ORDER BY b.created_at DESC, b.id DESC`
          )
          .all(authorId) as Array<{
          id: number;
          author_id: number;
          created_at: string;
          updated_at: string;
          nickname: string | null;
          first_name: string | null;
          last_name: string | null;
        }>)
      : (getDb()
          .prepare(
            `${batchSelect}
             ORDER BY b.created_at DESC, b.id DESC`
          )
          .all() as Array<{
          id: number;
          author_id: number;
          created_at: string;
          updated_at: string;
          nickname: string | null;
          first_name: string | null;
          last_name: string | null;
        }>);

  return rows.map(mapBatch);
}

export function getFeedbackBatch(id: number): FeedbackBatch | null {
  const row = getDb()
    .prepare(`${batchSelect} WHERE b.id = ?`)
    .get(id) as
    | {
        id: number;
        author_id: number;
        created_at: string;
        updated_at: string;
        nickname: string | null;
        first_name: string | null;
        last_name: string | null;
      }
    | undefined;
  if (!row) return null;
  return mapBatch(row);
}

export function createFeedbackBatch(
  authorId: number,
  items: FeedbackItemInput[]
): FeedbackBatch {
  const db = getDb();
  const insertBatch = db.prepare(
    `INSERT INTO feedback_batches (author_id) VALUES (?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO feedback_items (batch_id, kind, title, description, sort_order, admin_done, admin_comment)
     VALUES (?, ?, ?, ?, ?, 0, '')`
  );

  const batchId = runTransaction(() => {
    const result = insertBatch.run(authorId);
    const id = Number(result.lastInsertRowid);
    items.forEach((item, index) => {
      insertItem.run(id, item.kind, item.title, item.description, index);
    });
    return id;
  });

  const batch = getFeedbackBatch(batchId);
  if (!batch) throw new Error("Не удалось создать обращение");
  return batch;
}

export function replaceFeedbackBatchItems(
  batchId: number,
  items: FeedbackItemInput[]
): FeedbackBatch | null {
  const existing = getFeedbackBatch(batchId);
  if (!existing) return null;

  const previous = existing.items;
  const db = getDb();
  const deleteItems = db.prepare(
    `DELETE FROM feedback_items WHERE batch_id = ?`
  );
  const insertItem = db.prepare(
    `INSERT INTO feedback_items (batch_id, kind, title, description, sort_order, admin_done, admin_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const touch = db.prepare(
    `UPDATE feedback_batches SET updated_at = datetime('now') WHERE id = ?`
  );

  runTransaction(() => {
    deleteItems.run(batchId);
    items.forEach((item, index) => {
      const prev = previous[index];
      insertItem.run(
        batchId,
        item.kind,
        item.title,
        item.description,
        index,
        prev?.admin_done ? 1 : 0,
        prev?.admin_comment ?? ""
      );
    });
    touch.run(batchId);
  });

  return getFeedbackBatch(batchId);
}

/** Admin review for items inside a batch (done flag + comment). */
export function updateFeedbackItemReviews(
  batchId: number,
  reviews: FeedbackItemReviewInput[]
): FeedbackBatch | null {
  const existing = getFeedbackBatch(batchId);
  if (!existing) return null;

  const byId = new Map(existing.items.map((item) => [item.id, item]));
  for (const review of reviews) {
    if (!byId.has(review.id)) return null;
  }

  const db = getDb();
  const updateItem = db.prepare(
    `UPDATE feedback_items
     SET admin_done = ?, admin_comment = ?
     WHERE id = ? AND batch_id = ?`
  );
  const touch = db.prepare(
    `UPDATE feedback_batches SET updated_at = datetime('now') WHERE id = ?`
  );

  runTransaction(() => {
    for (const review of reviews) {
      updateItem.run(
        review.admin_done ? 1 : 0,
        review.admin_comment,
        review.id,
        batchId
      );
    }
    touch.run(batchId);
  });

  return getFeedbackBatch(batchId);
}

export function deleteFeedbackBatch(id: number): boolean {
  const result = getDb()
    .prepare(`DELETE FROM feedback_batches WHERE id = ?`)
    .run(id);
  return Number(result.changes) > 0;
}
