import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { migrate } from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? "./data/app.db";
  const absolutePath = path.resolve(dbPath);
  const dir = path.dirname(absolutePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(absolutePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schemaPath = [path.join(__dirname, "schema.sql"), path.join(process.cwd(), "src/db/schema.sql")]
    .find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error("schema.sql not found");
  }

  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  migrate(db);

  return db;
}

export function runTransaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
