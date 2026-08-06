import { getDb } from "../index.js";

export type PresetKind = "task" | "checklist";
export type PresetPriority = "low" | "medium" | "high";

export interface Preset {
  id: number;
  created_by: number;
  kind: PresetKind;
  name: string;
  title: string;
  description: string;
  priority: PresetPriority | null;
  has_deadline: boolean | null;
  items: string[];
  created_at: string;
}

interface PresetRow {
  id: number;
  created_by: number;
  kind: PresetKind;
  name: string;
  title: string;
  description: string;
  priority: PresetPriority | null;
  has_deadline: number | null;
  items_json: string;
  created_at: string;
}

function parseItems(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function mapRow(row: PresetRow): Preset {
  return {
    id: row.id,
    created_by: row.created_by,
    kind: row.kind,
    name: row.name,
    title: row.title,
    description: row.description,
    priority: row.priority,
    has_deadline: row.has_deadline === null ? null : Boolean(row.has_deadline),
    items: parseItems(row.items_json),
    created_at: row.created_at,
  };
}

export function listPresets(createdBy: number, kind?: PresetKind): Preset[] {
  const db = getDb();
  const rows = kind
    ? (db
        .prepare(
          "SELECT * FROM presets WHERE created_by = ? AND kind = ? ORDER BY name COLLATE NOCASE"
        )
        .all(createdBy, kind) as unknown as PresetRow[])
    : (db
        .prepare("SELECT * FROM presets WHERE created_by = ? ORDER BY kind, name COLLATE NOCASE")
        .all(createdBy) as unknown as PresetRow[]);
  return rows.map(mapRow);
}

export function getPresetById(id: number): Preset | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as unknown as
    | PresetRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createPreset(input: {
  created_by: number;
  kind: PresetKind;
  name: string;
  title: string;
  description?: string;
  priority?: PresetPriority | null;
  has_deadline?: boolean | null;
  items?: string[];
}): Preset {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO presets (created_by, kind, name, title, description, priority, has_deadline, items_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.created_by,
      input.kind,
      input.name,
      input.title,
      input.description ?? "",
      input.kind === "task" ? (input.priority ?? "medium") : null,
      input.kind === "checklist" ? (input.has_deadline === false ? 0 : 1) : null,
      JSON.stringify(input.kind === "checklist" ? input.items ?? [] : [])
    );
  return getPresetById(Number(result.lastInsertRowid))!;
}

export function updatePreset(
  id: number,
  input: {
    name: string;
    title: string;
    description?: string;
    priority?: PresetPriority | null;
    has_deadline?: boolean | null;
    items?: string[];
  }
): Preset | null {
  const existing = getPresetById(id);
  if (!existing) return null;

  const db = getDb();
  db.prepare(
    `UPDATE presets
     SET name = ?, title = ?, description = ?, priority = ?, has_deadline = ?, items_json = ?
     WHERE id = ?`
  ).run(
    input.name,
    input.title,
    input.description ?? "",
    existing.kind === "task" ? (input.priority ?? "medium") : null,
    existing.kind === "checklist" ? (input.has_deadline === false ? 0 : 1) : null,
    JSON.stringify(existing.kind === "checklist" ? input.items ?? [] : []),
    id
  );
  return getPresetById(id);
}

export function deletePreset(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM presets WHERE id = ?").run(id);
  return result.changes > 0;
}
