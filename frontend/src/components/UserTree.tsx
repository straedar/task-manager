import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Crown,
  Pencil,
  Plus,
  Shield,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import type { TreeNode, User } from "../types";

interface UserTreeProps {
  nodes: TreeNode<User>[];
  currentUserId?: number;
  onAddChild: (parentId: number | null) => void;
  onMove: (user: User) => void;
  onChangeRole?: (user: User) => void;
  onDelete: (user: User) => void;
}

function TreeNodeView({
  node,
  depth,
  currentUserId,
  onAddChild,
  onMove,
  onChangeRole,
  onDelete,
}: {
  node: TreeNode<User>;
  depth: number;
  currentUserId?: number;
  onAddChild: (parentId: number | null) => void;
  onMove: (user: User) => void;
  onChangeRole?: (user: User) => void;
  onDelete: (user: User) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { item, children } = node;
  const isRootUser = item.parent_id === null;
  const hasChildren = children.length > 0;

  return (
    <div className={depth > 0 ? "ml-5 border-l-2 border-orange-100 pl-4" : ""}>
      <div className="group mb-2 flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-soft transition hover:shadow-md">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-orange-500"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isRootUser ? "gradient-accent text-white" : "bg-orange-50 text-orange-500"
          }`}
        >
          {isRootUser ? <Crown className="h-4 w-4" /> : <UserIcon className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900">{item.nickname}</p>
          <p className="truncate text-xs text-gray-400">
            {isRootUser
              ? "Корень · все права"
              : item.role_name
                ? item.role_name
                : "Без роли"}
          </p>
        </div>

        {item.id === currentUserId && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">Вы</span>
        )}

        <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onAddChild(item.id)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-500"
            title="Добавить подчинённого"
          >
            <Plus className="h-4 w-4" />
          </button>
          {!isRootUser && (
            <>
              {onChangeRole && (
                <button
                  type="button"
                  onClick={() => onChangeRole(item)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-500"
                  title="Сменить роль"
                >
                  <Shield className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onMove(item)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-orange-50 hover:text-orange-500"
                title="Переместить"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded &&
        children.map((child) => (
          <TreeNodeView
            key={child.item.id}
            node={child}
            depth={depth + 1}
            currentUserId={currentUserId}
            onAddChild={onAddChild}
            onMove={onMove}
            onChangeRole={onChangeRole}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

export function UserTree({
  nodes,
  currentUserId,
  onAddChild,
  onMove,
  onChangeRole,
  onDelete,
}: UserTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="rounded-3xl bg-white py-12 text-center text-gray-400 shadow-soft">
        Нет пользователей
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <TreeNodeView
          key={node.item.id}
          node={node}
          depth={0}
          currentUserId={currentUserId}
          onAddChild={onAddChild}
          onMove={onMove}
          onChangeRole={onChangeRole}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
