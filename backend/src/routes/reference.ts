import { Router } from "express";
import { z } from "zod";
import {
  createComponent,
  createProduct,
  createTag,
  deleteComponent,
  deleteProduct,
  deleteTag,
  getComponent,
  getProduct,
  getTag,
  listComponents,
  listComponentsByProduct,
  listComponentIdsByType,
  listProducts,
  listTags,
  updateComponent,
  updateProduct,
  updateTag,
} from "../db/queries/reference.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { hasPermission } from "../permissions/access.js";
import { objectPerm } from "../permissions/catalog.js";
import type { CrudAction } from "../permissions/catalog.js";
import { syncStockmapCatalogNames } from "../services/stockmapSync.js";

const router = Router();

const nameSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(120),
});

const productSchema = nameSchema.extend({
  tag: z.string().trim().min(1, "Укажите короткий тег").max(40),
});

const componentSchema = nameSchema.extend({
  product_links: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        display_as: z.enum(["name", "tag"]),
      })
    )
    .optional(),
  product_ids: z.array(z.number().int().positive()).optional().default([]),
  type_id: z.number().int().positive().nullable().optional(),
  type_name: z.string().trim().max(120).nullable().optional(),
});

function denyUnless(
  req: AuthRequest,
  res: import("express").Response,
  object: "products" | "components" | "tags",
  action: CrudAction
) {
  if (!req.user) {
    res.status(401).json({ error: "Не авторизован" });
    return false;
  }
  if (!hasPermission(req.user, "app.reference")) {
    res.status(403).json({ error: "Недостаточно прав" });
    return false;
  }
  if (!hasPermission(req.user, objectPerm("reference", object, action))) {
    res.status(403).json({ error: "Недостаточно прав" });
    return false;
  }
  return true;
}

/** List catalog for warehouse map (and full reference viewers). */
function canReadCatalog(req: AuthRequest): boolean {
  if (!req.user) return false;
  if (hasPermission(req.user, "reference.catalog.read")) return true;
  if (!hasPermission(req.user, "app.reference")) return false;
  return (
    hasPermission(req.user, objectPerm("reference", "products", "view")) ||
    hasPermission(req.user, objectPerm("reference", "components", "view")) ||
    hasPermission(req.user, objectPerm("reference", "components", "create")) ||
    hasPermission(req.user, objectPerm("reference", "components", "edit")) ||
    hasPermission(req.user, objectPerm("reference", "tags", "view"))
  );
}

function denyUnlessCatalogRead(req: AuthRequest, res: import("express").Response) {
  if (!req.user) {
    res.status(401).json({ error: "Не авторизован" });
    return false;
  }
  if (!canReadCatalog(req)) {
    res.status(403).json({ error: "Недостаточно прав" });
    return false;
  }
  return true;
}

router.use(requireAuth);

router.get("/products", (req: AuthRequest, res) => {
  if (!denyUnlessCatalogRead(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json({ items: listProducts(q) });
});

router.get("/products/:id/components", (req: AuthRequest, res) => {
  if (!denyUnlessCatalogRead(req, res)) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const product = getProduct(id);
  if (!product) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ product, items: listComponentsByProduct(id) });
});

router.post("/products", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "products", "create")) return;
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  try {
    const item = createProduct({
      name: parsed.data.name,
      tag: parsed.data.tag,
      created_by: req.user!.id,
    });
    res.status(201).json({ item });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Ошибка создания" });
  }
});

router.patch("/products/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "products", "edit")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  if (!getProduct(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  try {
    const item = updateProduct(id, parsed.data);
    if (item) {
      syncStockmapCatalogNames(req, [
        { kind: "product", refId: item.id, nameSnapshot: item.name },
      ]);
    }
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Ошибка сохранения" });
  }
});

router.delete("/products/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "products", "delete")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  if (!deleteProduct(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ ok: true });
});

router.get("/tags", (req: AuthRequest, res) => {
  if (!denyUnlessCatalogRead(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json({ items: listTags(q) });
});

router.post("/tags", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "tags", "create")) return;
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  const item = createTag({ name: parsed.data.name, created_by: req.user!.id });
  res.status(201).json({ item });
});

router.patch("/tags/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "tags", "edit")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  if (!getTag(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  const item = updateTag(id, parsed.data);
  if (item) {
    const componentIds = listComponentIdsByType(item.id);
    syncStockmapCatalogNames(
      req,
      componentIds.map((refId) => ({
        kind: "component" as const,
        refId,
        typeSnapshot: item.name,
      }))
    );
  }
  res.json({ item });
});

router.delete("/tags/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "tags", "delete")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  if (!deleteTag(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ ok: true });
});

router.get("/components", (req: AuthRequest, res) => {
  if (!denyUnlessCatalogRead(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json({ items: listComponents(q) });
});

router.post("/components", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "components", "create")) return;
  const parsed = componentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  const item = createComponent({
    name: parsed.data.name,
    created_by: req.user!.id,
    product_links: parsed.data.product_links,
    product_ids: parsed.data.product_ids,
    type_id: parsed.data.type_id ?? null,
    type_name: parsed.data.type_name ?? null,
  });
  res.status(201).json({ item });
});

router.patch("/components/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "components", "edit")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  const parsed = componentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Неверные данные" });
    return;
  }
  if (!getComponent(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  const item = updateComponent(id, {
    name: parsed.data.name,
    product_links: parsed.data.product_links,
    product_ids: parsed.data.product_ids,
    type_id: parsed.data.type_id ?? null,
    type_name: parsed.data.type_name ?? null,
  });
  if (item) {
    syncStockmapCatalogNames(req, [
      {
        kind: "component",
        refId: item.id,
        nameSnapshot: item.name,
        typeSnapshot: item.type?.name ?? "",
      },
    ]);
  }
  res.json({ item });
});

router.delete("/components/:id", (req: AuthRequest, res) => {
  if (!denyUnless(req, res, "components", "delete")) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Неверный ID" });
    return;
  }
  if (!deleteComponent(id)) {
    res.status(404).json({ error: "Не найдено" });
    return;
  }
  res.json({ ok: true });
});

export default router;
