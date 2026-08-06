import { getDb, runTransaction } from "../index.js";

export type ReferenceProduct = {
  id: number;
  name: string;
  /** Short label for the finished product. */
  tag: string;
  created_by: number;
  created_at: string;
  updated_at: string;
};

export type ProductLabelKind = "name" | "tag";

/** Product linked to a component with chosen card label. */
export type ReferenceComponentProduct = ReferenceProduct & {
  display_as: ProductLabelKind;
  label: string;
};

export type ComponentProductLink = {
  product_id: number;
  display_as: ProductLabelKind;
};

/** Kit type tag (болт, шуруп, …). */
export type ReferenceTag = {
  id: number;
  name: string;
  created_by: number;
  created_at: string;
  updated_at: string;
};

export type ReferenceComponent = {
  id: number;
  name: string;
  type_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  type: ReferenceTag | null;
  /** Finished products linked to this component (label = name or short tag). */
  products: ReferenceComponentProduct[];
};

const PRODUCT_COLS = `id, name, tag, created_by, created_at, updated_at`;

function mapProduct(row: ReferenceProduct): ReferenceProduct {
  return {
    ...row,
    tag: row.tag?.trim() ? row.tag : row.name,
  };
}

export function listProducts(q = ""): ReferenceProduct[] {
  const query = q.trim();
  if (query) {
    const like = `%${query}%`;
    return (
      getDb()
        .prepare(
          `SELECT ${PRODUCT_COLS}
           FROM reference_products
           WHERE name LIKE ? COLLATE NOCASE
              OR tag LIKE ? COLLATE NOCASE
           ORDER BY name COLLATE NOCASE ASC, id ASC`
        )
        .all(like, like) as ReferenceProduct[]
    ).map(mapProduct);
  }
  return (
    getDb()
      .prepare(
        `SELECT ${PRODUCT_COLS}
         FROM reference_products
         ORDER BY name COLLATE NOCASE ASC, id ASC`
      )
      .all() as ReferenceProduct[]
  ).map(mapProduct);
}

export function getProduct(id: number): ReferenceProduct | null {
  const row = getDb()
    .prepare(`SELECT ${PRODUCT_COLS} FROM reference_products WHERE id = ?`)
    .get(id) as ReferenceProduct | undefined;
  return row ? mapProduct(row) : null;
}

function findProductConflict(
  name: string,
  tag: string,
  excludeId?: number
): "name" | "tag" | null {
  const nameRow = getDb()
    .prepare(
      `SELECT id FROM reference_products WHERE name = ? COLLATE NOCASE${
        excludeId != null ? " AND id != ?" : ""
      }`
    )
    .get(...(excludeId != null ? [name, excludeId] : [name])) as { id: number } | undefined;
  if (nameRow) return "name";

  const tagRow = getDb()
    .prepare(
      `SELECT id FROM reference_products WHERE tag = ? COLLATE NOCASE${
        excludeId != null ? " AND id != ?" : ""
      }`
    )
    .get(...(excludeId != null ? [tag, excludeId] : [tag])) as { id: number } | undefined;
  if (tagRow) return "tag";
  return null;
}

export function createProduct(data: {
  name: string;
  tag: string;
  created_by: number;
}): ReferenceProduct {
  const name = data.name.trim();
  const tag = data.tag.trim();
  const conflict = findProductConflict(name, tag);
  if (conflict === "name") throw new Error("Готовая продукция с таким названием уже есть");
  if (conflict === "tag") throw new Error("Такой короткий тег уже занят");

  const result = getDb()
    .prepare(
      `INSERT INTO reference_products (name, tag, description, created_by) VALUES (?, ?, '', ?)`
    )
    .run(name, tag, data.created_by);
  const item = getProduct(Number(result.lastInsertRowid));
  if (!item) throw new Error("Failed to create product");
  return item;
}

export function updateProduct(
  id: number,
  data: { name: string; tag: string }
): ReferenceProduct | null {
  const name = data.name.trim();
  const tag = data.tag.trim();
  const conflict = findProductConflict(name, tag, id);
  if (conflict === "name") throw new Error("Готовая продукция с таким названием уже есть");
  if (conflict === "tag") throw new Error("Такой короткий тег уже занят");

  const result = getDb()
    .prepare(
      `UPDATE reference_products
       SET name = ?, tag = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(name, tag, id);
  if (result.changes === 0) return null;
  return getProduct(id);
}

export function deleteProduct(id: number): boolean {
  return runTransaction(() => {
    getDb().prepare(`DELETE FROM reference_component_products WHERE product_id = ?`).run(id);
    const result = getDb().prepare(`DELETE FROM reference_products WHERE id = ?`).run(id);
    return result.changes > 0;
  });
}

export function listTags(q = ""): ReferenceTag[] {
  const query = q.trim();
  if (query) {
    const like = `%${query}%`;
    return getDb()
      .prepare(
        `SELECT id, name, created_by, created_at, updated_at
         FROM reference_tags
         WHERE name LIKE ? COLLATE NOCASE
         ORDER BY name COLLATE NOCASE ASC, id ASC`
      )
      .all(like) as ReferenceTag[];
  }
  return getDb()
    .prepare(
      `SELECT id, name, created_by, created_at, updated_at
       FROM reference_tags
       ORDER BY name COLLATE NOCASE ASC, id ASC`
    )
    .all() as ReferenceTag[];
}

export function getTag(id: number): ReferenceTag | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, created_by, created_at, updated_at
       FROM reference_tags WHERE id = ?`
    )
    .get(id) as ReferenceTag | undefined;
  return row ?? null;
}

export function findTagByName(name: string): ReferenceTag | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, created_by, created_at, updated_at
       FROM reference_tags WHERE name = ? COLLATE NOCASE`
    )
    .get(name.trim()) as ReferenceTag | undefined;
  return row ?? null;
}

export function createTag(data: { name: string; created_by: number }): ReferenceTag {
  const existing = findTagByName(data.name);
  if (existing) return existing;
  const result = getDb()
    .prepare(`INSERT INTO reference_tags (name, description, created_by) VALUES (?, '', ?)`)
    .run(data.name.trim(), data.created_by);
  const item = getTag(Number(result.lastInsertRowid));
  if (!item) throw new Error("Failed to create tag");
  return item;
}

export function updateTag(id: number, data: { name: string }): ReferenceTag | null {
  const result = getDb()
    .prepare(
      `UPDATE reference_tags
       SET name = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(data.name.trim(), id);
  if (result.changes === 0) return null;
  return getTag(id);
}

export function listComponentIdsByType(typeId: number): number[] {
  return (
    getDb()
      .prepare(`SELECT id FROM reference_components WHERE type_id = ?`)
      .all(typeId) as { id: number }[]
  ).map((r) => r.id);
}

export function deleteTag(id: number): boolean {
  return runTransaction(() => {
    getDb().prepare(`UPDATE reference_components SET type_id = NULL WHERE type_id = ?`).run(id);
    const result = getDb().prepare(`DELETE FROM reference_tags WHERE id = ?`).run(id);
    return result.changes > 0;
  });
}

function productsForComponent(componentId: number): ReferenceComponentProduct[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.tag, p.created_by, p.created_at, p.updated_at,
              COALESCE(NULLIF(cp.display_as, ''), 'tag') AS display_as
       FROM reference_products p
       INNER JOIN reference_component_products cp ON cp.product_id = p.id
       WHERE cp.component_id = ?
       ORDER BY p.tag COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC`
    )
    .all(componentId) as (ReferenceProduct & { display_as: string })[];

  return rows.map((row) => {
    const product = mapProduct(row);
    const display_as: ProductLabelKind = row.display_as === "name" ? "name" : "tag";
    const label = display_as === "name" ? product.name : product.tag;
    return { ...product, display_as, label };
  });
}

function hydrateComponent(
  row: {
    id: number;
    name: string;
    type_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  }
): ReferenceComponent {
  const type = row.type_id != null ? getTag(row.type_id) : null;
  return {
    ...row,
    type,
    products: productsForComponent(row.id),
  };
}

export function listComponents(q = ""): ReferenceComponent[] {
  const query = q.trim();
  let rows: {
    id: number;
    name: string;
    type_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  }[];
  if (query) {
    const like = `%${query}%`;
    rows = getDb()
      .prepare(
        `SELECT c.id, c.name, c.type_id, c.created_by, c.created_at, c.updated_at
         FROM reference_components c
         LEFT JOIN reference_tags t ON t.id = c.type_id
         WHERE c.name LIKE ? COLLATE NOCASE
            OR t.name LIKE ? COLLATE NOCASE
            OR c.id IN (
              SELECT cp.component_id FROM reference_component_products cp
              INNER JOIN reference_products p ON p.id = cp.product_id
              WHERE p.name LIKE ? COLLATE NOCASE
                 OR p.tag LIKE ? COLLATE NOCASE
            )
         ORDER BY c.name COLLATE NOCASE ASC, c.id ASC`
      )
      .all(like, like, like, like) as typeof rows;
  } else {
    rows = getDb()
      .prepare(
        `SELECT id, name, type_id, created_by, created_at, updated_at
         FROM reference_components
         ORDER BY name COLLATE NOCASE ASC, id ASC`
      )
      .all() as typeof rows;
  }
  return rows.map(hydrateComponent);
}

export function listComponentsByProduct(productId: number): ReferenceComponent[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.type_id, c.created_by, c.created_at, c.updated_at
       FROM reference_components c
       INNER JOIN reference_component_products cp ON cp.component_id = c.id
       WHERE cp.product_id = ?
       ORDER BY c.name COLLATE NOCASE ASC, c.id ASC`
    )
    .all(productId) as {
    id: number;
    name: string;
    type_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map(hydrateComponent);
}

export function getComponent(id: number): ReferenceComponent | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, type_id, created_by, created_at, updated_at
       FROM reference_components WHERE id = ?`
    )
    .get(id) as
    | {
        id: number;
        name: string;
        type_id: number | null;
        created_by: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return hydrateComponent(row);
}

function setComponentProducts(componentId: number, links: ComponentProductLink[]) {
  const db = getDb();
  db.prepare(`DELETE FROM reference_component_products WHERE component_id = ?`).run(componentId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reference_component_products (component_id, product_id, display_as)
     VALUES (?, ?, ?)`
  );
  const seen = new Set<number>();
  for (const link of links) {
    const productId = link.product_id;
    if (!Number.isFinite(productId) || productId <= 0 || seen.has(productId)) continue;
    const displayAs: ProductLabelKind = link.display_as === "name" ? "name" : "tag";
    const exists = db.prepare(`SELECT id FROM reference_products WHERE id = ?`).get(productId);
    if (!exists) continue;
    seen.add(productId);
    insert.run(componentId, productId, displayAs);
  }
}

function resolveTypeId(
  created_by: number,
  type_id?: number | null,
  type_name?: string | null
): number | null {
  if (type_id != null && type_id > 0) {
    return getTag(type_id)?.id ?? null;
  }
  const name = type_name?.trim();
  if (name) {
    return createTag({ name, created_by }).id;
  }
  return null;
}

function normalizeProductLinks(
  product_links?: ComponentProductLink[],
  product_ids?: number[]
): ComponentProductLink[] {
  if (product_links !== undefined) {
    return product_links.map((l) => ({
      product_id: l.product_id,
      display_as: l.display_as === "name" ? "name" : "tag",
    }));
  }
  return (product_ids ?? []).map((product_id) => ({
    product_id,
    display_as: "tag" as const,
  }));
}

export function createComponent(data: {
  name: string;
  created_by: number;
  product_links?: ComponentProductLink[];
  product_ids?: number[];
  type_id?: number | null;
  type_name?: string | null;
}): ReferenceComponent {
  return runTransaction(() => {
    const typeId = resolveTypeId(data.created_by, data.type_id, data.type_name);
    const result = getDb()
      .prepare(
        `INSERT INTO reference_components (name, description, created_by, type_id)
         VALUES (?, '', ?, ?)`
      )
      .run(data.name.trim(), data.created_by, typeId);
    const id = Number(result.lastInsertRowid);
    setComponentProducts(id, normalizeProductLinks(data.product_links, data.product_ids));
    const item = getComponent(id);
    if (!item) throw new Error("Failed to create component");
    return item;
  });
}

export function updateComponent(
  id: number,
  data: {
    name: string;
    product_links?: ComponentProductLink[];
    product_ids?: number[];
    type_id?: number | null;
    type_name?: string | null;
  }
): ReferenceComponent | null {
  return runTransaction(() => {
    const existing = getComponent(id);
    if (!existing) return null;

    let typeId = existing.type_id;
    if (data.type_id !== undefined || data.type_name !== undefined) {
      typeId = resolveTypeId(existing.created_by, data.type_id, data.type_name);
    }

    getDb()
      .prepare(
        `UPDATE reference_components
         SET name = ?, type_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(data.name.trim(), typeId, id);

    if (data.product_links !== undefined || data.product_ids !== undefined) {
      setComponentProducts(id, normalizeProductLinks(data.product_links, data.product_ids));
    }
    return getComponent(id);
  });
}

export function deleteComponent(id: number): boolean {
  return runTransaction(() => {
    getDb().prepare(`DELETE FROM reference_component_products WHERE component_id = ?`).run(id);
    const result = getDb().prepare(`DELETE FROM reference_components WHERE id = ?`).run(id);
    return result.changes > 0;
  });
}
