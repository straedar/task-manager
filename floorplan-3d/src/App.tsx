import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearFloorTexture,
  createObject,
  createShelfItem,
  deleteObject,
  fetchMapSettings,
  fetchMe,
  listObjects,
  listShelfItems,
  logout,
  setShelfItemContents,
  updateMapSettings,
  updateObject,
  updateShelfItem,
  uploadFloorTexture,
  type AuthUser,
  type MapObject,
  type MapSettings,
} from "./api";
import { LoginScreen } from "./LoginScreen";
import { MapEditor2D } from "./components/MapEditor2D";
import { WarehouseViewer3D } from "./components/WarehouseViewer3D";
import { RackInterior } from "./rack/RackInterior";
import {
  GRID,
  normalizeSegmentObject,
  segmentNeedsNormalize,
  METERS_PER_GRID,
} from "./world";

type UiMode = "edit" | "view";
type AuthState = "loading" | "in" | "out";

const POLL_MS = 8000;

const DEFAULT_SETTINGS: MapSettings = {
  wallHeightM: 3.6,
  rackHeightM: 2.7,
  windowSillM: 0.9,
  windowHeightM: 1.5,
  hasFloorTexture: false,
  floorUrl: null,
};

function fileToBase64(file: File): Promise<{ mime: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      const dataBase64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ mime: file.type || "image/jpeg", dataBase64 });
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [settings, setSettings] = useState<MapSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UiMode>("view");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [clipHeightM, setClipHeightM] = useState(3.6);
  const [openedRackId, setOpenedRackId] = useState<number | null>(null);
  const settingsTimer = useRef<number | null>(null);
  const pendingSettings = useRef<Partial<MapSettings>>({});
  const dirtyRef = useRef(false);
  const dragLockUntil = useRef(0);
  const wallsMigratedRef = useRef(false);

  const canEditMap = Boolean(user?.canEditMap);

  const refreshObjects = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const list = await listObjects();
      if (Date.now() < dragLockUntil.current || dirtyRef.current) {
        return;
      }
      const normalized = list.map((obj) => normalizeSegmentObject(obj));
      setObjects(normalized);
      setError(null);

      if (
        canEditMap &&
        !wallsMigratedRef.current &&
        !opts?.silent
      ) {
        const toFix = normalized.filter((_, i) => {
          const prev = list[i];
          return prev != null && segmentNeedsNormalize(prev);
        });
        if (toFix.length > 0) {
          wallsMigratedRef.current = true;
          void Promise.all(
            toFix.map((obj) =>
              updateObject(obj.id, {
                x: obj.x,
                y: obj.y,
                width: obj.width,
                height: obj.height,
              }),
            ),
          ).catch(() => {
            wallsMigratedRef.current = false;
          });
        } else {
          wallsMigratedRef.current = true;
        }
      }
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) {
        setAuthState("out");
        setUser(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Не удалось загрузить карту");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [canEditMap]);

  const refreshSettings = useCallback(async () => {
    try {
      const next = await fetchMapSettings();
      setSettings({
        ...DEFAULT_SETTINGS,
        ...next,
        rackHeightM: next.rackHeightM ?? DEFAULT_SETTINGS.rackHeightM,
      });
      setClipHeightM((prev) => Math.min(prev, next.wallHeightM) || next.wallHeightM);
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setAuthState("in");
        if (!me.canEditMap) setMode("view");
      })
      .catch(() => {
        if (!cancelled) {
          setAuthState("out");
          setUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authState !== "in") return;
    void refreshObjects();
    void refreshSettings();
  }, [authState, refreshObjects, refreshSettings]);

  useEffect(() => {
    if (authState !== "in") return;
    const id = window.setInterval(() => {
      void refreshObjects({ silent: true });
      void refreshSettings();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [authState, refreshObjects, refreshSettings]);

  useEffect(() => {
    setClipHeightM((h) => Math.min(h, settings.wallHeightM));
  }, [settings.wallHeightM]);

  const onPatch = useCallback(
    async (id: number, patch: Partial<MapObject>) => {
      dirtyRef.current = true;
      dragLockUntil.current = Date.now() + 2500;
      setObjects((prev) =>
        prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      );
      try {
        const next = await updateObject(id, patch);
        setObjects((prev) => prev.map((o) => (o.id === id ? next : o)));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить");
        void refreshObjects({ silent: true });
      } finally {
        dirtyRef.current = false;
      }
    },
    [refreshObjects],
  );

  const onCreate = useCallback(async (draft: Omit<MapObject, "id">) => {
    dirtyRef.current = true;
    dragLockUntil.current = Date.now() + 2500;
    try {
      const created = await createObject(draft);
      setObjects((prev) => [...prev, created]);
      setSelectedIds([created.id]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      dirtyRef.current = false;
    }
  }, []);

  const onDelete = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      dirtyRef.current = true;
      dragLockUntil.current = Date.now() + 2500;
      const idSet = new Set(ids);
      setObjects((prev) => prev.filter((o) => !idSet.has(o.id)));
      setSelectedIds([]);
      try {
        await Promise.all(ids.map((id) => deleteObject(id)));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось удалить");
        void refreshObjects({ silent: true });
      } finally {
        dirtyRef.current = false;
      }
    },
    [refreshObjects],
  );

  /** Как в 2D stockmap: копия стеллажа рядом + все полки/коробки/содержимое. */
  const onCopyRacks = useCallback(
    async (sourceIds: number[]) => {
      const rackIds = sourceIds.filter((id) =>
        objects.some((o) => o.id === id && o.type === "rack"),
      );
      if (rackIds.length === 0) return;
      dirtyRef.current = true;
      dragLockUntil.current = Date.now() + 8000;
      setError(null);
      try {
        const createdAll: MapObject[] = [];
        for (const sourceId of rackIds) {
          const src = objects.find((o) => o.id === sourceId);
          if (!src || src.type !== "rack") continue;
          const gap = GRID;
          let x = src.x + src.width + gap;
          let y = src.y;
          const overlaps = (nx: number, ny: number) =>
            [...objects, ...createdAll].some(
              (o) =>
                o.type === "rack" &&
                nx < o.x + o.width &&
                nx + src.width > o.x &&
                ny < o.y + o.height &&
                ny + src.height > o.y,
            );
          let guard = 0;
          while (overlaps(x, y) && guard < 40) {
            x += src.width + gap;
            guard += 1;
          }
          const created = await createObject({
            type: "rack",
            label: src.label,
            x,
            y,
            width: src.width,
            height: src.height,
            shelvesCount: src.shelvesCount,
            rotation: src.rotation ?? 0,
            frameWidth: src.frameWidth,
            rackTheme: src.rackTheme,
          });
          createdAll.push(created);

          const sourceItems = await listShelfItems(src.id);
          const sorted = [...sourceItems].sort(
            (a, b) =>
              a.shelfIndex - b.shelfIndex ||
              (a.depthRow ?? 1) - (b.depthRow ?? 1) ||
              (a.posX ?? 0) - (b.posX ?? 0) ||
              (a.stackOrder ?? 0) - (b.stackOrder ?? 0),
          );
          const idMap = new Map<number, number>();
          for (const item of sorted) {
            const below =
              (item.stackOrder ?? 0) > 0
                ? sorted.find(
                    (candidate) =>
                      candidate.shelfIndex === item.shelfIndex &&
                      (candidate.depthRow ?? 1) === (item.depthRow ?? 1) &&
                      (candidate.posX ?? 0) === (item.posX ?? 0) &&
                      (candidate.stackOrder ?? 0) ===
                        (item.stackOrder ?? 0) - 1,
                  )
                : null;
            const stackOntoId = below ? idMap.get(below.id) : undefined;
            const createdItem = await createShelfItem(created.id, {
              shelfIndex: item.shelfIndex,
              type: item.type,
              depthRow: item.depthRow ?? 1,
              widthRatio: item.widthRatio,
              ...(stackOntoId != null
                ? { stackOntoId }
                : { posX: item.posX ?? 0 }),
            });
            idMap.set(item.id, createdItem.id);
            const needsInfo =
              Boolean(item.title) ||
              Boolean(item.details) ||
              Boolean(item.quantity) ||
              (item.contents ?? []).length > 0;
            if (needsInfo) {
              await updateShelfItem(createdItem.id, {
                title: item.title,
                details: item.details,
                quantity: item.quantity,
                widthRatio: item.widthRatio,
                posX: item.posX ?? 0,
              });
            }
            if ((item.contents ?? []).length > 0) {
              await setShelfItemContents(
                createdItem.id,
                (item.contents ?? []).map((c) => ({
                  kind: c.kind,
                  refId: c.refId,
                  nameSnapshot: c.nameSnapshot,
                  typeSnapshot: c.typeSnapshot,
                  quantity: c.quantity,
                })),
              );
            }
          }
        }
        if (createdAll.length > 0) {
          setObjects((prev) => [...prev, ...createdAll]);
          setSelectedIds(createdAll.map((o) => o.id));
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось скопировать стеллажи",
        );
        void refreshObjects({ silent: true });
      } finally {
        dirtyRef.current = false;
      }
    },
    [objects, refreshObjects],
  );

  const onSettingsPatch = useCallback(
    (patch: Partial<MapSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      pendingSettings.current = { ...pendingSettings.current, ...patch };
      if (settingsTimer.current != null) window.clearTimeout(settingsTimer.current);
      settingsTimer.current = window.setTimeout(() => {
        const body = pendingSettings.current;
        pendingSettings.current = {};
        void updateMapSettings(body)
          .then((next) => setSettings(next))
          .catch((err) => {
            setError(
              err instanceof Error ? err.message : "Не удалось сохранить настройки",
            );
            void refreshSettings();
          });
      }, 350);
    },
    [refreshSettings],
  );

  const onFloorUpload = useCallback(
    async (file: File) => {
      try {
        const { mime, dataBase64 } = await fileToBase64(file);
        const res = await uploadFloorTexture(mime, dataBase64);
        setSettings((prev) => ({
          ...prev,
          hasFloorTexture: true,
          floorUrl: res.floorUrl,
        }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить текстуру");
      }
    },
    [],
  );

  const onFloorClear = useCallback(async () => {
    try {
      await clearFloorTexture();
      setSettings((prev) => ({
        ...prev,
        hasFloorTexture: false,
        floorUrl: null,
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить текстуру");
    }
  }, []);

  if (authState === "loading") {
    return (
      <div className="login-screen">
        <p className="status-line">Проверка входа…</p>
      </div>
    );
  }

  if (authState === "out" || !user) {
    return <LoginScreen />;
  }

  const openedRack =
    openedRackId == null
      ? null
      : objects.find((obj) => obj.id === openedRackId && obj.type === "rack") ??
        null;

  if (openedRack) {
    return (
      <RackInterior
        rack={openedRack}
        onBack={() => setOpenedRackId(null)}
        onRackChange={(patch) => void onPatch(openedRack.id, patch)}
        canEditMap={canEditMap}
        canEditShelves={Boolean(user.canEditShelves)}
        requireShelfConfirm={Boolean(user.requireShelfConfirm)}
      />
    );
  }

  return (
    <div className="app warehouse-app">
      <header className="chrome">
        <div className="brand-block">
          <button
            type="button"
            className="btn ghost chrome-hub"
            onClick={() => {
              const target = "/";
              if (window.top && window.top !== window) {
                window.top.location.href = target;
                return;
              }
              window.location.href = target;
            }}
            aria-label="На главный экран TaskMaster"
            title="На главный экран TaskMaster"
          >
            TaskMaster
          </button>
          <p className="brand">3Д карта склада</p>
          <p className="tagline">
            {user.login}
            {canEditMap ? " · можно редактировать" : " · только просмотр"}
          </p>
        </div>

        <div className="mode-switch" role="group" aria-label="Режим">
          {canEditMap && (
            <button
              type="button"
              className={mode === "edit" ? "btn mode active" : "btn mode"}
              onClick={() => {
                setMode("edit");
              }}
            >
              Редактирование
            </button>
          )}
          <button
            type="button"
            className={mode === "view" ? "btn mode active" : "btn mode"}
            onClick={() => {
              setMode("view");
            }}
          >
            Просмотр 3Д
          </button>
        </div>

        <div className="chrome-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void refreshObjects();
              void refreshSettings();
            }}
          >
            Обновить
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void logout()
                .catch(() => undefined)
                .finally(() => {
                  setUser(null);
                  setAuthState("out");
                  setObjects([]);
                });
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn ghost" onClick={() => setError(null)}>
            Закрыть
          </button>
        </div>
      )}

      <main className="main-stage">
        {loading && objects.length === 0 ? (
          <p className="status-line">Загрузка карты…</p>
        ) : mode === "edit" && canEditMap ? (
          <MapEditor2D
            objects={objects}
            canEdit={canEditMap}
            selectedIds={selectedIds}
            settings={settings}
            onSelect={setSelectedIds}
            onCreate={(draft) => void onCreate(draft)}
            onPatch={(id, patch) => void onPatch(id, patch)}
            onDelete={(ids) => void onDelete(ids)}
            onCopyRacks={(ids) => void onCopyRacks(ids)}
            onFloorUpload={(file) => void onFloorUpload(file)}
            onFloorClear={() => void onFloorClear()}
            onOpenRack={setOpenedRackId}
          />
        ) : (
          <>
            <div className="view-toolbar" role="group" aria-label="Настройки 3Д">
              {canEditMap && (
                <>
                  <label className="map-setting">
                    <span>Стены</span>
                    <input
                      type="range"
                      min={150}
                      max={800}
                      step={5}
                      value={Math.round(settings.wallHeightM * 100)}
                      onChange={(e) =>
                        onSettingsPatch({
                          wallHeightM: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <em>{Math.round(settings.wallHeightM * 100)} см</em>
                  </label>
                  <label className="map-setting">
                    <span>Стеллажи</span>
                    <input
                      type="range"
                      min={120}
                      max={600}
                      step={5}
                      value={Math.round(settings.rackHeightM * 100)}
                      onChange={(e) =>
                        onSettingsPatch({
                          rackHeightM: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <em>{Math.round(settings.rackHeightM * 100)} см</em>
                  </label>
                  <label className="map-setting">
                    <span>Подоконник</span>
                    <input
                      type="range"
                      min={10}
                      max={250}
                      step={5}
                      value={Math.round(settings.windowSillM * 100)}
                      onChange={(e) =>
                        onSettingsPatch({
                          windowSillM: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <em>{Math.round(settings.windowSillM * 100)} см</em>
                  </label>
                  <label className="map-setting">
                    <span>Высота окон</span>
                    <input
                      type="range"
                      min={30}
                      max={300}
                      step={5}
                      value={Math.round(settings.windowHeightM * 100)}
                      onChange={(e) =>
                        onSettingsPatch({
                          windowHeightM: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <em>{Math.round(settings.windowHeightM * 100)} см</em>
                  </label>
                </>
              )}
              <label className="map-setting">
                <span>Обрезка стен/окон</span>
                <input
                  type="range"
                  min={0.2}
                  max={settings.wallHeightM}
                  step={0.05}
                  value={Math.min(clipHeightM, settings.wallHeightM)}
                  onChange={(e) => setClipHeightM(Number(e.target.value))}
                />
                <em>
                  {Math.round(Math.min(clipHeightM, settings.wallHeightM) * 100)} /{" "}
                  {Math.round(settings.wallHeightM * 100)} см
                </em>
              </label>
              <span className="clip-hint">
                клетка {Math.round(METERS_PER_GRID * 100)} см · дверь{" "}
                {Math.round(2.1 * 100)} см
              </span>
            </div>
            <WarehouseViewer3D
              objects={objects}
              settings={settings}
              selectedId={selectedIds[0] ?? null}
              clipHeightM={clipHeightM}
              onSelect={(id) => setSelectedIds(id == null ? [] : [id])}
              onOpenRack={setOpenedRackId}
            />
          </>
        )}
      </main>
    </div>
  );
}
