/**
 * Feature registry — single source of truth for hub apps and object-level rights.
 *
 * Rule: every new hub mini-app and every new domain object MUST be registered here
 * with view/create/edit/delete (or explicit legacy permission codes). Roles UI,
 * API gates, and hub tiles are derived from this file.
 */

export const CRUD_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type CrudAction = (typeof CRUD_ACTIONS)[number];

export const CRUD_ACTION_LABELS: Record<CrudAction, string> = {
  view: "Просмотр",
  create: "Создание",
  edit: "Редактирование",
  delete: "Удаление",
};

export type RoleSeedId = "employee" | "warehouse_manager";

export type FeaturePermissionDef = {
  code: string;
  label: string;
  /** Include in default seed roles when those roles are (re)created. */
  defaultFor?: RoleSeedId[];
};

export type FeatureObjectDef = {
  id: string;
  title: string;
  /** Generates `<appId>.<objectId>.<action>` permissions. */
  actions: CrudAction[];
  defaultFor?: RoleSeedId[];
};

export type FeatureAppDef = {
  id: string;
  title: string;
  description: string;
  /** Hub tile. Omit only for non-hub internal groups (not used currently). */
  hub: {
    path: string;
    status: "live" | "soon";
    accent: string;
    /** Lucide icon component name mapped on the frontend. */
    icon: string;
  };
  /**
   * Permission to see the app on the hub. Defaults to `app.<id>`.
   * Use a custom code when the hub gate must differ from `app.<id>`.
   */
  appPermission?: FeaturePermissionDef;
  /** Extra flat permissions in this app's role group (legacy / non-CRUD). */
  permissions?: FeaturePermissionDef[];
  /** Domain objects with standard CRUD rights. */
  objects?: FeatureObjectDef[];
  /** Seed `app.<id>` (or custom appPermission) for these roles. */
  defaultFor?: RoleSeedId[];
};

/** Build standard object permission code. */
export function objectPerm(appId: string, objectId: string, action: CrudAction): string {
  return `${appId}.${objectId}.${action}`;
}

export function defaultAppPermCode(appId: string): string {
  return `app.${appId}`;
}

/**
 * Registry of hub mini-apps.
 * Order = hub tile order.
 */
export const FEATURE_APPS: FeatureAppDef[] = [
  {
    id: "tasks",
    title: "Менеджер задач",
    description: "Задачи, чеклисты, планировщик и идеи",
    hub: {
      path: "/tasks",
      status: "live",
      accent: "from-orange-500 to-amber-400",
      icon: "Zap",
    },
    defaultFor: ["employee"],
    permissions: [
      { code: "tasks.view", label: "Просмотр задач", defaultFor: ["employee"] },
      { code: "tasks.create", label: "Создание задач", defaultFor: ["employee"] },
      { code: "tasks.edit_own", label: "Редактирование своих", defaultFor: ["employee"] },
      { code: "tasks.delete_own", label: "Удаление своих", defaultFor: ["employee"] },
      { code: "tasks.manage_any", label: "Управление любыми" },
      { code: "tasks.ideas", label: "Идеи", defaultFor: ["employee"] },
      { code: "tasks.planner", label: "Планировщик", defaultFor: ["employee"] },
    ],
  },
  {
    id: "stockmap",
    title: "Карта склада",
    description: "Интерактивная карта стеллажей и остатков",
    hub: {
      path: "/stockmap",
      status: "live",
      accent: "from-sky-500 to-cyan-400",
      icon: "Map",
    },
    defaultFor: ["employee", "warehouse_manager"],
    permissions: [
      {
        code: "stockmap.view",
        label: "Просмотр карты",
        defaultFor: ["employee", "warehouse_manager"],
      },
      {
        code: "stockmap.edit_map",
        label: "Редактирование карты",
        defaultFor: ["warehouse_manager"],
      },
      {
        code: "stockmap.edit_shelves",
        label: "Редактирование полок",
        defaultFor: ["employee", "warehouse_manager"],
      },
    ],
  },
  {
    id: "structure",
    title: "Структура",
    description: "Список сотрудников и их профили",
    hub: {
      path: "/structure",
      status: "live",
      accent: "from-teal-500 to-emerald-400",
      icon: "Network",
    },
    defaultFor: ["employee"],
  },
  {
    id: "administration",
    title: "Администрирование",
    description: "Сотрудники, роли и права доступа",
    hub: {
      path: "/administration",
      status: "live",
      accent: "from-slate-600 to-slate-400",
      icon: "Shield",
    },
    permissions: [{ code: "roles.manage", label: "Управление ролями" }],
  },
  {
    id: "reference",
    title: "Справочник",
    description: "Готовая продукция и комплектующие",
    hub: {
      path: "/reference",
      status: "live",
      accent: "from-violet-500 to-purple-400",
      icon: "BookOpen",
    },
    permissions: [
      {
        code: "reference.catalog.read",
        label: "Чтение каталога (для карты склада)",
        defaultFor: ["employee", "warehouse_manager"],
      },
    ],
    objects: [
      {
        id: "products",
        title: "Готовая продукция",
        actions: ["view", "create", "edit", "delete"],
      },
      {
        id: "components",
        title: "Комплектующие",
        actions: ["view", "create", "edit", "delete"],
      },
      {
        id: "tags",
        title: "Типы комплектующих",
        actions: ["view", "create", "edit", "delete"],
      },
    ],
  },
  {
    id: "news",
    title: "Новости",
    description: "Новости и объявления",
    hub: {
      path: "/news",
      status: "live",
      accent: "from-orange-500 to-amber-400",
      icon: "Newspaper",
    },
    permissions: [
      { code: "news.edit_own", label: "Редактирование своих новостей" },
      { code: "news.delete_own", label: "Удаление своих новостей" },
      { code: "news.manage_any", label: "Редактирование и удаление любых новостей" },
      { code: "news.release_patch", label: "Выпуск патчноута" },
    ],
    objects: [
      {
        id: "posts",
        title: "Новости",
        actions: ["view", "create"],
      },
    ],
  },
  {
    id: "orders",
    title: "Заказы",
    description: "Заказы с производства",
    hub: {
      path: "/apps/orders",
      status: "soon",
      accent: "from-rose-500 to-pink-400",
      icon: "Factory",
    },
  },
];

export type DerivedPermission = {
  code: string;
  label: string;
  groupId: string;
  groupLabel: string;
  defaultFor: RoleSeedId[];
};

export type DerivedHubApp = {
  id: string;
  title: string;
  description: string;
  path: string;
  status: "live" | "soon";
  accent: string;
  icon: string;
  permission: string;
};

function appAccessPermission(app: FeatureAppDef): FeaturePermissionDef {
  if (app.appPermission) return app.appPermission;
  return {
    code: defaultAppPermCode(app.id),
    label: app.title,
    defaultFor: app.defaultFor,
  };
}

/** Flatten registry into permission rows for the roles catalog. */
export function derivePermissions(): DerivedPermission[] {
  const rows: DerivedPermission[] = [];

  for (const app of FEATURE_APPS) {
    const access = appAccessPermission(app);
    rows.push({
      code: access.code,
      label: access.label,
      groupId: "hub",
      groupLabel: "Приложения",
      defaultFor: access.defaultFor ?? app.defaultFor ?? [],
    });

    const groupId = app.id;
    const groupLabel = app.title;

    for (const perm of app.permissions ?? []) {
      rows.push({
        code: perm.code,
        label: perm.label,
        groupId,
        groupLabel,
        defaultFor: perm.defaultFor ?? [],
      });
    }

    for (const obj of app.objects ?? []) {
      for (const action of obj.actions) {
        rows.push({
          code: objectPerm(app.id, obj.id, action),
          label: `${obj.title}: ${CRUD_ACTION_LABELS[action]}`,
          groupId,
          groupLabel,
          defaultFor: obj.defaultFor ?? [],
        });
      }
    }
  }

  return rows;
}

export function deriveHubApps(): DerivedHubApp[] {
  return FEATURE_APPS.map((app) => {
    const access = appAccessPermission(app);
    return {
      id: app.id,
      title: app.title,
      description: app.description,
      path: app.hub.path,
      status: app.hub.status,
      accent: app.hub.accent,
      icon: app.hub.icon,
      permission: access.code,
    };
  });
}

export function derivePermissionCodes(): string[] {
  return derivePermissions().map((p) => p.code);
}

export function derivePermissionGroups(): {
  id: string;
  label: string;
  permissions: { code: string; label: string }[];
}[] {
  const rows = derivePermissions();
  const order: string[] = ["hub", ...FEATURE_APPS.map((a) => a.id)];
  const byGroup = new Map<string, { id: string; label: string; permissions: { code: string; label: string }[] }>();

  for (const row of rows) {
    let group = byGroup.get(row.groupId);
    if (!group) {
      group = { id: row.groupId, label: row.groupLabel, permissions: [] };
      byGroup.set(row.groupId, group);
    }
    if (!group.permissions.some((p) => p.code === row.code)) {
      group.permissions.push({ code: row.code, label: row.label });
    }
  }

  return order.filter((id) => byGroup.has(id)).map((id) => byGroup.get(id)!);
}

export function deriveSeedPermissions(seed: RoleSeedId): string[] {
  const codes = new Set<string>();
  for (const row of derivePermissions()) {
    if (row.defaultFor.includes(seed)) codes.add(row.code);
  }
  return [...codes];
}
