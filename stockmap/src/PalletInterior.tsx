import { useCallback, useEffect, useState } from "react";
import {
  listPalletItems,
  setPalletItems,
  type MapObject,
  type PalletItem,
  type PalletItemInput,
} from "./api";
import { CatalogContentsPicker, type CatalogPick } from "./CatalogContentsPicker";

type DraftRow = {
  key: string;
  title: string;
  quantity: string;
  details: string;
  picks: CatalogPick[];
};

function blankRow(): DraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: "",
    quantity: "",
    details: "",
    picks: [],
  };
}

function fromServer(items: PalletItem[]): DraftRow[] {
  if (items.length === 0) return [blankRow()];
  return items.map((item) => ({
    key: `p-${item.id}`,
    title: item.title || item.nameSnapshot,
    quantity: item.quantity,
    details: item.details,
    picks:
      item.kind && item.refId
        ? [
            {
              kind: item.kind,
              refId: item.refId,
              nameSnapshot: item.nameSnapshot || item.title,
              typeSnapshot: item.typeSnapshot,
              quantity: item.quantity,
            },
          ]
        : [],
  }));
}

export function PalletInterior({
  pallet,
  canEdit,
  onBack,
  onLabelChange,
}: {
  pallet: MapObject;
  canEdit: boolean;
  onBack: () => void;
  onLabelChange: (label: string) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listPalletItems(pallet.id);
      setRows(fromServer(items));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [pallet.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!canEdit || saving) return;
    const payload: PalletItemInput[] = [];
    for (const row of rows) {
      if (row.picks.length > 0) {
        for (const pick of row.picks) {
          payload.push({
            title: pick.nameSnapshot,
            nameSnapshot: pick.nameSnapshot,
            typeSnapshot: pick.typeSnapshot,
            kind: pick.kind,
            refId: pick.refId,
            quantity: pick.quantity || row.quantity,
            details: row.details,
          });
        }
      } else if (row.title.trim()) {
        payload.push({
          title: row.title.trim(),
          nameSnapshot: row.title.trim(),
          quantity: row.quantity.trim(),
          details: row.details.trim(),
        });
      }
    }
    setSaving(true);
    setError(null);
    try {
      const items = await setPalletItems(pallet.id, payload);
      setRows(fromServer(items));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="interior pallet-interior">
      <div className="interior-bar">
        <button type="button" className="btn ghost btn-back-map" onClick={onBack}>
          <span className="btn-back-map-arrow" aria-hidden>
            ←
          </span>
          <span className="btn-back-map-text">На карту</span>
        </button>
        <div className="interior-title">
          <p className="interior-label">{pallet.label || "Паллет"}</p>
          <p className="interior-meta">Список позиций на паллете</p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const next =
                window.prompt("Название паллета", pallet.label) ?? pallet.label;
              if (next.trim()) onLabelChange(next.trim());
            }}
          >
            Переименовать
          </button>
        )}
      </div>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn ghost" onClick={() => setError(null)}>
            Закрыть
          </button>
        </div>
      )}

      <div className="pallet-interior-body">
        {loading ? (
          <p className="catalog-empty">Загрузка…</p>
        ) : (
          <div className="pallet-rows">
            {rows.map((row) => (
              <div key={row.key} className="pallet-row">
                <CatalogContentsPicker
                  key={row.key}
                  initial={row.picks.map((p, i) => ({
                    id: i + 1,
                    shelfItemId: 0,
                    kind: p.kind,
                    refId: p.refId,
                    nameSnapshot: p.nameSnapshot,
                    typeSnapshot: p.typeSnapshot,
                    quantity: p.quantity,
                  }))}
                  canEdit={canEdit}
                  onChange={(next) => {
                    setRows((prev) =>
                      prev.map((r) =>
                        r.key === row.key
                          ? {
                              ...r,
                              picks: next,
                              title:
                                next.length === 1
                                  ? next[0]!.nameSnapshot
                                  : next.length > 1
                                    ? `${next.length} поз.`
                                    : r.title,
                            }
                          : r,
                      ),
                    );
                    setDirty(true);
                  }}
                />
                {row.picks.length === 0 && (
                  <label className="field item-detail-field">
                    <span>Название (произвольно)</span>
                    <input
                      value={row.title}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const title = e.target.value;
                        setRows((prev) =>
                          prev.map((r) =>
                            r.key === row.key ? { ...r, title } : r,
                          ),
                        );
                        setDirty(true);
                      }}
                      placeholder="Введите название вручную"
                    />
                  </label>
                )}
                <label className="field item-detail-field">
                  <span>Количество</span>
                  <input
                    value={row.quantity}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const quantity = e.target.value;
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, quantity } : r,
                        ),
                      );
                      setDirty(true);
                    }}
                    placeholder="Например: 12 шт"
                  />
                </label>
                <label className="field item-detail-field">
                  <span>Дополнительно</span>
                  <textarea
                    value={row.details}
                    disabled={!canEdit}
                    rows={2}
                    onChange={(e) => {
                      const details = e.target.value;
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, details } : r,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                </label>
                {canEdit && rows.length > 1 && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setRows((prev) => prev.filter((r) => r.key !== row.key));
                      setDirty(true);
                    }}
                  >
                    Удалить позицию
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="pallet-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRows((prev) => [...prev, blankRow()]);
                setDirty(true);
              }}
            >
              + Позиция
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
