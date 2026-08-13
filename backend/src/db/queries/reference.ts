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

/** Product linked to a component with chosen card label and BOM quantity. */
export type ReferenceComponentProduct = ReferenceProduct & {
  display_as: ProductLabelKind;
  label: string;
  quantity: number;
};

export type ComponentProductLink = {
  product_id: number;
  display_as: ProductLabelKind;
  quantity?: number;
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
  /** BOM quantity when listed under a specific product. */
  quantity?: number;
};

export type ProductBomItem = {
  component_id: number;
  quantity: number;
  display_as?: ProductLabelKind;
};

const PRODUCT_COLS = `id, name, tag, created_by, created_at, updated_at`;

function mapProduct(row: ReferenceProduct): ReferenceProduct {
  return {
    ...row,
    tag: row.tag?.trim() ? row.tag : row.name,
  };
}

function clampQuantity(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(99999, Math.round(value)));
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
              COALESCE(NULLIF(cp.display_as, ''), 'tag') AS display_as,
              COALESCE(cp.quantity, 1) AS quantity
       FROM reference_products p
       INNER JOIN reference_component_products cp ON cp.product_id = p.id
       WHERE cp.component_id = ?
       ORDER BY p.tag COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC`
    )
    .all(componentId) as (ReferenceProduct & { display_as: string; quantity: number })[];

  return rows.map((row) => {
    const product = mapProduct(row);
    const display_as: ProductLabelKind = row.display_as === "name" ? "name" : "tag";
    const label = display_as === "name" ? product.name : product.tag;
    return { ...product, display_as, label, quantity: clampQuantity(row.quantity) };
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
  },
  bomQuantity?: number
): ReferenceComponent {
  const type = row.type_id != null ? getTag(row.type_id) : null;
  return {
    ...row,
    type,
    products: productsForComponent(row.id),
    ...(bomQuantity != null ? { quantity: clampQuantity(bomQuantity) } : {}),
  };
}

export type ListComponentsFilters = {
  q?: string;
  type_id?: number | null;
  product_id?: number | null;
};

export function listComponents(filters: ListComponentsFilters | string = {}): ReferenceComponent[] {
  const opts: ListComponentsFilters =
    typeof filters === "string" ? { q: filters } : filters ?? {};
  const query = (opts.q ?? "").trim();
  const typeId =
    opts.type_id != null && Number.isFinite(opts.type_id) && opts.type_id > 0
      ? opts.type_id
      : null;
  const productId =
    opts.product_id != null && Number.isFinite(opts.product_id) && opts.product_id > 0
      ? opts.product_id
      : null;

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (query) {
    const like = `%${query}%`;
    where.push(`(
      c.name LIKE ? COLLATE NOCASE
      OR t.name LIKE ? COLLATE NOCASE
      OR c.id IN (
        SELECT cp.component_id FROM reference_component_products cp
        INNER JOIN reference_products p ON p.id = cp.product_id
        WHERE p.name LIKE ? COLLATE NOCASE
           OR p.tag LIKE ? COLLATE NOCASE
      )
    )`);
    params.push(like, like, like, like);
  }
  if (typeId != null) {
    where.push(`c.type_id = ?`);
    params.push(typeId);
  }
  if (productId != null) {
    where.push(`c.id IN (
      SELECT cp.component_id FROM reference_component_products cp WHERE cp.product_id = ?
    )`);
    params.push(productId);
  }

  const sql = `
    SELECT c.id, c.name, c.type_id, c.created_by, c.created_at, c.updated_at
    FROM reference_components c
    LEFT JOIN reference_tags t ON t.id = c.type_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.name COLLATE NOCASE ASC, c.id ASC
  `;

  const rows = getDb().prepare(sql).all(...params) as {
    id: number;
    name: string;
    type_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map((row) => hydrateComponent(row));
}

export function listComponentsByProduct(productId: number): ReferenceComponent[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.type_id, c.created_by, c.created_at, c.updated_at,
              COALESCE(cp.quantity, 1) AS quantity
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
    quantity: number;
  }[];
  return rows.map((row) =>
    hydrateComponent(row, row.quantity)
  );
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
    `INSERT OR IGNORE INTO reference_component_products (component_id, product_id, display_as, quantity)
     VALUES (?, ?, ?, ?)`
  );
  const seen = new Set<number>();
  for (const link of links) {
    const productId = link.product_id;
    if (!Number.isFinite(productId) || productId <= 0 || seen.has(productId)) continue;
    const displayAs: ProductLabelKind = link.display_as === "name" ? "name" : "tag";
    const exists = db.prepare(`SELECT id FROM reference_products WHERE id = ?`).get(productId);
    if (!exists) continue;
    seen.add(productId);
    insert.run(componentId, productId, displayAs, clampQuantity(link.quantity));
  }
}

/** Replace full BOM for a finished product (keeps display_as when re-linking same component). */
export function setProductComponents(
  productId: number,
  items: ProductBomItem[]
): ReferenceComponent[] | null {
  if (!getProduct(productId)) return null;

  return runTransaction(() => {
    const db = getDb();
    const prevRows = db
      .prepare(
        `SELECT component_id, display_as FROM reference_component_products WHERE product_id = ?`
      )
      .all(productId) as { component_id: number; display_as: string }[];
    const prevDisplay = new Map(
      prevRows.map((r) => [
        r.component_id,
        (r.display_as === "name" ? "name" : "tag") as ProductLabelKind,
      ])
    );

    db.prepare(`DELETE FROM reference_component_products WHERE product_id = ?`).run(productId);
    const insert = db.prepare(
      `INSERT INTO reference_component_products (component_id, product_id, display_as, quantity)
       VALUES (?, ?, ?, ?)`
    );
    const seen = new Set<number>();
    for (const item of items) {
      const componentId = item.component_id;
      if (!Number.isFinite(componentId) || componentId <= 0 || seen.has(componentId)) continue;
      const exists = db
        .prepare(`SELECT id FROM reference_components WHERE id = ?`)
        .get(componentId);
      if (!exists) continue;
      seen.add(componentId);
      const displayAs: ProductLabelKind =
        item.display_as === "name" || item.display_as === "tag"
          ? item.display_as
          : prevDisplay.get(componentId) ?? "tag";
      insert.run(componentId, productId, displayAs, clampQuantity(item.quantity));
    }

    db.prepare(
      `UPDATE reference_products SET updated_at = datetime('now') WHERE id = ?`
    ).run(productId);

    return listComponentsByProduct(productId);
  });
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
      quantity: clampQuantity(l.quantity),
    }));
  }
  return (product_ids ?? []).map((product_id) => ({
    product_id,
    display_as: "tag" as const,
    quantity: 1,
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
