import type { DatabaseSync } from "node:sqlite";
import { getSharedUsersDb } from "./auth.ts";

export type CatalogKind = "component" | "product";

/** Resolve matching catalog ids from TaskMaster app.db for warehouse search. */
export function findCatalogMatches(q: string): {
  componentIds: number[];
  productIds: number[];
} {
  const query = q.trim();
  if (!query) return { componentIds: [], productIds: [] };
  const like = `%${query}%`;

  let db: DatabaseSync;
  try {
    db = getSharedUsersDb();
  } catch {
    return { componentIds: [], productIds: [] };
  }

  try {
    const componentIds = (
      db
        .prepare(
          `SELECT c.id AS id
           FROM reference_components c
           LEFT JOIN reference_tags t ON t.id = c.type_id
           WHERE c.name LIKE ? COLLATE NOCASE
              OR t.name LIKE ? COLLATE NOCASE
           ORDER BY c.id ASC
           LIMIT 200`,
        )
        .all(like, like) as { id: number }[]
    ).map((r) => r.id);

    const productIds = (
      db
        .prepare(
          `SELECT id FROM reference_products
           WHERE name LIKE ? COLLATE NOCASE
              OR tag LIKE ? COLLATE NOCASE
           ORDER BY id ASC
           LIMIT 200`,
        )
        .all(like, like) as { id: number }[]
    ).map((r) => r.id);

    return { componentIds, productIds };
  } catch {
    return { componentIds: [], productIds: [] };
  }
}
