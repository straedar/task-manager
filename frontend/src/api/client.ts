import type { Checklist, Idea, Preset, PresetKind, Task, User } from "../types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? "Ошибка запроса");
  }

  return data as T;
}

export const api = {
  login: (nickname: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nickname, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  me: () => request<{ user: User }>("/api/auth/me"),

  getProfile: () =>
    request<{ profile: import("../types").UserProfile }>("/api/profile"),

  getProfileById: (id: number) =>
    request<{ profile: import("../types").UserProfile }>(`/api/profile/${id}`),

  listStructureUsers: () =>
    request<{ users: User[] }>("/api/structure/users"),

  updateProfile: (data: { first_name?: string; last_name?: string }) =>
    request<{
      profile: import("../types").UserProfile;
      user: User;
    }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  uploadAvatar: async (file: File) => {
    const body = new FormData();
    body.append("avatar", file);
    const res = await fetch("/api/profile/avatar", {
      method: "POST",
      credentials: "include",
      body,
    });
    const data = await res.json().catch(() => ({} as { error?: string }));
    if (!res.ok) {
      if (res.status === 413) {
        throw new Error("Файл слишком большой для сервера. Обрежьте фото или выберите меньше.");
      }
      throw new Error(
        typeof data.error === "string" && data.error.trim()
          ? data.error
          : `Ошибка загрузки (${res.status})`
      );
    }
    return data as {
      profile: import("../types").UserProfile;
      user: User;
    };
  },

  deleteAvatar: () =>
    request<{
      profile: import("../types").UserProfile;
      user: User;
    }>("/api/profile/avatar", { method: "DELETE" }),

  getUsers: () => request<{ users: User[] }>("/api/auth/users"),

  getUserTree: () => request<{ users: User[] }>("/api/auth/admin/tree"),

  createUser: (data: {
    nickname: string;
    password: string;
    parent_id: number | null;
    role_id?: number | null;
  }) =>
    request<{ user: User }>("/api/auth/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  moveUser: (id: number, parent_id: number | null) =>
    request<{ user: User }>(`/api/auth/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ parent_id }),
    }),

  updateUserRole: (id: number, role_id: number | null) =>
    request<{ user: User }>(`/api/auth/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role_id }),
    }),

  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/auth/admin/users/${id}`, { method: "DELETE" }),

  listRoles: () => request<{ roles: import("../types").Role[] }>("/api/roles"),

  getPermissionCatalog: () =>
    request<{ groups: import("../types").PermissionGroup[] }>("/api/roles/catalog"),

  listHubApps: () =>
    request<{ apps: import("../apps").HubAppDto[] }>("/api/hub/apps"),

  createRole: (data: {
    name: string;
    description?: string;
    permissions: string[];
  }) =>
    request<{ role: import("../types").Role }>("/api/roles", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateRole: (
    id: number,
    data: { name?: string; description?: string; permissions?: string[] }
  ) =>
    request<{ role: import("../types").Role }>(`/api/roles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteRole: (id: number) =>
    request<{ ok: boolean }>(`/api/roles/${id}`, { method: "DELETE" }),

  getTasks: () => request<{ tasks: Task[] }>("/api/tasks"),

  getAssignableUsers: () =>
    request<{ users: User[]; has_subordinates: boolean }>("/api/tasks/assignable-users"),

  createTask: (data: {
    title: string;
    description: string;
    priority: Task["priority"];
    assigneeIds: number[];
    is_shared: boolean;
    is_private?: boolean;
    due_at?: string | null;
    planned_for?: string | null;
  }) =>
    request<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  completeTask: (id: number) =>
    request<{ task: Task }>(`/api/tasks/${id}/complete`, { method: "POST" }),

  startTask: (id: number) =>
    request<{ task: Task }>(`/api/tasks/${id}/start`, { method: "POST" }),

  deleteTask: (id: number) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

  updateTask: (
    id: number,
    data: {
      title: string;
      description: string;
      priority: Task["priority"];
      assigneeIds: number[];
      is_shared: boolean;
      is_private?: boolean;
      due_at?: string | null;
      planned_for?: string | null;
    }
  ) =>
    request<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getIdeas: () => request<{ ideas: Idea[] }>("/api/ideas"),

  createIdea: (data: {
    title: string;
    description: string;
    tag: Idea["tag"];
    due_at: string | null;
    privacy: Idea["privacy"];
  }) =>
    request<{ idea: Idea }>("/api/ideas", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateIdea: (
    id: number,
    data: {
      title: string;
      description: string;
      tag: Idea["tag"];
      due_at: string | null;
      privacy: Idea["privacy"];
    }
  ) =>
    request<{ idea: Idea }>(`/api/ideas/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  completeIdea: (id: number) =>
    request<{ idea: Idea }>(`/api/ideas/${id}/complete`, { method: "POST" }),

  deleteIdea: (id: number) =>
    request<{ ok: boolean }>(`/api/ideas/${id}`, { method: "DELETE" }),

  getChecklists: () => request<{ checklists: Checklist[] }>("/api/checklists"),

  createChecklist: (data: {
    title: string;
    assignee_id: number;
    items: string[];
    has_deadline: boolean;
    planned_for?: string | null;
    expires_at?: string | null;
    is_private?: boolean;
  }) =>
    request<{ checklist: Checklist }>("/api/checklists", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateChecklist: (
    id: number,
    data: {
      title: string;
      assignee_id: number;
      items: { id?: number | null; title: string }[];
      has_deadline: boolean;
      planned_for?: string | null;
      expires_at?: string | null;
      is_private?: boolean;
    }
  ) =>
    request<{ checklist: Checklist }>(`/api/checklists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  toggleChecklistItem: (checklistId: number, itemId: number, completed: boolean) =>
    request<{ checklist: Checklist }>(
      `/api/checklists/${checklistId}/items/${itemId}/toggle`,
      {
        method: "POST",
        body: JSON.stringify({ completed }),
      }
    ),

  deleteChecklist: (id: number) =>
    request<{ ok: boolean }>(`/api/checklists/${id}`, { method: "DELETE" }),

  getPresets: (kind?: PresetKind) =>
    request<{ presets: Preset[] }>(
      kind ? `/api/presets?kind=${kind}` : "/api/presets"
    ),

  createPreset: (
    data:
      | {
          kind: "task";
          name: string;
          title: string;
          description: string;
          priority: Task["priority"];
        }
      | {
          kind: "checklist";
          name: string;
          title: string;
          has_deadline: boolean;
          items: string[];
        }
  ) =>
    request<{ preset: Preset }>("/api/presets", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updatePreset: (
    id: number,
    data:
      | {
          name: string;
          title: string;
          description: string;
          priority: Task["priority"];
        }
      | {
          name: string;
          title: string;
          has_deadline: boolean;
          items: string[];
        }
  ) =>
    request<{ preset: Preset }>(`/api/presets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deletePreset: (id: number) =>
    request<{ ok: boolean }>(`/api/presets/${id}`, { method: "DELETE" }),

  getVapidPublicKey: () => request<{ publicKey: string }>("/api/push/vapid-public-key"),

  subscribePush: (data: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: boolean }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  unsubscribePush: (endpoint: string) =>
    request<{ ok: boolean }>("/api/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),

  testPush: () =>
    request<{ ok: boolean; sent: number }>("/api/push/test", { method: "POST" }),

  listProducts: (q = "") =>
    request<{ items: import("../types").ReferenceProduct[] }>(
      `/api/reference/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`
    ),

  listProductComponents: (productId: number) =>
    request<{
      product: import("../types").ReferenceProduct;
      items: import("../types").ReferenceComponent[];
    }>(`/api/reference/products/${productId}/components`),

  createProduct: (data: { name: string; tag: string }) =>
    request<{ item: import("../types").ReferenceProduct }>("/api/reference/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProduct: (id: number, data: { name: string; tag: string }) =>
    request<{ item: import("../types").ReferenceProduct }>(`/api/reference/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteProduct: (id: number) =>
    request<{ ok: boolean }>(`/api/reference/products/${id}`, { method: "DELETE" }),

  listComponents: (q = "") =>
    request<{ items: import("../types").ReferenceComponent[] }>(
      `/api/reference/components${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`
    ),

  createComponent: (data: {
    name: string;
    product_links?: { product_id: number; display_as: "name" | "tag" }[];
    product_ids?: number[];
    type_id?: number | null;
    type_name?: string | null;
  }) =>
    request<{ item: import("../types").ReferenceComponent }>("/api/reference/components", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateComponent: (
    id: number,
    data: {
      name: string;
      product_links?: { product_id: number; display_as: "name" | "tag" }[];
      product_ids?: number[];
      type_id?: number | null;
      type_name?: string | null;
    }
  ) =>
    request<{ item: import("../types").ReferenceComponent }>(`/api/reference/components/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteComponent: (id: number) =>
    request<{ ok: boolean }>(`/api/reference/components/${id}`, { method: "DELETE" }),

  listTags: (q = "") =>
    request<{ items: import("../types").ReferenceTag[] }>(
      `/api/reference/tags${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`
    ),

  createTag: (data: { name: string }) =>
    request<{ item: import("../types").ReferenceTag }>("/api/reference/tags", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTag: (id: number, data: { name: string }) =>
    request<{ item: import("../types").ReferenceTag }>(`/api/reference/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteTag: (id: number) =>
    request<{ ok: boolean }>(`/api/reference/tags/${id}`, { method: "DELETE" }),

  listNews: () =>
    request<{ items: import("../types").NewsPostListItem[] }>("/api/news"),

  getNews: (id: number) =>
    request<{ item: import("../types").NewsPost }>(`/api/news/${id}`),

  createNews: (data: {
    title: string;
    body_html: string;
    patch?: { version: string; release_day: string; global: boolean };
  }) =>
    request<{ item: import("../types").NewsPost; version?: string }>("/api/news", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateNews: (id: number, data: { title: string; body_html: string }) =>
    request<{ item: import("../types").NewsPost }>(`/api/news/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteNews: (id: number) =>
    request<{ ok: boolean }>(`/api/news/${id}`, { method: "DELETE" }),

  getPatchDraft: () =>
    request<{
      body_html: string;
      heading_ru: string;
      day_key: string;
      version_patch: string;
      version_global: string;
      title_patch: string;
      title_global: string;
    }>("/api/news/patch-draft"),

  getNotificationPrefs: () =>
    request<{
      prefs: import("../types").NotifPrefs;
      meta: { quiet_hours: string; weekend: string; low_priority: string };
    }>("/api/notification-prefs"),

  updateNotificationPrefs: (prefs: Partial<import("../types").NotifPrefs>) =>
    request<{ prefs: import("../types").NotifPrefs }>("/api/notification-prefs", {
      method: "PUT",
      body: JSON.stringify(prefs),
    }),
};
