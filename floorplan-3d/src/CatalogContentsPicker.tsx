import { useEffect, useMemo, useState } from "react";
import {
  listReferenceComponents,
  listReferenceProducts,
  type CatalogKind,
  type ReferenceCatalogItem,
  type ShelfItemContent,
} from "./api";
import { CheckboxIndicator } from "./CheckboxIndicator";

export type CatalogPick = {
  kind: CatalogKind;
  refId: number;
  nameSnapshot: string;
  typeSnapshot: string;
  quantity: string;
};

type Props = {
  initial: ShelfItemContent[];
  canEdit: boolean;
  onChange: (items: CatalogPick[]) => void;
};

function toPick(c: ShelfItemContent): CatalogPick {
  return {
    kind: c.kind,
    refId: c.refId,
    nameSnapshot: c.nameSnapshot,
    typeSnapshot: c.typeSnapshot ?? "",
    quantity: c.quantity ?? "",
  };
}

function keyOf(kind: CatalogKind, refId: number) {
  return `${kind}:${refId}`;
}

export function CatalogContentsPicker({ initial, canEdit, onChange }: Props) {
  const [selected, setSelected] = useState<CatalogPick[]>(() =>
    initial.map(toPick),
  );
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<CatalogKind>("component");
  const [catalog, setCatalog] = useState<ReferenceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(initial.map(toPick));
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const q = query.trim();
        if (!showAll && !q) {
          setCatalog([]);
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const res =
            tab === "component"
              ? await listReferenceComponents(q)
              : await listReferenceProducts(q);
          if (!cancelled) setCatalog(res.items);
        } catch (err) {
          if (!cancelled) {
            setCatalog([]);
            setError(
              err instanceof Error
                ? err.message
                : "Не удалось загрузить справочник",
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, showAll, tab]);

  const selectedKeys = useMemo(
    () => new Set(selected.map((s) => keyOf(s.kind, s.refId))),
    [selected],
  );

  const emit = (next: CatalogPick[]) => {
    setSelected(next);
    onChange(next);
  };

  const toggle = (item: ReferenceCatalogItem, kind: CatalogKind) => {
    if (!canEdit) return;
    const k = keyOf(kind, item.id);
    if (selectedKeys.has(k)) {
      emit(selected.filter((s) => keyOf(s.kind, s.refId) !== k));
      return;
    }
    emit([
      ...selected,
      {
        kind,
        refId: item.id,
        nameSnapshot: item.name,
        typeSnapshot: kind === "component" ? (item.type?.name ?? "") : "",
        quantity: "",
      },
    ]);
  };

  const remove = (kind: CatalogKind, refId: number) => {
    if (!canEdit) return;
    emit(selected.filter((s) => !(s.kind === kind && s.refId === refId)));
  };

  return (
    <div className="catalog-picker">
      <div className="catalog-picker-head">
        <span>Из справочника</span>
        {selected.length > 0 && (
          <span className="catalog-picker-count">Выбрано: {selected.length}</span>
        )}
      </div>

      {selected.length > 0 && (
        <div className="catalog-selected" role="list">
          {selected.map((s) => (
            <label
              key={keyOf(s.kind, s.refId)}
              className={`checkbox-row${canEdit ? "" : " is-readonly"}`}
              role="listitem"
            >
              <CheckboxIndicator checked />
              <input
                type="checkbox"
                className="sr-only"
                checked
                disabled={!canEdit}
                onChange={() => remove(s.kind, s.refId)}
              />
              <span className="checkbox-row-text">
                <span className="catalog-row-kind">
                  {s.kind === "component" ? "К" : "П"}
                </span>
                {s.typeSnapshot ? (
                  <span className="catalog-row-type">{s.typeSnapshot} · </span>
                ) : null}
                {s.nameSnapshot}
              </span>
            </label>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <div className="catalog-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={tab === "component" ? "active" : ""}
              aria-selected={tab === "component"}
              onClick={() => {
                setTab("component");
                setShowAll(false);
              }}
            >
              Комплектующие
            </button>
            <button
              type="button"
              role="tab"
              className={tab === "product" ? "active" : ""}
              aria-selected={tab === "product"}
              onClick={() => {
                setTab("product");
                setShowAll(false);
              }}
            >
              Готовая продукция
            </button>
          </div>

          <input
            className="catalog-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={false}
            placeholder={
              tab === "component"
                ? "Найти комплектующее или тип…"
                : "Найти готовую продукцию…"
            }
          />

          <button
            type="button"
            className="btn catalog-show-all"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Скрыть полный список" : "Показать все"}
          </button>

          {(showAll || query.trim()) && (
            <div className="catalog-list">
              {loading ? (
                <p className="catalog-empty">Загрузка…</p>
              ) : error ? (
                <p className="catalog-empty catalog-error">{error}</p>
              ) : catalog.length === 0 ? (
                <p className="catalog-empty">Ничего не найдено</p>
              ) : (
                catalog.map((item) => {
                  const checked = selectedKeys.has(keyOf(tab, item.id));
                  const typeName =
                    tab === "component" ? item.type?.name : undefined;
                  return (
                    <label key={`${tab}-${item.id}`} className="checkbox-row">
                      <CheckboxIndicator checked={checked} />
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggle(item, tab)}
                      />
                      <span className="checkbox-row-text">
                        {typeName ? (
                          <span className="catalog-row-type">{typeName} · </span>
                        ) : null}
                        {item.name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          )}

          {!showAll && !query.trim() && selected.length === 0 && (
            <p className="catalog-hint">
              Введите название или откройте полный список
            </p>
          )}
        </>
      )}
    </div>
  );
}
