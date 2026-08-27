import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/** Keep in sync with frontend/src/utils/imageUpload.ts */
export const IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type UploadKind = "avatars" | "misc";

/** Same tree as SQLite (`./data/…`) so deploy data backup keeps avatars. */
function resolveUploadsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const dbPath = process.env.DB_PATH?.trim() || "./data/app.db";
  const dataDir = path.dirname(path.resolve(dbPath));
  return path.join(dataDir, "uploads");
}

const rootDir = resolveUploadsRoot();

export function uploadsRoot(): string {
  return rootDir;
}

export function ensureUploadDirs(): void {
  for (const kind of ["avatars", "misc"] as const) {
    fs.mkdirSync(path.join(rootDir, kind), { recursive: true });
  }
}

export function saveUploadBuffer(opts: {
  kind: UploadKind;
  buffer: Buffer;
  mime: string;
}): { url: string; filename: string } {
  if (!ALLOWED_IMAGE_MIMES.has(opts.mime)) {
    throw new Error("Допустимы только JPEG, PNG или WebP");
  }
  if (opts.buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error("Файл слишком большой (макс. 2 МБ)");
  }
  const ext = MIME_EXT[opts.mime] ?? ".bin";
  const filename = `${randomUUID()}${ext}`;
  const dir = path.join(rootDir, opts.kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), opts.buffer);
  return {
    filename,
    url: `/api/uploads/${opts.kind}/${filename}`,
  };
}

export function deleteUploadByUrl(url: string | null | undefined): void {
  if (!url) return;
  const match = /^\/api\/uploads\/(avatars|misc)\/([A-Za-z0-9._-]+)$/.exec(url);
  if (!match) return;
  const filePath = path.join(rootDir, match[1], match[2]);
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* already gone */
  }
}
