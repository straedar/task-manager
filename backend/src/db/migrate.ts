import type { DatabaseSync } from "node:sqlite";

export function migrate(db: DatabaseSync) {
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const colNames = new Set(userCols.map((c) => c.name));

  if (!colNames.has("parent_id")) {
    if (colNames.has("role_id") || colNames.has("role") || colNames.has("department_id")) {
      const adminNickname = process.env.SEED_ADMIN_NICKNAME ?? "admin";
      const oldUsers = db.prepare("SELECT id, nickname, password_hash FROM users ORDER BY id").all() as {
        id: number;
        nickname: string;
        password_hash: string;
      }[];

      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nickname TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          parent_id INTEGER REFERENCES users(id)
        );
      `);

      const admin = oldUsers.find((u) => u.nickname === adminNickname) ?? oldUsers[0];
      let adminNewId = 0;

      if (admin) {
        const r = db
          .prepare("INSERT INTO users_new (nickname, password_hash, parent_id) VALUES (?, ?, NULL)")
          .run(admin.nickname, admin.password_hash);
        adminNewId = Number(r.lastInsertRowid);
      }

      for (const u of oldUsers) {
        if (admin && u.id === admin.id) continue;
        db.prepare("INSERT INTO users_new (nickname, password_hash, parent_id) VALUES (?, ?, ?)").run(
          u.nickname,
          u.password_hash,
          adminNewId || null
        );
      }

      db.exec("DROP TABLE users");
      db.exec("ALTER TABLE users_new RENAME TO users");
    } else {
      db.exec("ALTER TABLE users ADD COLUMN parent_id INTEGER REFERENCES users(id)");
    }
  }

  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (taskCols.some((c) => c.name === "department_id")) {
    db.exec(`
      CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        completed_by INTEGER REFERENCES users(id)
      );
    `);
    db.exec(`
      INSERT INTO tasks_new (id, title, description, priority, status, created_by, created_at, completed_at, completed_by)
      SELECT id, title, description, priority, status, created_by, created_at, completed_at, completed_by FROM tasks
    `);
    db.exec("DROP TABLE tasks");
    db.exec("ALTER TABLE tasks_new RENAME TO tasks");
  }

  // Legacy org departments only — do not drop the modern `roles` table
  db.exec("DROP TABLE IF EXISTS departments");

  db.exec("CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id)");

  migrateTaskStatuses(db);
  migrateSharedTasks(db);
  migrateIdeas(db);
  migrateChecklists(db);
  migratePlannerFields(db);
  migratePresets(db);
  migratePrivateItems(db);
  migrateSharedChecklists(db);
  migratePush(db);
  migrateTaskAutoCompleted(db);
  migrateRoles(db);
  migrateReference(db);
  migrateCatalogReadForStockmap(db);
  migrateNewsOwnPermissions(db);
  migrateNewsPatchTables(db);
  migrateNewsChannels(db);
  migrateUserProfile(db);
  migrateAdminStructureRename(db);
  migrateStructureAppPermission(db);
  migratePasswordRestore(db);
  migrateItemMessages(db);
  migrateFeedback(db);
}

function migrateFeedback(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES feedback_batches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('problem', 'improvement')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feedback_batches_author ON feedback_batches(author_id)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feedback_batches_created ON feedback_batches(created_at DESC)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feedback_items_batch ON feedback_items(batch_id, sort_order)`
  );

  const itemCols = db
    .prepare("PRAGMA table_info(feedback_items)")
    .all() as { name: string }[];
  if (!itemCols.some((c) => c.name === "admin_done")) {
    db.exec(
      `ALTER TABLE feedback_items ADD COLUMN admin_done INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!itemCols.some((c) => c.name === "admin_comment")) {
    db.exec(
      `ALTER TABLE feedback_items ADD COLUMN admin_comment TEXT NOT NULL DEFAULT ''`
    );
  }
}

function migrateItemMessages(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'checklist')),
      ref_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_item_messages_thread ON item_messages(kind, ref_id, id)`
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_message_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('task', 'checklist')),
      ref_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, kind, ref_id)
    );
  `);
}

function migratePasswordRestore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_restore_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_password_restore_user ON password_restore_codes(user_id)`
  );
  db.exec(`DROP TABLE IF EXISTS reference_item_aliases`);
}

/** Grant «Структура» to roles that already have tasks (or employee seed). */
function migrateStructureAppPermission(db: DatabaseSync) {
  db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission)
     SELECT DISTINCT role_id, 'app.structure'
     FROM role_permissions
     WHERE permission IN ('app.tasks', 'tasks.view')`
  ).run();
}

/** Renamed mini-app Structure → Administration; keep role grants. */
function migrateAdminStructureRename(db: DatabaseSync) {
  db.prepare(
    `UPDATE role_permissions SET permission = 'app.administration'
     WHERE permission = 'tasks.admin_structure'`
  ).run();
}

function migrateUserProfile(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "first_name")) {
    db.exec(`ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "last_name")) {
    db.exec(`ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "avatar_url")) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
  }
}

function migrateNewsPatchTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_patch_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      release_day TEXT NOT NULL UNIQUE,
      post_id INTEGER NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      prefs_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Map legacy news.posts.edit/delete → news.edit_own / news.delete_own. */
function migrateNewsOwnPermissions(db: DatabaseSync) {
  db.exec(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission)
    SELECT role_id, 'news.edit_own'
    FROM role_permissions
    WHERE permission = 'news.posts.edit'
  `);
  db.exec(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission)
    SELECT role_id, 'news.delete_own'
    FROM role_permissions
    WHERE permission = 'news.posts.delete'
  `);
  db.exec(`
    DELETE FROM role_permissions
    WHERE permission IN ('news.posts.edit', 'news.posts.delete')
  `);
}

/** Grant catalog read to roles that already have warehouse map access. */
function migrateCatalogReadForStockmap(db: DatabaseSync) {
  db.exec(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission)
    SELECT DISTINCT role_id, 'reference.catalog.read'
    FROM role_permissions
    WHERE permission IN ('stockmap.view', 'app.stockmap')
  `);
}

function migrateReference(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reference_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reference_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reference_component_products (
      component_id INTEGER NOT NULL REFERENCES reference_components(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES reference_products(id) ON DELETE CASCADE,
      display_as TEXT NOT NULL DEFAULT 'tag',
      PRIMARY KEY (component_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reference_products_name ON reference_products(name);
    CREATE INDEX IF NOT EXISTS idx_reference_components_name ON reference_components(name);
    CREATE INDEX IF NOT EXISTS idx_reference_tags_name ON reference_tags(name);
    CREATE INDEX IF NOT EXISTS idx_reference_cp_product ON reference_component_products(product_id);
  `);

  const componentCols = db
    .prepare("PRAGMA table_info(reference_components)")
    .all() as { name: string }[];
  if (!componentCols.some((c) => c.name === "type_id")) {
    db.exec(
      `ALTER TABLE reference_components ADD COLUMN type_id INTEGER REFERENCES reference_tags(id)`
    );
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reference_components_type ON reference_components(type_id)`
  );

  const productCols = db
    .prepare("PRAGMA table_info(reference_products)")
    .all() as { name: string }[];
  if (!productCols.some((c) => c.name === "tag")) {
    db.exec(`ALTER TABLE reference_products ADD COLUMN tag TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE reference_products SET tag = name WHERE trim(tag) = ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_products_tag ON reference_products(tag)`);

  const linkCols = db
    .prepare("PRAGMA table_info(reference_component_products)")
    .all() as { name: string }[];
  if (!linkCols.some((c) => c.name === "display_as")) {
    db.exec(
      `ALTER TABLE reference_component_products ADD COLUMN display_as TEXT NOT NULL DEFAULT 'tag'`
    );
  }
  const linkColsAfter = db
    .prepare("PRAGMA table_info(reference_component_products)")
    .all() as { name: string }[];
  if (!linkColsAfter.some((c) => c.name === "quantity")) {
    db.exec(
      `ALTER TABLE reference_component_products ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`
    );
  }
}

function migrateRoles(db: DatabaseSync) {
  const rolesSql = (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='roles'`)
      .get() as { sql: string } | undefined
  )?.sql;

  // Drop legacy roles table (old schema without description/created_at)
  if (rolesSql && !rolesSql.includes("description")) {
    db.exec("DROP TABLE roles");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_id, permission)
    );
  `);

  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "role_id")) {
    db.exec("ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id)");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id)");
}

function migrateTaskAutoCompleted(db: DatabaseSync) {
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "auto_completed")) {
    db.exec("ALTER TABLE tasks ADD COLUMN auto_completed INTEGER NOT NULL DEFAULT 0");
  }
}

function migratePush(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_send_log (
      key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function migratePrivateItems(db: DatabaseSync) {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskCols.some((c) => c.name === "is_private")) {
    db.exec("ALTER TABLE tasks ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0");
  }

  const checklistCols = db.prepare("PRAGMA table_info(checklists)").all() as { name: string }[];
  if (!checklistCols.some((c) => c.name === "is_private")) {
    db.exec("ALTER TABLE checklists ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0");
  }
}

function migrateSharedChecklists(db: DatabaseSync) {
  const checklistCols = db.prepare("PRAGMA table_info(checklists)").all() as { name: string }[];
  if (checklistCols.length === 0) return;
  if (!checklistCols.some((c) => c.name === "is_shared")) {
    db.exec("ALTER TABLE checklists ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0");
  }

  const itemCols = db.prepare("PRAGMA table_info(checklist_items)").all() as { name: string }[];
  if (itemCols.length === 0) return;
  if (!itemCols.some((c) => c.name === "claimed_by")) {
    db.exec("ALTER TABLE checklist_items ADD COLUMN claimed_by INTEGER REFERENCES users(id)");
  }
  if (!itemCols.some((c) => c.name === "claimed_at")) {
    db.exec("ALTER TABLE checklist_items ADD COLUMN claimed_at TEXT");
  }
}

function migratePresets(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('task', 'checklist')),
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
      has_deadline INTEGER,
      items_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_presets_created_by ON presets(created_by)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_presets_kind ON presets(kind)");
}

function migratePlannerFields(db: DatabaseSync) {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = new Set(taskCols.map((c) => c.name));
  if (!taskColNames.has("due_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN due_at TEXT");
  }
  if (!taskColNames.has("planned_for")) {
    db.exec("ALTER TABLE tasks ADD COLUMN planned_for TEXT");
  }

  const checklistCols = db.prepare("PRAGMA table_info(checklists)").all() as { name: string }[];
  const checklistColNames = new Set(checklistCols.map((c) => c.name));
  if (!checklistColNames.has("planned_for")) {
    db.exec("ALTER TABLE checklists ADD COLUMN planned_for TEXT");
  }

  // Backfill calendar day keys using Moscow timezone
  const { moscowDateKey } = requireMoscow();
  const taskRows = db
    .prepare("SELECT id, due_at FROM tasks WHERE planned_for IS NULL AND due_at IS NOT NULL")
    .all() as { id: number; due_at: string }[];
  const updateTaskPlanned = db.prepare("UPDATE tasks SET planned_for = ? WHERE id = ?");
  for (const row of taskRows) {
    const date = new Date(row.due_at.includes("T") ? row.due_at : `${row.due_at.replace(" ", "T")}Z`);
    if (!Number.isNaN(date.getTime())) updateTaskPlanned.run(moscowDateKey(date), row.id);
  }

  const checklistRows = db
    .prepare(
      "SELECT id, expires_at FROM checklists WHERE planned_for IS NULL AND expires_at IS NOT NULL"
    )
    .all() as { id: number; expires_at: string }[];
  const updateClPlanned = db.prepare("UPDATE checklists SET planned_for = ? WHERE id = ?");
  for (const row of checklistRows) {
    const date = new Date(
      row.expires_at.includes("T") ? row.expires_at : `${row.expires_at.replace(" ", "T")}Z`
    );
    if (!Number.isNaN(date.getTime())) updateClPlanned.run(moscowDateKey(date), row.id);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_planned ON tasks(planned_for)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_planned ON checklists(planned_for)");
}

function requireMoscow() {
  // inline to avoid circular imports during migrate
  function moscowDateKey(date = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")!.value;
    const m = parts.find((p) => p.type === "month")!.value;
    const d = parts.find((p) => p.type === "day")!.value;
    return `${y}-${m}-${d}`;
  }
  return { moscowDateKey };
}

function migrateChecklists(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      completed_at TEXT,
      auto_completed INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_status ON checklists(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_assignee ON checklists(assignee_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_expires ON checklists(expires_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id)");

  migrateChecklistExpiresNullable(db);
}

/** Allow checklists without a deadline (expires_at NULL). */
function migrateChecklistExpiresNullable(db: DatabaseSync) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='checklists'")
    .get() as { sql: string } | undefined;

  if (!row?.sql || !row.sql.includes("expires_at TEXT NOT NULL")) return;

  db.exec(`
    CREATE TABLE checklists_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      assignee_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      completed_at TEXT,
      auto_completed INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`
    INSERT INTO checklists_new
      (id, title, created_by, assignee_id, status, created_at, expires_at, completed_at, auto_completed)
    SELECT id, title, created_by, assignee_id, status, created_at, expires_at, completed_at, auto_completed
    FROM checklists
  `);
  db.exec("DROP TABLE checklists");
  db.exec("ALTER TABLE checklists_new RENAME TO checklists");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_status ON checklists(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_assignee ON checklists(assignee_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_checklists_expires ON checklists(expires_at)");
}

function migrateIdeas(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tag TEXT NOT NULL CHECK (tag IN ('entertainment', 'work')),
      due_at TEXT,
      privacy TEXT NOT NULL DEFAULT 'personal' CHECK (privacy IN ('personal', 'public')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ideas_created_by ON ideas(created_by)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ideas_privacy ON ideas(privacy)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status)");
}

function migrateSharedTasks(db: DatabaseSync) {
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!taskCols.some((c) => c.name === "is_shared")) {
    db.exec("ALTER TABLE tasks ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0");
    // Сохраняем прежнее поведение для существующих задач с несколькими исполнителями
    db.exec(`
      UPDATE tasks SET is_shared = 1
      WHERE id IN (
        SELECT task_id FROM task_assignees GROUP BY task_id HAVING COUNT(*) > 1
      )
    `);
  }

  const assigneeCols = db.prepare("PRAGMA table_info(task_assignees)").all() as { name: string }[];
  if (!assigneeCols.some((c) => c.name === "completed_at")) {
    db.exec("ALTER TABLE task_assignees ADD COLUMN completed_at TEXT");
    db.exec(`
      UPDATE task_assignees
      SET completed_at = (SELECT completed_at FROM tasks WHERE tasks.id = task_assignees.task_id)
      WHERE task_id IN (SELECT id FROM tasks WHERE status = 'completed')
    `);
  }
}

function migrateNewsChannels(db: DatabaseSync) {
  const newsCols = db.prepare("PRAGMA table_info(news_posts)").all() as { name: string }[];
  if (newsCols.length === 0) return;
  if (!newsCols.some((c) => c.name === "channel")) {
    db.exec(
      `ALTER TABLE news_posts ADD COLUMN channel TEXT NOT NULL DEFAULT 'company'`
    );
  }
  db.exec(`
    UPDATE news_posts
    SET channel = 'patch'
    WHERE id IN (SELECT post_id FROM news_patch_releases)
      AND channel != 'patch'
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_posts_channel ON news_posts(channel)`);
}

function migrateTaskStatuses(db: DatabaseSync) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'")
    .get() as { sql: string } | undefined;

  if (!row?.sql || row.sql.includes("in_progress")) return;

  db.exec(`
    CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id)
    );
  `);
  db.exec(`
    INSERT INTO tasks_new (id, title, description, priority, status, created_by, created_at, completed_at, completed_by)
    SELECT id, title, description, priority, status, created_by, created_at, completed_at, completed_by FROM tasks
  `);
  db.exec("DROP TABLE tasks");
  db.exec("ALTER TABLE tasks_new RENAME TO tasks");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
}
