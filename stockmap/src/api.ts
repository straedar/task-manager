export type Role = "admin" | "user";

export type AuthUser = {
  id: number;
  login: string;
  role: Role;
  permissions?: string[];
  canEditMap?: boolean;
  canEditShelves?: boolean;
  /** Если true — правки полок только после «Подтвердить». */
  requireShelfConfirm?: boolean;
};

export type ObjectType =
  | "rack"
  | "pallet"
  | "zone"
  | "wall"
  | "window"
  | "door"
  | "table"
  | "chair";

export type RackTheme = "blue" | "black";

export type MapObject = {
  id: number;
  type: ObjectType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shelvesCount: number | null;
  rotation: number;
  frameWidth: number | null;
  rackTheme: RackTheme | null;
};

export type MapObjectInput = Omit<MapObject, "id">;

export type ShelfItemType = "box" | "container" | "cell" | "stack";

export type CatalogKind = "component" | "product";

export type ShelfItemContent = {
  id: number;
  shelfItemId: number;
  kind: CatalogKind;
  refId: number;
  nameSnapshot: string;
  typeSnapshot: string;
  quantity: string;
};

export type ShelfItem = {
  id: number;
  rackId: number;
  shelfIndex: number;
  type: ShelfItemType;
  widthRatio: number;
  posX: number;
  depthRow: number;
  stackOrder: number;
  title: string;
  details: string;
  quantity: string;
  infoUpdatedAt: string | null;
  contents?: ShelfItemContent[];
};

export type WarehouseSearchHit = {
  shelfItemId: number;
  rackId: number;
  rackLabel: string;
  shelfIndex: number;
  itemType: ShelfItemType;
  title: string;
  details: string;
  quantity: string;
  matchedContents: ShelfItemContent[];
};

export type ReferenceCatalogItem = {
  id: number;
  name: string;
  type?: { id: number; name: string } | null;
  type_id?: number | null;
};

export type ManagedUser = {
  id: number;
  login: string;
  role: Role;
  created_at: string;
};

/** Same-origin path when embedded in TaskMaster; nginx proxies to Fastify /api. */
const API_BASE = "/stockmap-api";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url.startsWith("http") ? url : `${API_BASE}${url}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Ошибка запроса: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* plain text */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function login(loginName: string, password: string) {
  return requestJson<AuthUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: loginName, password }),
  });
}

export function logout() {
  return requestJson<void>("/auth/logout", { method: "POST" });
}

export function fetchMe() {
  return requestJson<AuthUser>("/auth/me");
}

export function listUsers() {
  return requestJson<ManagedUser[]>("/users");
}

export function createUser(input: {
  login: string;
  password: string;
  role: Role;
}) {
  return requestJson<AuthUser>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteUser(id: number) {
  return requestJson<void>(`/users/${id}`, { method: "DELETE" });
}

export function listObjects() {
  return requestJson<MapObject[]>("/objects");
}

export function createObject(input: MapObjectInput) {
  return requestJson<MapObject>("/objects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateObject(id: number, patch: Partial<MapObjectInput>) {
  return requestJson<MapObject>(`/objects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteObject(id: number) {
  return requestJson<void>(`/objects/${id}`, { method: "DELETE" });
}

export function listShelfItems(rackId: number) {
  return requestJson<ShelfItem[]>(`/racks/${rackId}/items`);
}

export function createShelfItem(
  rackId: number,
  input: {
    shelfIndex: number;
    type: ShelfItemType;
    posX?: number;
    depthRow?: number;
    stackOntoId?: number;
    widthRatio?: number;
  },
) {
  return requestJson<ShelfItem>(`/racks/${rackId}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteShelfItem(id: number) {
  return requestJson<void>(`/shelf-items/${id}`, { method: "DELETE" });
}

export function updateShelfItem(
  id: number,
  patch: Partial<{
    widthRatio: number;
    posX: number;
    shelfIndex: number;
    depthRow: number;
    stackOrder: number;
    title: string;
    details: string;
    quantity: string;
    moveStackGroup: boolean;
    stackOntoId: number;
  }>,
) {
  return requestJson<ShelfItem>(`/shelf-items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function setShelfItemContents(
  id: number,
  items: {
    kind: CatalogKind;
    refId: number;
    nameSnapshot: string;
    typeSnapshot?: string;
    quantity?: string;
  }[],
) {
  return requestJson<{ items: ShelfItemContent[] }>(`/shelf-items/${id}/contents`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export type ShelfItemSnapshot = {
  id?: number;
  shelfIndex: number;
  type: ShelfItemType;
  widthRatio: number;
  posX: number;
  depthRow: number;
  stackOrder: number;
  title: string;
  details: string;
  quantity: string;
  contents?: {
    kind: CatalogKind;
    refId: number;
    nameSnapshot: string;
    typeSnapshot?: string;
    quantity?: string;
  }[];
};

/** Полная замена содержимого полок стеллажа (для подтверждения черновика). */
export function replaceRackItems(rackId: number, items: ShelfItemSnapshot[]) {
  return requestJson<ShelfItem[]>(`/racks/${rackId}/items/replace`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export type PalletItem = {
  id: number;
  palletId: number;
  title: string;
  details: string;
  quantity: string;
  kind: CatalogKind | null;
  refId: number | null;
  nameSnapshot: string;
  typeSnapshot: string;
  sortOrder: number;
};

export type PalletItemInput = {
  title?: string;
  details?: string;
  quantity?: string;
  kind?: CatalogKind | null;
  refId?: number | null;
  nameSnapshot?: string;
  typeSnapshot?: string;
};

export function listPalletItems(palletId: number) {
  return requestJson<{ items: PalletItem[] }>(`/pallets/${palletId}/items`).then(
    (res) => res.items,
  );
}

export function setPalletItems(palletId: number, items: PalletItemInput[]) {
  return requestJson<{ items: PalletItem[] }>(`/pallets/${palletId}/items`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  }).then((res) => res.items);
}

export function searchWarehouse(q: string) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return requestJson<{ items: WarehouseSearchHit[] }>(
    `/search${qs ? `?${qs}` : ""}`,
  );
}

const MAIN_API_BASE = "/api";

async function requestMainJson<T>(url: string): Promise<T> {
  const response = await fetch(`${MAIN_API_BASE}${url}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Ошибка запроса: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* plain text */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function listReferenceProducts(q = "") {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return requestMainJson<{ items: ReferenceCatalogItem[] }>(
    `/reference/products${qs ? `?${qs}` : ""}`,
  );
}

export function listReferenceComponents(q = "") {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return requestMainJson<{ items: ReferenceCatalogItem[] }>(
    `/reference/components${qs ? `?${qs}` : ""}`,
  );
}
