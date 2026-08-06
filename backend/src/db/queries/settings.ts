import { getDb } from "../index.js";

const VERSION_KEY = "news_patch_version";

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export type VersionBump = "patch" | "minor";

/** Current stored version, or null if never released. */
export function getCurrentPatchVersion(): string | null {
  const current = getSetting(VERSION_KEY);
  if (!current) return null;
  return /^\d+\.\d+\.\d+$/.test(current.trim()) ? current.trim() : null;
}

/**
 * Next semver without writing.
 * - patch (обычное): 1.0.0 → 1.0.1
 * - minor (глобальное): 1.0.0 → 1.1.0
 * First ever release → 1.0.0 for both.
 */
export function peekNextVersion(bump: VersionBump): string {
  const current = getCurrentPatchVersion();
  if (!current) return "1.0.0";
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "1.0.0";
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/** @deprecated use peekNextVersion('patch') */
export function peekNextPatchVersion(): string {
  return peekNextVersion("patch");
}

export function commitPatchVersion(version: string): void {
  setSetting(VERSION_KEY, version);
}

export function getPatchReleaseByDay(releaseDay: string): {
  id: number;
  version: string;
  post_id: number;
} | null {
  const row = getDb()
    .prepare(
      `SELECT id, version, post_id FROM news_patch_releases WHERE release_day = ?`
    )
    .get(releaseDay) as
    | { id: number; version: string; post_id: number }
    | undefined;
  return row ?? null;
}

export function recordPatchRelease(data: {
  version: string;
  release_day: string;
  post_id: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO news_patch_releases (version, release_day, post_id)
       VALUES (?, ?, ?)`
    )
    .run(data.version, data.release_day, data.post_id);
}

export { VERSION_KEY };
