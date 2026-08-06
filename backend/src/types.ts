export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed";

export interface User {
  id: number;
  nickname: string;
  password_hash: string;
  parent_id: number | null;
  role_id: number | null;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
}

export interface UserPublic {
  id: number;
  nickname: string;
  parent_id: number | null;
  role_id: number | null;
  role_name?: string | null;
  permissions?: string[];
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
}

export interface TaskAssignee extends UserPublic {
  completed_at: string | null;
}

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
}

export interface TaskWithAssignees extends Task {
  assignees: TaskAssignee[];
  creator: UserPublic;
  completed_by_user: UserPublic | null;
}

export function isRoot(user: UserPublic): boolean {
  return user.parent_id === null;
}

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
}

export interface IdeaWithCreator extends Idea {
  creator: UserPublic;
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
}

export interface ChecklistWithDetails extends Checklist {
  items: ChecklistItem[];
  creator: UserPublic;
  assignee: UserPublic;
}
