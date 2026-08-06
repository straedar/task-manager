import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BookOpen, MapPin, Pencil, Search, Trash2, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { api } from "../api/client";
import { objectPerm } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import { ReferenceBottomNav } from "../components/ReferenceBottomNav";
import { Select } from "../components/Select";
import { ThemeSwitch } from "../components/ThemeSwitch";
import type {
  ProductLabelKind,
  ReferenceComponent,
  ReferenceKind,
  ReferenceProduct,
  ReferenceTag,
} from "../types";

const TABS: { id: ReferenceKind; label: string }[] = [
  { id: "products", label: "Готовая продукция" },
  { id: "components", label: "Комплектующие" },
];

const NEW_TYPE_VALUE = "__new__";

type ProductLinkDraft = { productId: number; displayAs: ProductLabelKind };

function shortTag(p: ReferenceProduct): string {
  return (p.tag || p.name).trim();
}

function linkLabel(p: ReferenceProduct, displayAs: ProductLabelKind): string {
  return displayAs === "name" ? p.name : shortTag(p);
}

export function ReferencePage() {
  const { user, loading: authLoading, can } = useAuth();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ReferenceKind>("products");
  const [products, setProducts] = useState<ReferenceProduct[]>([]);
  const [components, setComponents] = useState<ReferenceComponent[]>([]);
  const [allProducts, setAllProducts] = useState<ReferenceProduct[]>([]);
  const [allTags, setAllTags] = useState<ReferenceTag[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<
    | { type: "create-product" }
    | { type: "edit-product"; item: ReferenceProduct }
    | { type: "create-component" }
    | { type: "edit-component"; item: ReferenceComponent }
    | null
  >(null);
  const [productDrill, setProductDrill] = useState<{
    product: ReferenceProduct;
    items: ReferenceComponent[];
    loading: boolean;
  } | null>(null);
  const [name, setName] = useState("");
  const [productLinks, setProductLinks] = useState<ProductLinkDraft[]>([]);
  const [typeSelect, setTypeSelect] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [productPickerQuery, setProductPickerQuery] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [productTag, setProductTag] = useState("");
  const [saving, setSaving] = useState(false);

  const canView = can(objectPerm("reference", tab, "view"));
  const canCreate = can(objectPerm("reference", tab, "create"));
  const canEdit = can(objectPerm("reference", tab, "edit"));
  const canDelete = can(objectPerm("reference", tab, "delete"));
  const canEditTags = can(objectPerm("reference", "tags", "edit"));
  const canDeleteTags = can(objectPerm("reference", "tags", "delete"));
  const canOpenStockmap = can("app.stockmap") || can("stockmap.view");

  const openOnMap = (query: string) => {
    const q = query.trim();
    if (!q || !canOpenStockmap) return;
    navigate(`/stockmap?q=${encodeURIComponent(q)}`);
  };

  const visibleTabs = useMemo(
    () => TABS.filter((t) => can(objectPerm("reference", t.id, "view"))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user]
  );

  const typeOptions = useMemo(
    () => [
      { value: "", label: "Без типа", depth: 0, isRoot: false },
      ...allTags.map((t) => ({ value: String(t.id), label: t.name, depth: 0, isRoot: false })),
      { value: NEW_TYPE_VALUE, label: "＋ Новый тип…", depth: 0, isRoot: false },
    ],
    [allTags]
  );

  const selectedLinkChips = useMemo(() => {
    return productLinks
      .map((link) => {
        const p = allProducts.find((x) => x.id === link.productId);
        if (!p) return null;
        return {
          productId: link.productId,
          displayAs: link.displayAs,
          label: linkLabel(p, link.displayAs),
          title: link.displayAs === "name" ? "Полное название" : "Короткий тег",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [allProducts, productLinks]);

  const pickerOptions = useMemo(() => {
    const q = productPickerQuery.trim().toLowerCase();
    if (!showAllProducts && !q) return [];
    const base = q
      ? allProducts.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || shortTag(p).toLowerCase().includes(q)
        )
      : allProducts;

    const options: {
      key: string;
      productId: number;
      displayAs: ProductLabelKind;
      label: string;
      hint: string;
    }[] = [];

    for (const p of base) {
      const tag = shortTag(p);
      const same = tag.toLowerCase() === p.name.toLowerCase();
      options.push({
        key: `${p.id}-name`,
        productId: p.id,
        displayAs: "name",
        label: p.name,
        hint: "полное название",
      });
      if (!same) {
        options.push({
          key: `${p.id}-tag`,
          productId: p.id,
          displayAs: "tag",
          label: tag,
          hint: "короткий тег",
        });
      }
    }
    return options;
  }, [allProducts, productPickerQuery, showAllProducts]);

  const load = useCallback(async () => {
    if (!can("app.reference")) return;
    setLoading(true);
    setError("");
    try {
      if (tab === "products" && can(objectPerm("reference", "products", "view"))) {
        const { items } = await api.listProducts(search);
        setProducts(items);
      } else if (tab === "components" && can(objectPerm("reference", "components", "view"))) {
        const [{ items }, productsRes, tagsRes] = await Promise.all([
          api.listComponents(search),
          can(objectPerm("reference", "products", "view"))
            ? api.listProducts()
            : Promise.resolve({ items: [] as ReferenceProduct[] }),
          can(objectPerm("reference", "tags", "view")) ||
          can(objectPerm("reference", "components", "create")) ||
          can(objectPerm("reference", "components", "edit"))
            ? api.listTags().catch(() => ({ items: [] as ReferenceTag[] }))
            : Promise.resolve({ items: [] as ReferenceTag[] }),
        ]);
        setComponents(items);
        setAllProducts(productsRes.items);
        setAllTags(tagsRes.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
      setProducts([]);
      setComponents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, user]);

  useEffect(() => {
    if (user && can("app.reference")) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, load]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.id === tab)) setTab(visibleTabs[0]!.id);
  }, [visibleTabs, tab]);

  useEffect(() => {
    setSearch("");
  }, [tab]);

  const canEditComponents = can(objectPerm("reference", "components", "edit"));

  const openProductComponents = async (item: ReferenceProduct) => {
    setProductDrill({ product: item, items: [], loading: true });
    setError("");
    try {
      const res = await api.listProductComponents(item.id);
      setProductDrill({ product: res.product, items: res.items, loading: false });
    } catch (err) {
      setProductDrill(null);
      setError(err instanceof Error ? err.message : "Ошибка загрузки комплектующих");
    }
  };

  const openCreate = () => {
    setName("");
    setProductTag("");
    setProductLinks([]);
    setTypeSelect("");
    setNewTypeName("");
    setEditingTagId(null);
    setEditingTagName("");
    setProductPickerQuery("");
    setShowAllProducts(false);
    setDialog(tab === "products" ? { type: "create-product" } : { type: "create-component" });
  };

  const openEditProduct = (item: ReferenceProduct) => {
    setName(item.name);
    setProductTag(item.tag || item.name);
    setDialog({ type: "edit-product", item });
  };

  const openEditComponent = (item: ReferenceComponent) => {
    setName(item.name);
    setProductLinks(
      item.products.map((p) => ({
        productId: p.id,
        displayAs: p.display_as === "name" ? "name" : "tag",
      }))
    );
    setTypeSelect(item.type_id ? String(item.type_id) : "");
    setNewTypeName("");
    setEditingTagId(null);
    setEditingTagName("");
    setProductPickerQuery("");
    setShowAllProducts(false);
    setDialog({ type: "edit-component", item });
  };

  const refreshTags = async () => {
    const tagsRes = await api.listTags().catch(() => ({ items: [] as ReferenceTag[] }));
    setAllTags(tagsRes.items);
  };

  const startEditTag = (tag: ReferenceTag) => {
    setTypeSelect(String(tag.id));
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setNewTypeName("");
  };

  const cancelEditTag = () => {
    setEditingTagId(null);
    setEditingTagName("");
  };

  const saveEditTag = async () => {
    if (editingTagId == null) return;
    const trimmed = editingTagName.trim();
    if (!trimmed) {
      setError("Укажите название типа");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.updateTag(editingTagId, { name: trimmed });
      cancelEditTag();
      await refreshTags();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка изменения типа");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async (tag: ReferenceTag) => {
    const ok = await confirm({
      title: `Удалить тип «${tag.name}»?`,
      description: "У комплектующих с этим типом тип будет сброшен.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteTag(tag.id);
      if (typeSelect === String(tag.id)) setTypeSelect("");
      if (editingTagId === tag.id) cancelEditTag();
      await refreshTags();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления типа");
    }
  };

  const closeDialog = () => setDialog(null);

  const toggleProductLink = (productId: number, displayAs: ProductLabelKind) => {
    setProductLinks((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing?.displayAs === displayAs) {
        return prev.filter((l) => l.productId !== productId);
      }
      const next = prev.filter((l) => l.productId !== productId);
      return [...next, { productId, displayAs }];
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    setSaving(true);
    setError("");
    try {
      if (dialog.type === "create-product") {
        await api.createProduct({ name, tag: productTag });
      } else if (dialog.type === "edit-product") {
        await api.updateProduct(dialog.item.id, { name, tag: productTag });
      } else {
        const creatingNewType = typeSelect === NEW_TYPE_VALUE;
        if (creatingNewType && !newTypeName.trim()) {
          setError("Укажите название типа комплектующего");
          setSaving(false);
          return;
        }
        const payload = {
          name,
          product_links: productLinks.map((l) => ({
            product_id: l.productId,
            display_as: l.displayAs,
          })),
          type_id: creatingNewType || !typeSelect ? null : Number(typeSelect),
          type_name: creatingNewType ? newTypeName.trim() : null,
        };
        if (dialog.type === "create-component") {
          await api.createComponent(payload);
        } else {
          await api.updateComponent(dialog.item.id, payload);
        }
      }
      closeDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (item: ReferenceProduct) => {
    const ok = await confirm({
      title: `Удалить готовую продукцию «${item.name}»?`,
      description: "Связи с комплектующими будут удалены. Это действие нельзя отменить.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteProduct(item.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  const handleDeleteComponent = async (item: ReferenceComponent) => {
    const ok = await confirm({
      title: `Удалить комплектующее «${item.name}»?`,
      description: "Это действие нельзя отменить.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteComponent(item.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">Загрузка...</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.reference")) return <Navigate to="/" replace />;

  const isComponentDialog =
    dialog?.type === "create-component" || dialog?.type === "edit-component";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6">
      <header className="mb-4">
        <div className="mb-2">
          <HubBackButton />
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <BookOpen className="h-7 w-7 shrink-0 text-orange-500" />
            Справочник
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {tab === "products" ? "Готовая продукция" : "Комплектующие"}
          </p>
        </div>
      </header>

      {canView && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === "products"
                ? "Поиск по названию или тегу..."
                : "Поиск комплектующих, типов или продукции..."
            }
            className="w-full rounded-2xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-orange-400"
          />
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {visibleTabs.length === 0 ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-gray-400 shadow-soft">
          Нет прав на разделы справочника
        </p>
      ) : !canView ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-gray-400 shadow-soft">
          Нет прав на просмотр
        </p>
      ) : loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : tab === "products" ? (
        products.length === 0 ? (
          <p className="rounded-3xl bg-white py-12 text-center text-sm text-gray-400 shadow-soft">
            {search.trim()
              ? "Ничего не найдено"
              : canCreate
                ? "Пока пусто — нажмите +, чтобы добавить готовую продукцию"
                : "Пока пусто"}
          </p>
        ) : (
          <ul className="space-y-2">
            {products.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-soft"
              >
                <button
                  type="button"
                  onClick={() => void openProductComponents(item)}
                  className="min-w-0 flex-1 rounded-xl px-1 py-0.5 text-left transition hover:bg-orange-50/80"
                >
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.tag && item.tag !== item.name && (
                    <p className="mt-0.5 text-xs font-medium text-orange-600">Тег: {item.tag}</p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-400">Комплектующие →</p>
                </button>
                <div className="flex shrink-0 gap-1">
                  {canOpenStockmap && (
                    <button
                      type="button"
                      onClick={() => openOnMap(item.name)}
                      className="rounded-full p-2 text-gray-400 hover:bg-sky-50 hover:text-sky-600"
                      aria-label="Где лежит на карте"
                      title="Где лежит"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditProduct(item)}
                      className="rounded-full p-2 text-gray-400 hover:bg-orange-50 hover:text-orange-500"
                      aria-label="Изменить"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteProduct(item)}
                      className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : components.length === 0 ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-gray-400 shadow-soft">
          {search.trim()
            ? "Ничего не найдено"
            : canCreate
              ? "Пока пусто — нажмите +, чтобы добавить комплектующее"
              : "Пока пусто"}
        </p>
      ) : (
        <ul className="space-y-2">
          {components.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-gray-100 bg-white p-3 shadow-soft"
            >
              {item.products.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {item.products.map((p) => (
                    <span
                      key={p.id}
                      title={p.display_as === "name" ? p.name : shortTag(p)}
                      className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-600"
                    >
                      {p.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {item.type && (
                    <p className="mb-0.5 text-xs font-medium text-orange-500">{item.type.name}</p>
                  )}
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.products.length === 0 && (
                    <p className="mt-1 text-xs text-gray-400">Без привязки к готовой продукции</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {canOpenStockmap && (
                    <button
                      type="button"
                      onClick={() => openOnMap(item.name)}
                      className="rounded-full p-2 text-gray-400 hover:bg-sky-50 hover:text-sky-600"
                      aria-label="Где лежит на карте"
                      title="Где лежит"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditComponent(item)}
                      className="rounded-full p-2 text-gray-400 hover:bg-orange-50 hover:text-orange-500"
                      aria-label="Изменить"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteComponent(item)}
                      className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {productDrill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[min(92dvh,36rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-soft">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-orange-500">Готовая продукция</p>
                <h2 className="text-lg font-semibold text-gray-900">{productDrill.product.name}</h2>
                {productDrill.product.tag &&
                  productDrill.product.tag !== productDrill.product.name && (
                    <p className="mt-0.5 text-sm text-orange-600">Тег: {productDrill.product.tag}</p>
                  )}
                <p className="mt-1 text-sm text-gray-500">Комплектующие с этим тегом</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canOpenStockmap && (
                  <button
                    type="button"
                    onClick={() => openOnMap(productDrill.product.name)}
                    className="rounded-full p-2 text-gray-400 hover:bg-sky-50 hover:text-sky-600"
                    aria-label="Где лежит на карте"
                    title="Где лежит"
                  >
                    <MapPin className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setProductDrill(null)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Закрыть"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {productDrill.loading ? (
              <p className="py-8 text-center text-sm text-gray-400">Загрузка...</p>
            ) : productDrill.items.length === 0 ? (
              <p className="rounded-2xl bg-gray-50 py-8 text-center text-sm text-gray-400">
                Пока нет комплектующих с тегом «{productDrill.product.name}»
              </p>
            ) : (
              <ul className="space-y-2">
                {productDrill.items.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      {c.type && (
                        <p className="text-xs font-medium text-orange-500">{c.type.name}</p>
                      )}
                      <p className="font-medium text-gray-900">{c.name}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {canOpenStockmap && (
                        <button
                          type="button"
                          onClick={() => openOnMap(c.name)}
                          className="rounded-full p-2 text-gray-400 hover:bg-white hover:text-sky-600"
                          aria-label="Где лежит на карте"
                          title="Где лежит"
                        >
                          <MapPin className="h-4 w-4" />
                        </button>
                      )}
                      {canEditComponents && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductDrill(null);
                            setTab("components");
                            openEditComponent(c);
                          }}
                          className="rounded-full p-2 text-gray-400 hover:bg-white hover:text-orange-500"
                          aria-label="Изменить комплектующее"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[min(92dvh,36rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {dialog.type === "create-product"
                  ? "Новая готовая продукция"
                  : dialog.type === "edit-product"
                    ? "Изменить готовую продукцию"
                    : dialog.type === "create-component"
                      ? "Новое комплектующее"
                      : "Изменить комплектующее"}
              </h2>
              <button type="button" onClick={closeDialog} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Название</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                  required
                  minLength={1}
                  autoFocus
                />
              </div>

              {(dialog.type === "create-product" || dialog.type === "edit-product") && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Короткий тег
                  </label>
                  <input
                    value={productTag}
                    onChange={(e) => setProductTag(e.target.value)}
                    placeholder="Короткое обозначение на карточках"
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                    required
                    minLength={1}
                    maxLength={40}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    На комплектующих будет показан этот тег, а не полное название
                  </p>
                </div>
              )}

              {isComponentDialog && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Тип комплектующего
                    </label>
                    <Select
                      value={typeSelect}
                      onChange={(v) => {
                        setTypeSelect(v);
                        if (v !== String(editingTagId ?? "")) cancelEditTag();
                      }}
                      options={typeOptions}
                      placeholder="Выберите тип"
                      dropdownPlacement="auto"
                      renderOptionActions={(opt, { close }) => {
                        if (!opt.value || opt.value === NEW_TYPE_VALUE) return null;
                        const tag = allTags.find((t) => String(t.id) === opt.value);
                        if (!tag) return null;
                        if (!canEditTags && !canDeleteTags) return null;
                        return (
                          <>
                            {canEditTags && (
                              <button
                                type="button"
                                title="Изменить тип"
                                aria-label={`Изменить тип ${tag.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  close();
                                  startEditTag(tag);
                                }}
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-orange-500"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDeleteTags && (
                              <button
                                type="button"
                                title="Удалить тип"
                                aria-label={`Удалить тип ${tag.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  close();
                                  void handleDeleteTag(tag);
                                }}
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        );
                      }}
                    />
                    {typeSelect === NEW_TYPE_VALUE && (
                      <input
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                        placeholder="Например: болт, шуруп…"
                        className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-orange-400"
                        required
                      />
                    )}
                    {editingTagId != null && (
                      <div className="mt-2 space-y-2 rounded-2xl border border-orange-100 bg-orange-50/60 p-3">
                        <p className="text-xs font-medium text-orange-700">Изменить название типа</p>
                        <input
                          value={editingTagName}
                          onChange={(e) => setEditingTagName(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-orange-400"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void saveEditTag()}
                            className="flex-1 rounded-xl py-2 text-sm font-medium text-white gradient-accent disabled:opacity-50"
                          >
                            Сохранить тип
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditTag}
                            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-600"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-700">Готовая продукция</p>
                      {productLinks.length > 0 && (
                        <span className="text-xs text-gray-400">Выбрано: {productLinks.length}</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {selectedLinkChips.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedLinkChips.map((chip) => (
                            <button
                              key={`${chip.productId}-${chip.displayAs}`}
                              type="button"
                              onClick={() => toggleProductLink(chip.productId, chip.displayAs)}
                              title={chip.title}
                              className="inline-flex max-w-full items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 ring-1 ring-orange-100 hover:bg-orange-100"
                            >
                              <span className="truncate">{chip.label}</span>
                              <X className="h-3 w-3 shrink-0 opacity-70" />
                            </button>
                          ))}
                        </div>
                      )}

                      {allProducts.length === 0 ? (
                        <p className="text-xs text-gray-400">
                          Сначала создайте записи во вкладке «Готовая продукция» (название + короткий
                          тег)
                        </p>
                      ) : (
                        <>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                              value={productPickerQuery}
                              onChange={(e) => setProductPickerQuery(e.target.value)}
                              placeholder="Найти по названию или тегу…"
                              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-orange-400"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => setShowAllProducts((v) => !v)}
                            className="w-full rounded-xl border border-dashed border-gray-200 py-2 text-sm font-medium text-gray-600 hover:border-orange-200 hover:bg-orange-50/50 hover:text-orange-700"
                          >
                            {showAllProducts
                              ? "Скрыть полный список"
                              : `Показать все (${allProducts.length})`}
                          </button>

                          {(showAllProducts || productPickerQuery.trim()) && (
                            <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-2xl bg-gray-50 p-2">
                              {pickerOptions.length === 0 ? (
                                <p className="px-2 py-3 text-center text-xs text-gray-400">
                                  Ничего не найдено
                                </p>
                              ) : (
                                pickerOptions.map((opt) => {
                                  const checked = productLinks.some(
                                    (l) =>
                                      l.productId === opt.productId &&
                                      l.displayAs === opt.displayAs
                                  );
                                  return (
                                    <ThemeSwitch
                                      key={opt.key}
                                      id={`ref-product-${opt.key}`}
                                      label={`${opt.label} (${opt.hint})`}
                                      checked={checked}
                                      onChange={() =>
                                        toggleProductLink(opt.productId, opt.displayAs)
                                      }
                                    />
                                  );
                                })
                              )}
                            </div>
                          )}

                          {!showAllProducts &&
                            !productPickerQuery.trim() &&
                            selectedLinkChips.length === 0 && (
                              <p className="text-xs text-gray-400">
                                Выберите либо полное название, либо короткий тег — на карточке будет
                                то, что выбрали
                              </p>
                            )}
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl py-3 font-medium text-white gradient-accent disabled:opacity-50"
              >
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </form>
          </div>
        </div>
      )}

      <ReferenceBottomNav
        tab={tab}
        visibleTabs={visibleTabs.map((t) => t.id)}
        canCreate={canCreate}
        onTabChange={setTab}
        onCreate={openCreate}
      />
    </div>
  );
}
