import { Router } from "express";
import fs from "fs";
import { z } from "zod";
import {
  createNewsPost,
  deleteNewsPost,
  getNewsPost,
  getNewsPostDetail,
  listNewsPosts,
  markNewsRead,
  updateNewsPost,
} from "../db/queries/news.js";
import {
  commitPatchVersion,
  getPatchReleaseByDay,
  peekNextVersion,
  recordPatchRelease,
} from "../db/queries/settings.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { hasPermission } from "../permissions/access.js";
import { objectPerm } from "../permissions/catalog.js";
import { isRoot } from "../types.js";
import { sanitizeNewsHtml } from "../utils/sanitizeHtml.js";
import {
  extractUpdatesSection,
  moscowToday,
  resolveUpdatesMdPath,
  updatesMarkdownToNewsHtml,
} from "../utils/updatesSheet.js";
import { runTransaction } from "../db/index.js";
import { getAllUsers } from "../db/queries/users.js";
import { notifyUsers } from "../services/notify.js";

const router = Router();

const postSchema = z.object({
  title: z.string().trim().min(1, "Укажите заголовок").max(200),
  body_html: z.string().max(50_000).optional().default(""),
  patch: z
    .object({
      version: z.string().regex(/^\d+\.\d+\.\d+$/, "Неверная версия"),
      release_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      global: z.boolean(),
    })
    .optional(),
});

function denyUnlessApp(req: AuthRequest, res: import("express").Response) {
  if (!req.user) {
    res.status(401).json({ error: "Не авторизован" });
    return false;
  }
  if (!hasPermission(req.user, "app.news")) {
    res.status(403).json({ error: "Недостаточно прав" });
    return false;
  }
  return true;
}

function canManageAny(req: AuthRequest): boolean {
  if (!req.user) return false;
  return isRoot(req.user) || hasPermission(req.user, "news.manage_any");
}

function canReleasePatch(req: AuthRequest): boolean {
  if (!req.user) return false;
  return (
    isRoot(req.user) ||
    hasPermission(req.user, "news.release_patch") ||
    hasPermission(req.user, "news.manage_any")
  );
}

function canEditPost(req: AuthRequest, authorId: number): boolean {
  if (!req.user) return false;
  if (canManageAny(req)) return true;
  return req.user.id === authorId && hasPermission(req.user, "news.edit_own");
}

function canDeletePost(req: AuthRequest, authorId: number): boolean {
  if (!req.user) return false;
  if (canManageAny(req)) return true;
  return req.user.id === authorId && hasPermission(req.user, "news.delete_own");
}

function notifyNewsCreated(authorId: number, title: string, postId: number) {
  const recipients = getAllUsers()
    .map((u) => u.id)
    .filter((id) => id !== authorId);
  if (recipients.length === 0) return;
  void notifyUsers(recipients, "news_new", {
    title: "Новая новость",
    body: title,
    url: `/news/${postId}`,
    tag: `news-${postId}`,
  });
}

function buildPatchDraftBody():
  | { ok: true; body_html: string; heading_ru: string; day_key: string }
  | { ok: false; status: number; error: string } {
  const { dayKey, headingRu } = moscowToday();
  const mdPath = resolveUpdatesMdPath();
  if (!mdPath) {
    return { ok: false, status: 500, error: "Файл ОБНОВЛЕНИЯ.md не найден на сервере" };
  }
  let markdown: string;
  try {
    markdown = fs.readFileSync(mdPath, "utf-8");
  } catch {
    return { ok: false, status: 500, error: "Не удалось прочитать ОБНОВЛЕНИЯ.md" };
  }
  const section = extractUpdatesSection(markdown, headingRu);
  if (!section) {
    return {
      ok: false,
      status: 400,
      error: `В ОБНОВЛЕНИЯ.md нет раздела «${headingRu}». Добавьте правки за сегодня и повторите.`,
    };
  }
  const body_html = sanitizeNewsHtml(updatesMarkdownToNewsHtml(section));
  if (!body_html.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").trim()) {
    return { ok: false, status: 400, error: "Раздел обновлений за сегодня пуст" };
  }
  return { ok: true, body_html, heading_ru: headingRu, day_key: dayKey };
}

router.use(requireAuth);

router.get("/", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  if (!hasPermission(req.user!, objectPerm("news", "posts", "view"))) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  res.json({ items: listNewsPosts(req.user!.id) });
});

/** Preview draft for the patch-note editor (does not publish). */
router.get("/patch-draft", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  if (!canReleasePatch(req)) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }

  const { dayKey } = moscowToday();
  const existing = getPatchReleaseByDay(dayKey);
  if (existing) {
    res.status(409).json({
      error: `Патчноут за сегодня уже выпущен (v${existing.version})`,
      post_id: existing.post_id,
      version: existing.version,
    });
    return;
  }

  const draft = buildPatchDraftBody();
  if (!draft.ok) {
    res.status(draft.status).json({ error: draft.error });
    return;
  }

  const version_patch = peekNextVersion("patch");
  const version_global = peekNextVersion("minor");
  res.json({
    body_html: draft.body_html,
    heading_ru: draft.heading_ru,
    day_key: draft.day_key,
    version_patch,
    version_global,
    title_patch: `Патчноут ${version_patch} · ${draft.heading_ru}`,
    title_global: `Патчноут ${version_global} · ${draft.heading_ru}`,
  });
});

router.get("/:id", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  if (!hasPermission(req.user!, objectPerm("news", "posts", "view"))) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const existing = getNewsPost(id);
  if (!existing) {
    res.status(404).json({ error: "Новость не найдена" });
    return;
  }
  markNewsRead(id, req.user!.id);
  const item = getNewsPostDetail(id, req.user!.id);
  res.json({ item });
});

router.post("/", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }

  const isPatch = Boolean(parsed.data.patch);
  if (isPatch) {
    if (!canReleasePatch(req)) {
      res.status(403).json({ error: "Недостаточно прав" });
      return;
    }
  } else if (!hasPermission(req.user!, objectPerm("news", "posts", "create"))) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }

  const body_html = sanitizeNewsHtml(parsed.data.body_html);
  if (!body_html.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").trim()) {
    res.status(400).json({ error: "Напишите текст новости" });
    return;
  }

  if (parsed.data.patch) {
    const { version, release_day } = parsed.data.patch;
    const existing = getPatchReleaseByDay(release_day);
    if (existing) {
      res.status(409).json({
        error: `Патчноут за сегодня уже выпущен (v${existing.version})`,
        post_id: existing.post_id,
        version: existing.version,
      });
      return;
    }
    const expected = peekNextVersion(parsed.data.patch.global ? "minor" : "patch");
    if (version !== expected) {
      res.status(400).json({
        error: `Версия устарела. Ожидалась ${expected}. Откройте черновик заново.`,
      });
      return;
    }
    try {
      const item = runTransaction(() => {
        const created = createNewsPost({
          title: parsed.data.title,
          body_html,
          author_id: req.user!.id,
        });
        recordPatchRelease({
          version,
          release_day,
          post_id: created.id,
        });
        commitPatchVersion(version);
        return created;
      });
      notifyNewsCreated(req.user!.id, item.title, item.id);
      res.status(201).json({ item, version });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось выпустить патчноут";
      res.status(500).json({ error: message });
      return;
    }
  }

  const item = createNewsPost({
    title: parsed.data.title,
    body_html,
    author_id: req.user!.id,
  });
  notifyNewsCreated(req.user!.id, item.title, item.id);
  res.status(201).json({ item });
});

router.patch("/:id", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const existing = getNewsPost(id);
  if (!existing) {
    res.status(404).json({ error: "Новость не найдена" });
    return;
  }
  if (!canEditPost(req, existing.author_id)) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  const body_html = sanitizeNewsHtml(parsed.data.body_html);
  if (!body_html.replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, "").trim()) {
    res.status(400).json({ error: "Напишите текст новости" });
    return;
  }
  updateNewsPost(id, { title: parsed.data.title, body_html });
  const item = getNewsPostDetail(id, req.user!.id);
  res.json({ item });
});

router.delete("/:id", (req: AuthRequest, res) => {
  if (!denyUnlessApp(req, res)) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const existing = getNewsPost(id);
  if (!existing) {
    res.status(404).json({ error: "Новость не найдена" });
    return;
  }
  if (!canDeletePost(req, existing.author_id)) {
    res.status(403).json({ error: "Недостаточно прав" });
    return;
  }
  deleteNewsPost(id);
  res.json({ ok: true });
});

export default router;
