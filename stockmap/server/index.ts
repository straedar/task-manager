import Fastify from "fastify";
import cors from "@fastify/cors";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth, setupAuth } from "./auth.ts";
import { findCatalogMatches } from "./catalog.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "stockmap.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS map_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const floorDir = join(dataDir, "floor");
mkdirSync(floorDir, { recursive: true });
const floorFilePath = join(floorDir, "cover");

function getMapSetting(key: string, fallback = ""): string {
  const row = db
    .prepare(`SELECT value FROM map_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function setMapSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO map_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS map_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('rack', 'wall', 'door', 'table', 'chair')),
    label TEXT NOT NULL DEFAULT '',
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    shelves_count INTEGER,
    rotation REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const objectColumns = db.prepare(`PRAGMA table_info(map_objects)`).all() as {
  name: string;
}[];
if (!objectColumns.some((c) => c.name === "rotation")) {
  db.exec(
    `ALTER TABLE map_objects ADD COLUMN rotation REAL NOT NULL DEFAULT 0`,
  );
}
if (!objectColumns.some((c) => c.name === "frame_width")) {
  db.exec(`ALTER TABLE map_objects ADD COLUMN frame_width REAL`);
}
if (!objectColumns.some((c) => c.name === "rack_theme")) {
  db.exec(
    `ALTER TABLE map_objects ADD COLUMN rack_theme TEXT NOT NULL DEFAULT 'blue'`,
  );
}
db.prepare(
  `UPDATE map_objects SET rack_theme = 'black' WHERE type = 'rack' AND rack_theme = 'orange'`,
).run();

// Расширить CHECK type: pallet / zone / window
{
  const createSql = (
    db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'map_objects'`,
      )
      .get() as { sql: string } | undefined
  )?.sql;

  let windowTypeAllowed = false;
  try {
    const probe = db.prepare(`
      INSERT INTO map_objects (
        type, label, x, y, width, height, shelves_count, rotation, frame_width, rack_theme
      ) VALUES ('window', '__type_probe__', -99999, -99999, 40, 24, NULL, 0, NULL, 'blue')
    `);
    probe.run();
    db.prepare(`DELETE FROM map_objects WHERE label = '__type_probe__'`).run();
    windowTypeAllowed = true;
  } catch {
    windowTypeAllowed = false;
  }

  const needsTypeExpand =
    !windowTypeAllowed ||
    (!!createSql &&
      (!createSql.includes("'pallet'") ||
        !createSql.includes("'zone'") ||
        !createSql.includes("'window'")));

  if (needsTypeExpand) {
    db.exec(`
      CREATE TABLE map_objects_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('rack', 'pallet', 'zone', 'wall', 'window', 'door', 'table', 'chair')),
        label TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        shelves_count INTEGER,
        rotation REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        frame_width REAL,
        rack_theme TEXT NOT NULL DEFAULT 'blue'
      );
      INSERT INTO map_objects_new (
        id, type, label, x, y, width, height, shelves_count, rotation, created_at, frame_width, rack_theme
      )
      SELECT
        id, type, label, x, y, width, height, shelves_count, rotation, created_at, frame_width,
        COALESCE(rack_theme, 'blue')
      FROM map_objects;
      DROP TABLE map_objects;
      ALTER TABLE map_objects_new RENAME TO map_objects;
    `);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pallet_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pallet_id INTEGER NOT NULL REFERENCES map_objects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    quantity TEXT NOT NULL DEFAULT '',
    kind TEXT,
    ref_id INTEGER,
    name_snapshot TEXT NOT NULL DEFAULT '',
    type_snapshot TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON pallet_items(pallet_id, sort_order)`,
);

// Миграция со старой таблицы bookshelves
const hasOld = db
  .prepare(
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'bookshelves'`,
  )
  .get() as { ok: number } | undefined;

if (hasOld) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM map_objects`).get() as {
    n: number;
  };
  if (count.n === 0) {
    db.exec(`
      INSERT INTO map_objects (type, label, x, y, width, height, shelves_count, created_at)
      SELECT 'rack', label, x, y, width, height, shelves_count, created_at
      FROM bookshelves
    `);
  }
}

type ObjectType =
  | "rack"
  | "pallet"
  | "zone"
  | "wall"
  | "window"
  | "door"
  | "table"
  | "chair";
type RackTheme = "blue" | "black";

type ObjectRow = {
  id: number;
  type: ObjectType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shelves_count: number | null;
  rotation: number;
  frame_width: number | null;
  rack_theme: string | null;
};

function clampFrameWidth(value: number) {
  return Math.min(1600, Math.max(360, Math.round(value)));
}

function normalizeRotation(value: number) {
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped * 1000) / 1000;
}

const RACK_THEMES = new Set<RackTheme>(["blue", "black"]);

function normalizeRackTheme(value: unknown, fallback: RackTheme = "blue"): RackTheme {
  if (value === "orange") return "black";
  if (typeof value === "string" && RACK_THEMES.has(value as RackTheme)) {
    return value as RackTheme;
  }
  return fallback;
}

function mapObject(row: ObjectRow) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    shelvesCount: row.shelves_count,
    rotation: row.rotation ?? 0,
    frameWidth:
      row.frame_width != null && Number.isFinite(row.frame_width)
        ? clampFrameWidth(row.frame_width)
        : null,
    rackTheme:
      row.type === "rack" ? normalizeRackTheme(row.rack_theme) : null,
  };
}

const TYPES = new Set<ObjectType>([
  "rack",
  "pallet",
  "zone",
  "wall",
  "window",
  "door",
  "table",
  "chair",
]);

function minSizeFor(type: ObjectType) {
  switch (type) {
    case "wall":
    case "window":
    case "door":
      return { minSide: 6, minLong: 24 };
    case "chair":
      return { minSide: 18, minLong: 18 };
    case "table":
    case "zone":
    case "pallet":
    case "rack":
    default:
      return { minSide: 50, minLong: 50 };
  }
}

function validSize(type: ObjectType, width: number, height: number) {
  const { minSide, minLong } = minSizeFor(type);
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return short >= minSide && long >= minLong;
}

const listStmt = db.prepare(`
  SELECT id, type, label, x, y, width, height, shelves_count, rotation, frame_width, rack_theme
  FROM map_objects
  ORDER BY id ASC
`);

const getStmt = db.prepare(`
  SELECT id, type, label, x, y, width, height, shelves_count, rotation, frame_width, rack_theme
  FROM map_objects WHERE id = ?
`);

const insertStmt = db.prepare(`
  INSERT INTO map_objects (type, label, x, y, width, height, shelves_count, rotation, frame_width, rack_theme)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStmt = db.prepare(`
  UPDATE map_objects
  SET label = ?, x = ?, y = ?, width = ?, height = ?, shelves_count = ?, rotation = ?, frame_width = ?, rack_theme = ?
  WHERE id = ?
`);

const deleteStmt = db.prepare(`DELETE FROM map_objects WHERE id = ?`);

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  credentials: true,
});
setupAuth(app, db);

app.addHook("preHandler", async (request, reply) => {
  const path = request.url.split("?")[0] ?? "";
  if (!path.startsWith("/api/")) return;
  if (
    path === "/api/auth/logout" ||
    path === "/api/auth/me"
  ) {
    return;
  }

  if (!requireAuth(request, reply)) return;

  const method = request.method.toUpperCase();
  const mapWrite =
    method !== "GET" &&
    method !== "HEAD" &&
    (path === "/api/objects" ||
      path.startsWith("/api/objects/") ||
      path === "/api/map-settings" ||
      path.startsWith("/api/map-settings/"));
  if (mapWrite && !request.user!.canEditMap) {
    return reply
      .code(403)
      .send({ error: "Недостаточно прав для изменения карты" });
  }

  const shelfWrite =
    method !== "GET" &&
    method !== "HEAD" &&
    (path.includes("/items") || path.startsWith("/api/shelf-items/"));
  if (shelfWrite && !request.user!.canEditShelves) {
    return reply
      .code(403)
      .send({ error: "Недостаточно прав для изменения полок" });
  }
});

app.get("/api/objects", async () => {
  const rows = listStmt.all() as ObjectRow[];
  return rows.map(mapObject);
});

app.get("/api/map-settings", async () => {
  const floorMime = getMapSetting("floor_mime", "");
  const rev = getMapSetting("floor_rev", "0");
  return {
    wallHeightM: Number(getMapSetting("wall_height_m", "3.6")) || 3.6,
    rackHeightM: Number(getMapSetting("rack_height_m", "2.7")) || 2.7,
    windowSillM: Number(getMapSetting("window_sill_m", "0.9")) || 0.9,
    windowHeightM: Number(getMapSetting("window_height_m", "1.5")) || 1.5,
    hasFloorTexture: Boolean(floorMime),
    floorUrl: floorMime
      ? `/stockmap-api/map-settings/floor?v=${encodeURIComponent(rev)}`
      : null,
  };
});

app.put<{
  Body: {
    wallHeightM?: number;
    rackHeightM?: number;
    windowSillM?: number;
    windowHeightM?: number;
  };
}>("/api/map-settings", async (request, reply) => {
  const body = request.body ?? {};
  const clampH = (n: unknown, min: number, max: number, fallback: number) => {
    const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
    return Math.min(max, Math.max(min, v));
  };
  if (body.wallHeightM != null) {
    setMapSetting(
      "wall_height_m",
      String(clampH(body.wallHeightM, 1.5, 8, 3.6)),
    );
  }
  if (body.rackHeightM != null) {
    setMapSetting(
      "rack_height_m",
      String(clampH(body.rackHeightM, 1.2, 6, 2.7)),
    );
  }
  if (body.windowSillM != null) {
    setMapSetting(
      "window_sill_m",
      String(clampH(body.windowSillM, 0.1, 2.5, 0.9)),
    );
  }
  if (body.windowHeightM != null) {
    setMapSetting(
      "window_height_m",
      String(clampH(body.windowHeightM, 0.3, 3, 1.5)),
    );
  }
  const floorMime = getMapSetting("floor_mime", "");
  const rev = getMapSetting("floor_rev", "0");
  return {
    wallHeightM: Number(getMapSetting("wall_height_m", "3.6")) || 3.6,
    rackHeightM: Number(getMapSetting("rack_height_m", "2.7")) || 2.7,
    windowSillM: Number(getMapSetting("window_sill_m", "0.9")) || 0.9,
    windowHeightM: Number(getMapSetting("window_height_m", "1.5")) || 1.5,
    hasFloorTexture: Boolean(floorMime),
    floorUrl: floorMime
      ? `/stockmap-api/map-settings/floor?v=${encodeURIComponent(rev)}`
      : null,
  };
});

app.get("/api/map-settings/floor", async (_request, reply) => {
  const mime = getMapSetting("floor_mime", "");
  if (!mime) {
    return reply.code(404).send({ error: "Текстура пола не задана" });
  }
  try {
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(floorFilePath);
    return reply.type(mime).send(buf);
  } catch {
    return reply.code(404).send({ error: "Файл текстуры не найден" });
  }
});

app.post<{
  Body: { mime?: string; dataBase64?: string };
}>("/api/map-settings/floor", async (request, reply) => {
  const mime = String(request.body?.mime ?? "").trim();
  const dataBase64 = String(request.body?.dataBase64 ?? "");
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(mime) || !dataBase64) {
    return reply
      .code(400)
      .send({ error: "Нужен JPEG/PNG/WebP в dataBase64" });
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(dataBase64, "base64");
  } catch {
    return reply.code(400).send({ error: "Некорректный base64" });
  }
  if (buf.length < 32 || buf.length > 2.5 * 1024 * 1024) {
    return reply.code(400).send({ error: "Размер текстуры: до 2.5 МБ" });
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(floorFilePath, buf);
  setMapSetting("floor_mime", mime);
  setMapSetting("floor_rev", String(Date.now()));
  const rev = getMapSetting("floor_rev", "0");
  return {
    ok: true,
    floorUrl: `/stockmap-api/map-settings/floor?v=${encodeURIComponent(rev)}`,
  };
});

app.delete("/api/map-settings/floor", async () => {
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(floorFilePath);
  } catch {
    /* ignore */
  }
  setMapSetting("floor_mime", "");
  setMapSetting("floor_rev", String(Date.now()));
  return { ok: true };
});

// Совместимость со старым клиентом
app.get("/api/bookshelves", async () => {
  const rows = listStmt.all() as ObjectRow[];
  return rows.filter((r) => r.type === "rack").map(mapObject);
});

app.post<{
  Body: {
    type: ObjectType;
    label?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shelvesCount?: number | null;
    rotation?: number;
    frameWidth?: number | null;
    rackTheme?: RackTheme | null;
  };
}>("/api/objects", async (request, reply) => {
  const body = request.body ?? {};
  const type = body.type;

  if (!TYPES.has(type)) {
    return reply.code(400).send({ error: "Неизвестный тип объекта" });
  }

  const {
    x,
    y,
    width,
    height,
  } = body;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !validSize(type, width, height)
  ) {
    return reply.code(400).send({ error: "Некорректные размеры объекта" });
  }

  let label =
    typeof body.label === "string" ? body.label.trim() : defaultLabel(type);
  if (!label) label = defaultLabel(type);

  let shelvesCount: number | null = null;
  if (type === "rack") {
    shelvesCount =
      typeof body.shelvesCount === "number" ? body.shelvesCount : 5;
    if (!Number.isInteger(shelvesCount) || shelvesCount < 1) {
      return reply.code(400).send({ error: "Некорректное число полок" });
    }
  }

  const rotation =
    typeof body.rotation === "number" && Number.isFinite(body.rotation)
      ? normalizeRotation(body.rotation)
      : 0;

  const frameWidth =
    type === "rack" &&
    typeof body.frameWidth === "number" &&
    Number.isFinite(body.frameWidth)
      ? clampFrameWidth(body.frameWidth)
      : null;

  const rackTheme =
    type === "rack" ? normalizeRackTheme(body.rackTheme) : "blue";

  const result = insertStmt.run(
    type,
    label,
    x,
    y,
    width,
    height,
    shelvesCount,
    rotation,
    frameWidth,
    rackTheme,
  );

  const row = getStmt.get(result.lastInsertRowid) as ObjectRow;
  return reply.code(201).send(mapObject(row));
});

app.patch<{
  Params: { id: string };
  Body: Partial<{
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shelvesCount: number | null;
    rotation: number;
    frameWidth: number | null;
    rackTheme: RackTheme | null;
  }>;
}>("/api/objects/:id", async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }

  const existing = getStmt.get(id) as ObjectRow | undefined;
  if (!existing) {
    return reply.code(404).send({ error: "Объект не найден" });
  }

  const body = request.body ?? {};
  const canRotate = existing.type === "door" || existing.type === "chair";
  const next = {
    label:
      typeof body.label === "string" && body.label.trim()
        ? body.label.trim()
        : existing.label,
    x: typeof body.x === "number" ? body.x : existing.x,
    y: typeof body.y === "number" ? body.y : existing.y,
    width: typeof body.width === "number" ? body.width : existing.width,
    height: typeof body.height === "number" ? body.height : existing.height,
    shelvesCount:
      existing.type === "rack"
        ? typeof body.shelvesCount === "number"
          ? body.shelvesCount
          : existing.shelves_count
        : null,
    rotation: canRotate
      ? typeof body.rotation === "number" && Number.isFinite(body.rotation)
        ? normalizeRotation(body.rotation)
        : (existing.rotation ?? 0)
      : 0,
    frameWidth:
      existing.type === "rack"
        ? typeof body.frameWidth === "number" && Number.isFinite(body.frameWidth)
          ? clampFrameWidth(body.frameWidth)
          : existing.frame_width
        : null,
    rackTheme:
      existing.type === "rack"
        ? body.rackTheme !== undefined
          ? normalizeRackTheme(body.rackTheme, normalizeRackTheme(existing.rack_theme))
          : normalizeRackTheme(existing.rack_theme)
        : "blue",
  };

  if (!validSize(existing.type, next.width, next.height)) {
    return reply.code(400).send({ error: "Некорректные размеры объекта" });
  }

  if (
    existing.type === "rack" &&
    (next.shelvesCount == null ||
      !Number.isInteger(next.shelvesCount) ||
      next.shelvesCount < 1)
  ) {
    return reply.code(400).send({ error: "Некорректное число полок" });
  }

  const prevShelves =
    existing.type === "rack" ? (existing.shelves_count ?? 0) : 0;
  const nextShelves =
    existing.type === "rack" ? (next.shelvesCount ?? 0) : 0;

  updateStmt.run(
    next.label,
    next.x,
    next.y,
    next.width,
    next.height,
    next.shelvesCount,
    next.rotation,
    next.frameWidth,
    next.rackTheme,
    id,
  );

  // Уменьшили число полок — убрать объекты с исчезнувших уровней (и старой крыши).
  if (existing.type === "rack" && nextShelves < prevShelves) {
    db.prepare(
      `DELETE FROM shelf_items WHERE rack_id = ? AND shelf_index > ?`,
    ).run(id, nextShelves);
  }

  const row = getStmt.get(id) as ObjectRow;
  return mapObject(row);
});

app.delete<{ Params: { id: string } }>(
  "/api/objects/:id",
  async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "Некорректный id" });
    }

    db.prepare(`DELETE FROM shelf_items WHERE rack_id = ?`).run(id);
    const result = deleteStmt.run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: "Объект не найден" });
    }

    return reply.code(204).send();
  },
);

db.exec(`
  CREATE TABLE IF NOT EXISTS shelf_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rack_id INTEGER NOT NULL,
    shelf_index INTEGER NOT NULL CHECK (shelf_index >= 1),
    type TEXT NOT NULL CHECK (type IN ('box', 'container', 'cell', 'stack')),
    width_ratio REAL NOT NULL DEFAULT 1,
    pos_x REAL NOT NULL DEFAULT 0,
    depth_row INTEGER NOT NULL DEFAULT 1 CHECK (depth_row >= 1 AND depth_row <= 8),
    stack_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    quantity TEXT NOT NULL DEFAULT '',
    info_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const shelfItemColumns = db
  .prepare(`PRAGMA table_info(shelf_items)`)
  .all() as { name: string }[];

if (!shelfItemColumns.some((c) => c.name === "width_ratio")) {
  db.exec(
    `ALTER TABLE shelf_items ADD COLUMN width_ratio REAL NOT NULL DEFAULT 1`,
  );
}
if (!shelfItemColumns.some((c) => c.name === "pos_x")) {
  db.exec(`ALTER TABLE shelf_items ADD COLUMN pos_x REAL NOT NULL DEFAULT 0`);
  const existing = db
    .prepare(
      `SELECT id, rack_id, shelf_index FROM shelf_items ORDER BY rack_id, shelf_index, id`,
    )
    .all() as { id: number; rack_id: number; shelf_index: number }[];
  const counters = new Map<string, number>();
  const place = db.prepare(`UPDATE shelf_items SET pos_x = ? WHERE id = ?`);
  for (const row of existing) {
    const key = `${row.rack_id}:${row.shelf_index}`;
    const idx = counters.get(key) ?? 0;
    place.run(idx * 90, row.id);
    counters.set(key, idx + 1);
  }
}
if (!shelfItemColumns.some((c) => c.name === "title")) {
  db.exec(`ALTER TABLE shelf_items ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
}
if (!shelfItemColumns.some((c) => c.name === "details")) {
  db.exec(`ALTER TABLE shelf_items ADD COLUMN details TEXT NOT NULL DEFAULT ''`);
}
if (!shelfItemColumns.some((c) => c.name === "quantity")) {
  db.exec(
    `ALTER TABLE shelf_items ADD COLUMN quantity TEXT NOT NULL DEFAULT ''`,
  );
}
if (!shelfItemColumns.some((c) => c.name === "info_updated_at")) {
  db.exec(`ALTER TABLE shelf_items ADD COLUMN info_updated_at TEXT`);
}
if (!shelfItemColumns.some((c) => c.name === "depth_row")) {
  db.exec(
    `ALTER TABLE shelf_items ADD COLUMN depth_row INTEGER NOT NULL DEFAULT 1`,
  );
}
if (!shelfItemColumns.some((c) => c.name === "stack_order")) {
  db.exec(
    `ALTER TABLE shelf_items ADD COLUMN stack_order INTEGER NOT NULL DEFAULT 0`,
  );
}

// Обновить CHECK type: разрешить 'stack'
try {
  db.prepare(
    `INSERT INTO shelf_items (rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order)
     VALUES (-1, 1, 'stack', 1, 0, 1, 0)`,
  ).run();
  db.prepare(`DELETE FROM shelf_items WHERE rack_id = -1`).run();
} catch {
  db.exec(`
    CREATE TABLE shelf_items_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rack_id INTEGER NOT NULL,
      shelf_index INTEGER NOT NULL CHECK (shelf_index >= 1),
      type TEXT NOT NULL CHECK (type IN ('box', 'container', 'cell', 'stack')),
      width_ratio REAL NOT NULL DEFAULT 1,
      pos_x REAL NOT NULL DEFAULT 0,
      depth_row INTEGER NOT NULL DEFAULT 1 CHECK (depth_row >= 1 AND depth_row <= 8),
      stack_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL DEFAULT '',
      info_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO shelf_items_migrated (
      id, rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
      title, details, quantity, info_updated_at, created_at
    )
    SELECT
      id, rack_id, shelf_index, type,
      COALESCE(width_ratio, 1), COALESCE(pos_x, 0),
      COALESCE(depth_row, 1), COALESCE(stack_order, 0),
      COALESCE(title, ''), COALESCE(details, ''), COALESCE(quantity, ''),
      info_updated_at, COALESCE(created_at, datetime('now'))
    FROM shelf_items;
    DROP TABLE shelf_items;
    ALTER TABLE shelf_items_migrated RENAME TO shelf_items;
  `);
}

// Обновить CHECK depth_row: разрешить 1..8
try {
  db.prepare(
    `INSERT INTO shelf_items (rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order)
     VALUES (-2, 1, 'box', 1, 0, 3, 0)`,
  ).run();
  db.prepare(`DELETE FROM shelf_items WHERE rack_id = -2`).run();
} catch {
  db.exec(`
    CREATE TABLE shelf_items_depth (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rack_id INTEGER NOT NULL,
      shelf_index INTEGER NOT NULL CHECK (shelf_index >= 1),
      type TEXT NOT NULL CHECK (type IN ('box', 'container', 'cell', 'stack')),
      width_ratio REAL NOT NULL DEFAULT 1,
      pos_x REAL NOT NULL DEFAULT 0,
      depth_row INTEGER NOT NULL DEFAULT 1 CHECK (depth_row >= 1 AND depth_row <= 8),
      stack_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL DEFAULT '',
      info_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO shelf_items_depth (
      id, rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
      title, details, quantity, info_updated_at, created_at
    )
    SELECT
      id, rack_id, shelf_index, type,
      COALESCE(width_ratio, 1), COALESCE(pos_x, 0),
      CASE
        WHEN depth_row IS NULL OR depth_row < 1 THEN 1
        WHEN depth_row > 8 THEN 8
        ELSE depth_row
      END,
      COALESCE(stack_order, 0),
      COALESCE(title, ''), COALESCE(details, ''), COALESCE(quantity, ''),
      info_updated_at, COALESCE(created_at, datetime('now'))
    FROM shelf_items;
    DROP TABLE shelf_items;
    ALTER TABLE shelf_items_depth RENAME TO shelf_items;
  `);
}

type ShelfItemType = "box" | "container" | "cell" | "stack";

type ShelfItemRow = {
  id: number;
  rack_id: number;
  shelf_index: number;
  type: ShelfItemType;
  width_ratio: number;
  pos_x: number;
  depth_row: number;
  stack_order: number;
  title: string;
  details: string;
  quantity: string;
  info_updated_at: string | null;
};

function clampWidthRatio(value: number, type?: ShelfItemType) {
  // Box/container/cell: standard size is the minimum; can only grow.
  const min = type === "stack" ? 0.6 : 1;
  const max = 2.5;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function clampPosX(value: number) {
  return Math.max(0, Math.round(value));
}

function clampDepthRow(value: number) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(8, Math.max(1, n));
}

function clampStackOrder(value: number) {
  return Math.min(3, Math.max(0, Math.round(value)));
}

/** Свободный pos_x на полке/ряду — не совпадает с чужим столбцом. */
function allocateFreePosX(
  rackId: number,
  shelfIndex: number,
  depthRow: number,
  preferred: number,
  excludeId: number,
) {
  const occupied = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT pos_x AS pos_x FROM shelf_items
           WHERE rack_id = ? AND shelf_index = ? AND depth_row = ? AND id != ?`,
        )
        .all(rackId, shelfIndex, depthRow, excludeId) as { pos_x: number }[]
    ).map((row) => row.pos_x),
  );
  let pos = clampPosX(preferred);
  if (!occupied.has(pos)) return pos;
  for (let delta = 8; delta < 8000; delta += 8) {
    const right = clampPosX(preferred + delta);
    if (!occupied.has(right)) return right;
    const left = clampPosX(preferred - delta);
    if (!occupied.has(left)) return left;
  }
  pos = 0;
  while (occupied.has(pos)) pos += 1;
  return pos;
}

function nowIso() {
  return new Date().toISOString();
}

function mapShelfItem(row: ShelfItemRow, contents?: ReturnType<typeof mapContent>[]) {
  return {
    id: row.id,
    rackId: row.rack_id,
    shelfIndex: row.shelf_index,
    type: row.type,
    widthRatio: row.width_ratio ?? 1,
    posX: row.pos_x ?? 0,
    depthRow: clampDepthRow(row.depth_row ?? 1),
    stackOrder: clampStackOrder(row.stack_order ?? 0),
    title: row.title ?? "",
    details: row.details ?? "",
    quantity: row.quantity ?? "",
    infoUpdatedAt: row.info_updated_at ?? null,
    contents: contents ?? contentsForItem(row.id),
  };
}

const listItemsStmt = db.prepare(`
  SELECT id, rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
         title, details, quantity, info_updated_at
  FROM shelf_items
  WHERE rack_id = ?
  ORDER BY shelf_index ASC, depth_row ASC, pos_x ASC, stack_order ASC, id ASC
`);

const getItemStmt = db.prepare(`
  SELECT id, rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
         title, details, quantity, info_updated_at
  FROM shelf_items WHERE id = ?
`);

const maxPosStmt = db.prepare(`
  SELECT COALESCE(MAX(pos_x), -90) AS max_pos
  FROM shelf_items
  WHERE rack_id = ? AND shelf_index = ? AND depth_row = ?
`);

const stackCountStmt = db.prepare(`
  SELECT COUNT(*) AS n
  FROM shelf_items
  WHERE rack_id = ? AND shelf_index = ? AND depth_row = ? AND pos_x = ?
`);

const maxStackOrderStmt = db.prepare(`
  SELECT COALESCE(MAX(stack_order), -1) AS max_order
  FROM shelf_items
  WHERE rack_id = ? AND shelf_index = ? AND depth_row = ? AND pos_x = ?
`);

const insertItemStmt = db.prepare(`
  INSERT INTO shelf_items (
    rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
    title, details, quantity, info_updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', NULL)
`);

const updateItemStmt = db.prepare(`
  UPDATE shelf_items
  SET width_ratio = ?, pos_x = ?, shelf_index = ?, depth_row = ?, stack_order = ?,
      title = ?, details = ?, quantity = ?, info_updated_at = ?
  WHERE id = ?
`);

const deleteItemStmt = db.prepare(`DELETE FROM shelf_items WHERE id = ?`);

db.exec(`
  CREATE TABLE IF NOT EXISTS shelf_item_contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shelf_item_id INTEGER NOT NULL REFERENCES shelf_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('component', 'product')),
    ref_id INTEGER NOT NULL,
    name_snapshot TEXT NOT NULL,
    type_snapshot TEXT NOT NULL DEFAULT '',
    quantity TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (shelf_item_id, kind, ref_id)
  );
`);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_shelf_item_contents_item ON shelf_item_contents(shelf_item_id)`,
);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_shelf_item_contents_ref ON shelf_item_contents(kind, ref_id)`,
);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_shelf_item_contents_name ON shelf_item_contents(name_snapshot)`,
);

type ContentKind = "component" | "product";

type ContentRow = {
  id: number;
  shelf_item_id: number;
  kind: ContentKind;
  ref_id: number;
  name_snapshot: string;
  type_snapshot: string;
  quantity: string;
};

function mapContent(row: ContentRow) {
  return {
    id: row.id,
    shelfItemId: row.shelf_item_id,
    kind: row.kind,
    refId: row.ref_id,
    nameSnapshot: row.name_snapshot,
    typeSnapshot: row.type_snapshot ?? "",
    quantity: row.quantity ?? "",
  };
}

const listContentsStmt = db.prepare(`
  SELECT id, shelf_item_id, kind, ref_id, name_snapshot, type_snapshot, quantity
  FROM shelf_item_contents
  WHERE shelf_item_id = ?
  ORDER BY kind ASC, name_snapshot COLLATE NOCASE ASC, id ASC
`);

const deleteContentsForItemStmt = db.prepare(
  `DELETE FROM shelf_item_contents WHERE shelf_item_id = ?`,
);

const insertContentStmt = db.prepare(`
  INSERT INTO shelf_item_contents (
    shelf_item_id, kind, ref_id, name_snapshot, type_snapshot, quantity
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

function contentsForItem(itemId: number) {
  return (listContentsStmt.all(itemId) as ContentRow[]).map(mapContent);
}

function contentsByItemIds(itemIds: number[]) {
  const map = new Map<number, ReturnType<typeof mapContent>[]>();
  for (const id of itemIds) map.set(id, []);
  if (itemIds.length === 0) return map;
  const placeholders = itemIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, shelf_item_id, kind, ref_id, name_snapshot, type_snapshot, quantity
       FROM shelf_item_contents
       WHERE shelf_item_id IN (${placeholders})
       ORDER BY kind ASC, name_snapshot COLLATE NOCASE ASC, id ASC`,
    )
    .all(...itemIds) as ContentRow[];
  for (const row of rows) {
    const list = map.get(row.shelf_item_id);
    if (list) list.push(mapContent(row));
  }
  return map;
}

const ITEM_TYPES = new Set<ShelfItemType>([
  "box",
  "container",
  "cell",
  "stack",
]);

app.get<{ Params: { id: string } }>(
  "/api/racks/:id/items",
  async (request, reply) => {
    const rackId = Number(request.params.id);
    if (!Number.isInteger(rackId)) {
      return reply.code(400).send({ error: "Некорректный id" });
    }

    const rack = getStmt.get(rackId) as ObjectRow | undefined;
    if (!rack || rack.type !== "rack") {
      return reply.code(404).send({ error: "Стеллаж не найден" });
    }

    const rows = listItemsStmt.all(rackId) as ShelfItemRow[];
    const byId = contentsByItemIds(rows.map((r) => r.id));
    return rows.map((row) => mapShelfItem(row, byId.get(row.id) ?? []));
  },
);

app.put<{
  Params: { id: string };
  Body: {
    items?: Array<{
      id?: number;
      shelfIndex?: number;
      type?: ShelfItemType;
      widthRatio?: number;
      posX?: number;
      depthRow?: number;
      stackOrder?: number;
      title?: string;
      details?: string;
      quantity?: string;
      contents?: Array<{
        kind?: string;
        refId?: number;
        nameSnapshot?: string;
        typeSnapshot?: string;
        quantity?: string;
      }>;
    }>;
  };
}>("/api/racks/:id/items/replace", async (request, reply) => {
  const rackId = Number(request.params.id);
  if (!Number.isInteger(rackId)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }
  const rack = getStmt.get(rackId) as ObjectRow | undefined;
  if (!rack || rack.type !== "rack") {
    return reply.code(404).send({ error: "Стеллаж не найден" });
  }

  const raw = Array.isArray(request.body?.items) ? request.body.items : [];
  if (raw.length > 500) {
    return reply.code(400).send({ error: "Слишком много объектов" });
  }

  const maxShelfInclusive = (rack.shelves_count ?? 0) + 1;
  type Norm = {
    keepId: number | null;
    shelfIndex: number;
    type: ShelfItemType;
    widthRatio: number;
    posX: number;
    depthRow: number;
    stackOrder: number;
    title: string;
    details: string;
    quantity: string;
    contents: Array<{
      kind: ContentKind;
      refId: number;
      nameSnapshot: string;
      typeSnapshot: string;
      quantity: string;
    }>;
  };

  const normalized: Norm[] = [];
  for (const entry of raw) {
    const type = entry?.type;
    const shelfIndex = Number(entry?.shelfIndex);
    if (!ITEM_TYPES.has(type as ShelfItemType)) {
      return reply.code(400).send({ error: "Некорректный тип сущности" });
    }
    if (
      !Number.isInteger(shelfIndex) ||
      shelfIndex < 1 ||
      shelfIndex > maxShelfInclusive
    ) {
      return reply.code(400).send({ error: "Некорректный номер полки" });
    }
    const keepId =
      typeof entry?.id === "number" &&
      Number.isInteger(entry.id) &&
      entry.id > 0
        ? entry.id
        : null;
    const contentsRaw = Array.isArray(entry?.contents) ? entry.contents : [];
    const contents: Norm["contents"] = [];
    const seen = new Set<string>();
    for (const c of contentsRaw) {
      if (c?.kind !== "component" && c?.kind !== "product") continue;
      const refId = Number(c.refId);
      if (!Number.isInteger(refId) || refId <= 0) continue;
      const nameSnapshot =
        typeof c.nameSnapshot === "string" ? c.nameSnapshot.trim() : "";
      if (!nameSnapshot) continue;
      const key = `${c.kind}:${refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contents.push({
        kind: c.kind,
        refId,
        nameSnapshot: nameSnapshot.slice(0, 200),
        typeSnapshot:
          typeof c.typeSnapshot === "string"
            ? c.typeSnapshot.trim().slice(0, 120)
            : "",
        quantity:
          typeof c.quantity === "string" ? c.quantity.trim().slice(0, 80) : "",
      });
    }
    normalized.push({
      keepId,
      shelfIndex,
      type: type as ShelfItemType,
      widthRatio: clampWidthRatio(
        typeof entry?.widthRatio === "number" ? entry.widthRatio : 1,
        type as ShelfItemType,
      ),
      posX: clampPosX(typeof entry?.posX === "number" ? entry.posX : 0),
      depthRow: clampDepthRow(
        typeof entry?.depthRow === "number" ? entry.depthRow : 1,
      ),
      stackOrder: clampStackOrder(
        typeof entry?.stackOrder === "number" ? entry.stackOrder : 0,
      ),
      title: typeof entry?.title === "string" ? entry.title.trim().slice(0, 200) : "",
      details:
        typeof entry?.details === "string" ? entry.details.trim().slice(0, 2000) : "",
      quantity:
        typeof entry?.quantity === "string" ? entry.quantity.trim().slice(0, 80) : "",
      contents,
    });
  }

  const insertFullStmt = db.prepare(`
    INSERT INTO shelf_items (
      rack_id, shelf_index, type, width_ratio, pos_x, depth_row, stack_order,
      title, details, quantity, info_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    db.exec("BEGIN IMMEDIATE");
    const existing = listItemsStmt.all(rackId) as ShelfItemRow[];
    const keepIds = new Set(
      normalized.map((n) => n.keepId).filter((id): id is number => id != null),
    );
    for (const row of existing) {
      if (!keepIds.has(row.id)) {
        deleteContentsForItemStmt.run(row.id);
        deleteItemStmt.run(row.id);
      }
    }
    for (const n of normalized) {
      let itemId = n.keepId;
      const infoAt =
        n.title || n.details || n.quantity || n.contents.length > 0
          ? nowIso()
          : null;
      if (itemId != null) {
        const row = getItemStmt.get(itemId) as ShelfItemRow | undefined;
        if (!row || row.rack_id !== rackId) {
          throw new Error("Некорректный id сущности");
        }
        updateItemStmt.run(
          n.widthRatio,
          n.posX,
          n.shelfIndex,
          n.depthRow,
          n.stackOrder,
          n.title,
          n.details,
          n.quantity,
          infoAt,
          itemId,
        );
      } else {
        const result = insertFullStmt.run(
          rackId,
          n.shelfIndex,
          n.type,
          n.widthRatio,
          n.posX,
          n.depthRow,
          n.stackOrder,
          n.title,
          n.details,
          n.quantity,
          infoAt,
        );
        itemId = Number(result.lastInsertRowid);
      }
      deleteContentsForItemStmt.run(itemId);
      for (const c of n.contents) {
        insertContentStmt.run(
          itemId,
          c.kind,
          c.refId,
          c.nameSnapshot,
          c.typeSnapshot,
          c.quantity,
        );
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    return reply
      .code(400)
      .send({
        error: err instanceof Error ? err.message : "Не удалось сохранить",
      });
  }

  const rows = listItemsStmt.all(rackId) as ShelfItemRow[];
  const byId = contentsByItemIds(rows.map((r) => r.id));
  return rows.map((row) => mapShelfItem(row, byId.get(row.id) ?? []));
});

app.post<{
  Params: { id: string };
  Body: {
    shelfIndex: number;
    type: ShelfItemType;
    widthRatio?: number;
    posX?: number;
    depthRow?: number;
    stackOntoId?: number;
  };
}>("/api/racks/:id/items", async (request, reply) => {
  const rackId = Number(request.params.id);
  if (!Number.isInteger(rackId)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }

  const rack = getStmt.get(rackId) as ObjectRow | undefined;
  if (!rack || rack.type !== "rack") {
    return reply.code(404).send({ error: "Стеллаж не найден" });
  }

  const { shelfIndex, type, widthRatio, posX, depthRow, stackOntoId } =
    request.body ?? {};
  const maxShelf = rack.shelves_count ?? 0;
  // shelves_count + 1 = верхняя площадка стеллажа (крыша)
  const maxShelfInclusive = maxShelf + 1;

  if (
    !ITEM_TYPES.has(type) ||
    typeof shelfIndex !== "number" ||
    !Number.isInteger(shelfIndex) ||
    shelfIndex < 1 ||
    shelfIndex > maxShelfInclusive
  ) {
    return reply.code(400).send({ error: "Некорректные данные сущности" });
  }

  const ratio =
    typeof widthRatio === "number"
      ? clampWidthRatio(widthRatio, type)
      : type === "stack"
        ? 1.25
        : 1;

  let nextDepth = clampDepthRow(
    typeof depthRow === "number" ? depthRow : 1,
  );
  let nextPos = 0;
  let nextStackOrder = 0;

  if (typeof stackOntoId === "number") {
    const base = getItemStmt.get(stackOntoId) as ShelfItemRow | undefined;
    if (!base || base.rack_id !== rackId || base.shelf_index !== shelfIndex) {
      return reply.code(400).send({ error: "Нельзя положить на эту сущность" });
    }
    nextDepth = clampDepthRow(base.depth_row);
    nextPos = clampPosX(base.pos_x);
    const count = (
      stackCountStmt.get(rackId, shelfIndex, nextDepth, nextPos) as {
        n: number;
      }
    ).n;
    if (count >= 4) {
      return reply.code(400).send({ error: "В стеке уже 4 сущности" });
    }
    const maxOrder = (
      maxStackOrderStmt.get(rackId, shelfIndex, nextDepth, nextPos) as {
        max_order: number;
      }
    ).max_order;
    nextStackOrder = clampStackOrder(maxOrder + 1);
  } else if (typeof posX === "number" && Number.isFinite(posX)) {
    nextPos = clampPosX(posX);
    const countAtPos = (
      stackCountStmt.get(rackId, shelfIndex, nextDepth, nextPos) as {
        n: number;
      }
    ).n;
    // Нельзя создать 5-ю коробку «в ту же точку» без stackOntoId
    if (countAtPos > 0) {
      nextPos = allocateFreePosX(
        rackId,
        shelfIndex,
        nextDepth,
        nextPos,
        -1,
      );
    }
  } else {
    const maxRow = maxPosStmt.get(rackId, shelfIndex, nextDepth) as {
      max_pos: number;
    };
    nextPos = clampPosX(maxRow.max_pos + 90);
    const countAtPos = (
      stackCountStmt.get(rackId, shelfIndex, nextDepth, nextPos) as {
        n: number;
      }
    ).n;
    if (countAtPos > 0) {
      nextPos = allocateFreePosX(
        rackId,
        shelfIndex,
        nextDepth,
        nextPos,
        -1,
      );
    }
  }

  const result = insertItemStmt.run(
    rackId,
    shelfIndex,
    type,
    ratio,
    nextPos,
    nextDepth,
    nextStackOrder,
  );
  const row = getItemStmt.get(result.lastInsertRowid) as ShelfItemRow;
  return reply.code(201).send(mapShelfItem(row));
});

app.patch<{
  Params: { id: string };
  Body: Partial<{
    widthRatio: number;
    posX: number;
    shelfIndex: number;
    depthRow: number;
    stackOrder: number;
    title: string;
    details: string;
    quantity: string;
    moveStackGroup: boolean;
    stackOntoId: number;
  }>;
}>("/api/shelf-items/:id", async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }

  const existing = getItemStmt.get(id) as ShelfItemRow | undefined;
  if (!existing) {
    return reply.code(404).send({ error: "Сущность не найдена" });
  }

  const body = request.body ?? {};

  // Перенос на другую сущность (стек до 4)
  if (typeof body.stackOntoId === "number") {
    const base = getItemStmt.get(body.stackOntoId) as ShelfItemRow | undefined;
    if (!base || base.rack_id !== existing.rack_id) {
      return reply.code(400).send({ error: "Нельзя положить на эту сущность" });
    }
    if (base.id === existing.id) {
      return reply.code(400).send({ error: "Нельзя положить на себя" });
    }

    const moving = (
      db
        .prepare(
          `SELECT id, stack_order FROM shelf_items
           WHERE rack_id = ? AND shelf_index = ? AND depth_row = ? AND pos_x = ?
           ORDER BY stack_order ASC, id ASC`,
        )
        .all(
          existing.rack_id,
          existing.shelf_index,
          existing.depth_row,
          existing.pos_x,
        ) as { id: number; stack_order: number }[]
    );
    const movingIds = new Set(moving.map((r) => r.id));
    if (movingIds.has(base.id)) {
      // уже в этом стеке — ничего не делаем
      return mapShelfItem(existing);
    }

    const targetCount = (
      stackCountStmt.get(
        base.rack_id,
        base.shelf_index,
        base.depth_row,
        base.pos_x,
      ) as { n: number }
    ).n;
    if (targetCount + moving.length > 4) {
      return reply
        .code(400)
        .send({ error: "В стеке не больше 4 сущностей" });
    }

    const maxOrder = (
      maxStackOrderStmt.get(
        base.rack_id,
        base.shelf_index,
        base.depth_row,
        base.pos_x,
      ) as { max_order: number }
    ).max_order;

    const move = db.prepare(
      `UPDATE shelf_items
       SET pos_x = ?, shelf_index = ?, depth_row = ?, stack_order = ?
       WHERE id = ?`,
    );
    let order = maxOrder + 1;
    for (const row of moving) {
      move.run(
        clampPosX(base.pos_x),
        base.shelf_index,
        clampDepthRow(base.depth_row),
        clampStackOrder(order),
        row.id,
      );
      order += 1;
    }

    const row = getItemStmt.get(id) as ShelfItemRow;
    return mapShelfItem(row);
  }

  const nextWidth =
    typeof body.widthRatio === "number" && Number.isFinite(body.widthRatio)
      ? clampWidthRatio(body.widthRatio, existing.type)
      : (existing.width_ratio ?? 1);
  const nextPos =
    typeof body.posX === "number" && Number.isFinite(body.posX)
      ? clampPosX(body.posX)
      : (existing.pos_x ?? 0);
  const rack = getStmt.get(existing.rack_id) as ObjectRow | undefined;
  const maxShelfInclusive =
    rack && rack.type === "rack" ? (rack.shelves_count ?? 0) + 1 : 1;
  const nextShelf =
    typeof body.shelfIndex === "number" && Number.isInteger(body.shelfIndex)
      ? Math.min(maxShelfInclusive, Math.max(1, body.shelfIndex))
      : existing.shelf_index;
  const nextDepth =
    typeof body.depthRow === "number"
      ? clampDepthRow(body.depthRow)
      : clampDepthRow(existing.depth_row ?? 1);
  const nextStackOrder =
    typeof body.stackOrder === "number"
      ? clampStackOrder(body.stackOrder)
      : clampStackOrder(existing.stack_order ?? 0);

  const hasInfoPatch =
    body.title !== undefined ||
    body.details !== undefined ||
    body.quantity !== undefined;

  if (
    body.widthRatio === undefined &&
    body.posX === undefined &&
    body.shelfIndex === undefined &&
    body.depthRow === undefined &&
    body.stackOrder === undefined &&
    !hasInfoPatch
  ) {
    return reply.code(400).send({ error: "Нет данных для обновления" });
  }

  const nextTitle =
    typeof body.title === "string" ? body.title.trim() : (existing.title ?? "");
  const nextDetails =
    typeof body.details === "string"
      ? body.details.trim()
      : (existing.details ?? "");
  const nextQuantity =
    typeof body.quantity === "string"
      ? body.quantity.trim()
      : (existing.quantity ?? "");

  const infoChanged =
    nextTitle !== (existing.title ?? "") ||
    nextDetails !== (existing.details ?? "") ||
    nextQuantity !== (existing.quantity ?? "");

  const nextInfoUpdatedAt = infoChanged
    ? nowIso()
    : (existing.info_updated_at ?? null);

  // При сдвиге сущности двигаем весь столбец стека
  if (
    body.moveStackGroup !== false &&
    (nextPos !== existing.pos_x ||
      nextDepth !== existing.depth_row ||
      nextShelf !== existing.shelf_index)
  ) {
    const siblings = (
      db
        .prepare(
          `SELECT id FROM shelf_items
           WHERE rack_id = ? AND shelf_index = ? AND depth_row = ?
             AND pos_x = ?`,
        )
        .all(
          existing.rack_id,
          existing.shelf_index,
          existing.depth_row,
          existing.pos_x,
        ) as { id: number }[]
    ).map((r) => r.id);

    const siblingSet = new Set(siblings);
    const atTarget = (
      db
        .prepare(
          `SELECT id FROM shelf_items
           WHERE rack_id = ? AND shelf_index = ? AND depth_row = ?
             AND pos_x = ?`,
        )
        .all(existing.rack_id, nextShelf, nextDepth, nextPos) as { id: number }[]
    ).map((r) => r.id);
    const foreignAtTarget = atTarget.filter((tid) => !siblingSet.has(tid));

    // Слияние столбцов только через stackOntoId; иначе — свободная ячейка
    let movePos = nextPos;
    if (foreignAtTarget.length > 0) {
      movePos = allocateFreePosX(
        existing.rack_id,
        nextShelf,
        nextDepth,
        nextPos,
        existing.id,
      );
    }

    const move = db.prepare(
      `UPDATE shelf_items
       SET pos_x = ?, shelf_index = ?, depth_row = ?, width_ratio = COALESCE(?, width_ratio)
       WHERE id = ?`,
    );
    for (const sibId of siblings) {
      move.run(
        movePos,
        nextShelf,
        nextDepth,
        body.widthRatio !== undefined ? nextWidth : null,
        sibId,
      );
    }

    if (hasInfoPatch || body.stackOrder !== undefined) {
      updateItemStmt.run(
        nextWidth,
        movePos,
        nextShelf,
        nextDepth,
        nextStackOrder,
        nextTitle,
        nextDetails,
        nextQuantity,
        nextInfoUpdatedAt,
        id,
      );
    }
  } else {
    // Отделение / одиночный перенос: нельзя встать на чужой pos_x (это склеило бы стеки)
    let soloPos = nextPos;
    if (
      nextPos !== existing.pos_x ||
      nextDepth !== existing.depth_row ||
      nextShelf !== existing.shelf_index
    ) {
      const othersAtTarget = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM shelf_items
             WHERE rack_id = ? AND shelf_index = ? AND depth_row = ?
               AND pos_x = ? AND id != ?`,
          )
          .get(
            existing.rack_id,
            nextShelf,
            nextDepth,
            nextPos,
            id,
          ) as { n: number }
      ).n;
      if (othersAtTarget > 0) {
        soloPos = allocateFreePosX(
          existing.rack_id,
          nextShelf,
          nextDepth,
          nextPos,
          id,
        );
      }
    }

    updateItemStmt.run(
      nextWidth,
      soloPos,
      nextShelf,
      nextDepth,
      nextStackOrder,
      nextTitle,
      nextDetails,
      nextQuantity,
      nextInfoUpdatedAt,
      id,
    );
  }

  const row = getItemStmt.get(id) as ShelfItemRow;
  return mapShelfItem(row);
});

app.delete<{ Params: { id: string } }>(
  "/api/shelf-items/:id",
  async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "Некорректный id" });
    }

    const result = deleteItemStmt.run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: "Сущность не найдена" });
    }

    return reply.code(204).send();
  },
);

app.get<{ Params: { id: string } }>(
  "/api/shelf-items/:id/contents",
  async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      return reply.code(400).send({ error: "Некорректный id" });
    }
    const existing = getItemStmt.get(id) as ShelfItemRow | undefined;
    if (!existing) {
      return reply.code(404).send({ error: "Сущность не найдена" });
    }
    return { items: contentsForItem(id) };
  },
);

app.put<{
  Params: { id: string };
  Body: {
    items?: {
      kind: ContentKind;
      refId: number;
      nameSnapshot: string;
      typeSnapshot?: string;
      quantity?: string;
    }[];
  };
}>("/api/shelf-items/:id/contents", async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    return reply.code(400).send({ error: "Некорректный id" });
  }
  const existing = getItemStmt.get(id) as ShelfItemRow | undefined;
  if (!existing) {
    return reply.code(404).send({ error: "Сущность не найдена" });
  }

  const raw = Array.isArray(request.body?.items) ? request.body.items : null;
  if (!raw) {
    return reply.code(400).send({ error: "Ожидается items: []" });
  }

  const normalized: {
    kind: ContentKind;
    refId: number;
    nameSnapshot: string;
    typeSnapshot: string;
    quantity: string;
  }[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const kind = entry?.kind;
    const refId = Number(entry?.refId);
    const nameSnapshot =
      typeof entry?.nameSnapshot === "string" ? entry.nameSnapshot.trim() : "";
    if (kind !== "component" && kind !== "product") {
      return reply.code(400).send({ error: "Некорректный kind" });
    }
    if (!Number.isInteger(refId) || refId <= 0) {
      return reply.code(400).send({ error: "Некорректный refId" });
    }
    if (!nameSnapshot) {
      return reply.code(400).send({ error: "Укажите nameSnapshot" });
    }
    const key = `${kind}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      kind,
      refId,
      nameSnapshot: nameSnapshot.slice(0, 200),
      typeSnapshot:
        typeof entry?.typeSnapshot === "string"
          ? entry.typeSnapshot.trim().slice(0, 120)
          : "",
      quantity:
        typeof entry?.quantity === "string" ? entry.quantity.trim().slice(0, 80) : "",
    });
  }

  try {
    db.exec("BEGIN IMMEDIATE");
    deleteContentsForItemStmt.run(id);
    for (const row of normalized) {
      insertContentStmt.run(
        id,
        row.kind,
        row.refId,
        row.nameSnapshot,
        row.typeSnapshot,
        row.quantity,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }

  return { items: contentsForItem(id) };
});

app.post<{
  Body: {
    updates?: {
      kind: ContentKind;
      refId: number;
      nameSnapshot?: string;
      typeSnapshot?: string;
    }[];
  };
}>("/api/catalog/sync-names", async (request, reply) => {
  const raw = Array.isArray(request.body?.updates) ? request.body.updates : null;
  if (!raw) {
    return reply.code(400).send({ error: "Ожидается updates: []" });
  }

  const updateName = db.prepare(
    `UPDATE shelf_item_contents SET name_snapshot = ? WHERE kind = ? AND ref_id = ?`,
  );
  const updateType = db.prepare(
    `UPDATE shelf_item_contents SET type_snapshot = ? WHERE kind = ? AND ref_id = ?`,
  );

  let changed = 0;
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const entry of raw) {
      const kind = entry?.kind;
      const refId = Number(entry?.refId);
      if (kind !== "component" && kind !== "product") continue;
      if (!Number.isInteger(refId) || refId <= 0) continue;
      if (typeof entry.nameSnapshot === "string" && entry.nameSnapshot.trim()) {
        const r = updateName.run(entry.nameSnapshot.trim().slice(0, 200), kind, refId);
        changed += Number(r.changes ?? 0);
      }
      if (typeof entry.typeSnapshot === "string") {
        const r = updateType.run(entry.typeSnapshot.trim().slice(0, 120), kind, refId);
        changed += Number(r.changes ?? 0);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }

  return { ok: true, changed };
});

app.get<{ Querystring: { q?: string } }>("/api/search", async (request, reply) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (!q) {
    return { items: [] };
  }
  if (q.length > 120) {
    return reply.code(400).send({ error: "Слишком длинный запрос" });
  }

  const like = `%${q}%`;
  const hitIds = new Set<number>();

  for (const row of db
    .prepare(
      `SELECT DISTINCT shelf_item_id AS id FROM shelf_item_contents
       WHERE name_snapshot LIKE ? COLLATE NOCASE
          OR type_snapshot LIKE ? COLLATE NOCASE`,
    )
    .all(like, like) as { id: number }[]) {
    hitIds.add(row.id);
  }

  for (const row of db
    .prepare(
      `SELECT id FROM shelf_items
       WHERE title LIKE ? COLLATE NOCASE
          OR details LIKE ? COLLATE NOCASE
          OR quantity LIKE ? COLLATE NOCASE`,
    )
    .all(like, like, like) as { id: number }[]) {
    hitIds.add(row.id);
  }

  const catalog = findCatalogMatches(q);
  if (catalog.componentIds.length > 0) {
    const ph = catalog.componentIds.map(() => "?").join(",");
    for (const row of db
      .prepare(
        `SELECT DISTINCT shelf_item_id AS id FROM shelf_item_contents
         WHERE kind = 'component' AND ref_id IN (${ph})`,
      )
      .all(...catalog.componentIds) as { id: number }[]) {
      hitIds.add(row.id);
    }
  }
  if (catalog.productIds.length > 0) {
    const ph = catalog.productIds.map(() => "?").join(",");
    for (const row of db
      .prepare(
        `SELECT DISTINCT shelf_item_id AS id FROM shelf_item_contents
         WHERE kind = 'product' AND ref_id IN (${ph})`,
      )
      .all(...catalog.productIds) as { id: number }[]) {
      hitIds.add(row.id);
    }
  }

  if (hitIds.size === 0) {
    return { items: [] };
  }

  const ids = [...hitIds].slice(0, 100);
  const ph = ids.map(() => "?").join(",");
  const itemRows = db
    .prepare(
      `SELECT i.id, i.rack_id, i.shelf_index, i.type, i.width_ratio, i.pos_x, i.depth_row,
              i.stack_order, i.title, i.details, i.quantity, i.info_updated_at,
              o.label AS rack_label
       FROM shelf_items i
       LEFT JOIN map_objects o ON o.id = i.rack_id
       WHERE i.id IN (${ph})
       ORDER BY o.label COLLATE NOCASE ASC, i.shelf_index ASC, i.id ASC`,
    )
    .all(...ids) as (ShelfItemRow & { rack_label: string | null })[];

  const contentsMap = contentsByItemIds(ids);
  const qLower = q.toLowerCase();

  return {
    items: itemRows.map((row) => {
      const contents = contentsMap.get(row.id) ?? [];
      const matchedContents = contents.filter(
        (c) =>
          c.nameSnapshot.toLowerCase().includes(qLower) ||
          c.typeSnapshot.toLowerCase().includes(qLower) ||
          (c.kind === "component" && catalog.componentIds.includes(c.refId)) ||
          (c.kind === "product" && catalog.productIds.includes(c.refId)),
      );
      return {
        shelfItemId: row.id,
        rackId: row.rack_id,
        rackLabel: row.rack_label || `Стеллаж #${row.rack_id}`,
        shelfIndex: row.shelf_index,
        itemType: row.type,
        title: row.title ?? "",
        details: row.details ?? "",
        quantity: row.quantity ?? "",
        matchedContents:
          matchedContents.length > 0 ? matchedContents : contents.slice(0, 5),
      };
    }),
  };
});

function defaultLabel(type: ObjectType) {
  switch (type) {
    case "rack":
      return "Стеллаж";
    case "pallet":
      return "Паллет";
    case "zone":
      return "Зона";
    case "wall":
      return "Стена";
    case "window":
      return "Окно";
    case "door":
      return "Дверь";
    case "table":
      return "Стол";
    case "chair":
      return "Стул";
  }
}

type PalletItemRow = {
  id: number;
  pallet_id: number;
  title: string;
  details: string;
  quantity: string;
  kind: string | null;
  ref_id: number | null;
  name_snapshot: string;
  type_snapshot: string;
  sort_order: number;
};

function mapPalletItem(row: PalletItemRow) {
  return {
    id: row.id,
    palletId: row.pallet_id,
    title: row.title ?? "",
    details: row.details ?? "",
    quantity: row.quantity ?? "",
    kind: row.kind === "product" || row.kind === "component" ? row.kind : null,
    refId: row.ref_id,
    nameSnapshot: row.name_snapshot ?? "",
    typeSnapshot: row.type_snapshot ?? "",
    sortOrder: row.sort_order ?? 0,
  };
}

app.get<{ Params: { id: string } }>(
  "/api/pallets/:id/items",
  async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.code(400).send({ error: "Неверный ID" });
    }
    const obj = getStmt.get(id) as ObjectRow | undefined;
    if (!obj || obj.type !== "pallet") {
      return reply.code(404).send({ error: "Паллет не найден" });
    }
    const rows = db
      .prepare(
        `SELECT * FROM pallet_items WHERE pallet_id = ? ORDER BY sort_order ASC, id ASC`,
      )
      .all(id) as PalletItemRow[];
    return { items: rows.map(mapPalletItem) };
  },
);

app.put<{
  Params: { id: string };
  Body: {
    items?: Array<{
      title?: string;
      details?: string;
      quantity?: string;
      kind?: "component" | "product" | null;
      refId?: number | null;
      nameSnapshot?: string;
      typeSnapshot?: string;
    }>;
  };
}>("/api/pallets/:id/items", async (request, reply) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return reply.code(400).send({ error: "Неверный ID" });
  }
  const obj = getStmt.get(id) as ObjectRow | undefined;
  if (!obj || obj.type !== "pallet") {
    return reply.code(404).send({ error: "Паллет не найден" });
  }
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  if (items.length > 100) {
    return reply.code(400).send({ error: "Слишком много позиций" });
  }

  const del = db.prepare(`DELETE FROM pallet_items WHERE pallet_id = ?`);
  const ins = db.prepare(
    `INSERT INTO pallet_items (
      pallet_id, title, details, quantity, kind, ref_id, name_snapshot, type_snapshot, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    withTransaction(() => {
      del.run(id);
      items.forEach((item, index) => {
        const title = String(item.title ?? "").trim();
        const nameSnapshot = String(item.nameSnapshot ?? title).trim();
        const displayTitle = title || nameSnapshot;
        if (!displayTitle) return;
        ins.run(
          id,
          displayTitle,
          String(item.details ?? "").trim(),
          String(item.quantity ?? "").trim(),
          item.kind === "component" || item.kind === "product" ? item.kind : null,
          typeof item.refId === "number" ? item.refId : null,
          nameSnapshot || displayTitle,
          String(item.typeSnapshot ?? "").trim(),
          index,
        );
      });
    });
  } catch (err) {
    return reply
      .code(500)
      .send({
        error:
          err instanceof Error ? err.message : "Не удалось сохранить позиции",
      });
  }

  const rows = db
    .prepare(
      `SELECT * FROM pallet_items WHERE pallet_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .all(id) as PalletItemRow[];
  return { items: rows.map(mapPalletItem) };
});

const port = Number(process.env.PORT ?? 3003);
const host = process.env.HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(`Stockmap API on http://${host}:${port}`);
