export interface User {
  id: number;
  nickname: string;
  parent_id: number | null;
  role_id?: number | null;
  role_name?: string | null;
  permissions?: string[];
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
}

export type ProfileKpi = {
  completed: number;
  expired: number;
  active: number;
  expecting: number;
};

export type UserProfile = {
  id: number;
  nickname: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role_id: number | null;
  role_name: string | null;
  parent_id: number | null;
  kpi: ProfileKpi;
};

export function displayName(user: {
  nickname: string;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const full = [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(" ");
  return full || user.nickname;
}

export function initialsOf(user: {
  nickname: string;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const first = user.first_name?.trim()?.[0];
  const last = user.last_name?.trim()?.[0];
  if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase();
  return user.nickname.slice(0, 2).toUpperCase();
}

export type PermissionCode = string;

export interface Role {
  id: number;
  name: string;
  description: string;
  created_at: string;
  permissions: PermissionCode[];
}

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: { code: PermissionCode; label: string }[];
}

export function can(user: User | null | undefined, code: PermissionCode): boolean {
  if (!user) return false;
  if (user.parent_id === null) return true;
  return Boolean(user.permissions?.includes(code));
}

export function isRoot(user: User): boolean {
  return user.parent_id === null;
}

export type ReferenceKind = "products" | "components" | "tags";

export type ProductLabelKind = "name" | "tag";

export interface ReferenceProduct {
  id: number;
  name: string;
  /** Short label for the finished product. */
  tag: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

/** Product linked to a component, with chosen card label (full name or short tag). */
export interface ReferenceComponentProduct extends ReferenceProduct {
  display_as: ProductLabelKind;
  /** Text shown on the component card. */
  label: string;
}

export interface ReferenceTag {
  id: number;
  name: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ReferenceComponent {
  id: number;
  name: string;
  type_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  type: ReferenceTag | null;
  products: ReferenceComponentProduct[];
}

export interface NewsAuthor {
  id: number;
  nickname: string;
}

export interface NewsReader {
  id: number;
  nickname: string;
  read_at: string;
}

export interface NewsPostListItem {
  id: number;
  title: string;
  excerpt: string;
  author: NewsAuthor;
  created_at: string;
  updated_at: string;
  readers_count: number;
  read_by_me: boolean;
}

export interface NewsPost {
  id: number;
  title: string;
  body_html: string;
  author: NewsAuthor;
  author_id: number;
  created_at: string;
  updated_at: string;
  readers: NewsReader[];
  readers_count: number;
  read_by_me: boolean;
}

export interface NotifPrefs {
  channel_tasks: boolean;
  channel_news: boolean;
  channel_orders: boolean;
  channel_reference: boolean;
  channel_stockmap: boolean;
  task_assigned: boolean;
  task_changed: boolean;
  task_assignee_done: boolean;
  task_fully_done: boolean;
  task_remind_1h: boolean;
  task_remind_morning: boolean;
  task_overdue: boolean;
  task_comments: boolean;
  news_any: boolean;
}

export interface TaskAssignee extends User {
  completed_at: string | null;
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: number;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  created_by: number;
  created_at: string;
  completed_at: string | null;
  completed_by: number | null;
  is_shared: boolean;
  is_private: boolean;
  due_at: string | null;
  planned_for: string | null;
  auto_completed: boolean;
  assignees: TaskAssignee[];
  creator: User;
  completed_by_user: User | null;
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Ожидает",
  in_progress: "В работе",
  completed: "Завершена",
};

export type IdeaTag = "entertainment" | "work";
export type IdeaPrivacy = "personal" | "public";
export type IdeaStatus = "open" | "completed";

export interface Idea {
  id: number;
  title: string;
  description: string;
  tag: IdeaTag;
  due_at: string | null;
  privacy: IdeaPrivacy;
  status: IdeaStatus;
  created_by: number;
  created_at: string;
  completed_at: string | null;
  creator: User;
}

export const IDEA_TAG_LABELS: Record<IdeaTag, string> = {
  entertainment: "Развлечение",
  work: "Работа",
};

export const IDEA_PRIVACY_LABELS: Record<IdeaPrivacy, string> = {
  personal: "Личная",
  public: "Общая",
};

/** Активна ли задача для конкретного пользователя (вкладки, кнопки). */
export function isTaskActiveForUser(task: Task, userId: number): boolean {
  if (task.is_shared) {
    return task.status === "pending" || task.status === "in_progress";
  }

  if (task.status === "completed") return false;

  const assignee = task.assignees.find((a) => a.id === userId);
  if (assignee) return assignee.completed_at === null;

  return task.assignees.some((a) => a.completed_at === null);
}

export function isTaskCompletedForUser(task: Task, userId: number): boolean {
  return !isTaskActiveForUser(task, userId);
}

export type ChecklistStatus = "open" | "completed";

export interface ChecklistItem {
  id: number;
  checklist_id: number;
  title: string;
  position: number;
  completed_at: string | null;
}

export interface Checklist {
  id: number;
  title: string;
  created_by: number;
  assignee_id: number;
  status: ChecklistStatus;
  created_at: string;
  expires_at: string | null;
  planned_for: string | null;
  completed_at: string | null;
  auto_completed: boolean;
  is_private: boolean;
  items: ChecklistItem[];
  creator: User;
  assignee: User;
}

export type PresetKind = "task" | "checklist";

export interface Preset {
  id: number;
  created_by: number;
  kind: PresetKind;
  name: string;
  title: string;
  description: string;
  priority: TaskPriority | null;
  has_deadline: boolean | null;
  items: string[];
  created_at: string;
}

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
}

export function buildTree<T extends { id: number; parent_id: number | null }>(
  items: T[]
): TreeNode<T>[] {
  const map = new Map<number, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];

  for (const item of items) {
    map.set(item.id, { item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parent_id !== null && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
