-- Task Manager schema (user tree + roles)

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  parent_id INTEGER REFERENCES users(id),
  role_id INTEGER REFERENCES roles(id),
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id),
  is_shared INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  planned_for TEXT,
  auto_completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  completed_at TEXT,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

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

CREATE INDEX IF NOT EXISTS idx_ideas_created_by ON ideas(created_by);
CREATE INDEX IF NOT EXISTS idx_ideas_privacy ON ideas(privacy);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);

CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  planned_for TEXT,
  completed_at TEXT,
  auto_completed INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_checklists_status ON checklists(status);
CREATE INDEX IF NOT EXISTS idx_checklists_assignee ON checklists(assignee_id);
CREATE INDEX IF NOT EXISTS idx_checklists_expires ON checklists(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_presets_created_by ON presets(created_by);
CREATE INDEX IF NOT EXISTS idx_presets_kind ON presets(kind);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_send_log (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reference_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS reference_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  type_id INTEGER REFERENCES reference_tags(id)
);

CREATE TABLE IF NOT EXISTS reference_component_products (
  component_id INTEGER NOT NULL REFERENCES reference_components(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES reference_products(id) ON DELETE CASCADE,
  display_as TEXT NOT NULL DEFAULT 'tag' CHECK (display_as IN ('name', 'tag')),
  PRIMARY KEY (component_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reference_products_name ON reference_products(name);
CREATE INDEX IF NOT EXISTS idx_reference_components_name ON reference_components(name);
CREATE INDEX IF NOT EXISTS idx_reference_tags_name ON reference_tags(name);
CREATE INDEX IF NOT EXISTS idx_reference_cp_product ON reference_component_products(product_id);

CREATE TABLE IF NOT EXISTS news_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_reads (
  post_id INTEGER NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_news_posts_created ON news_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_reads_user ON news_reads(user_id);

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
