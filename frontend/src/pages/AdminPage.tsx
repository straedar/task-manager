import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Plus, Shield, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { api } from "../api/client";
import type { Role, User } from "../types";
import { buildTree } from "../types";
import { UserTree } from "../components/UserTree";
import { HubBackButton } from "../components/HubBackButton";
import { Select } from "../components/Select";
import { RolesPanel } from "../components/RolesPanel";

type AdminTab = "people" | "roles";

export function AdminPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { confirm } = useDialog();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AdminTab>("people");

  const [dialog, setDialog] = useState<
    | { type: "add"; parentId: number | null }
    | { type: "move"; user: User }
    | { type: "role"; user: User }
    | null
  >(null);
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<number | "">("");
  const [moveParentId, setMoveParentId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  const tree = useMemo(() => buildTree(users), [users]);

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: String(r.id), label: r.name, depth: 0, isRoot: false })),
    [roles]
  );

  const parentOptions = useMemo(() => {
    if (dialog?.type !== "move") return [];

    const excluded = new Set<number>([dialog.user.id]);
    const collectDescendants = (parentId: number) => {
      for (const u of users) {
        if (u.parent_id === parentId && !excluded.has(u.id)) {
          excluded.add(u.id);
          collectDescendants(u.id);
        }
      }
    };
    collectDescendants(dialog.user.id);

    return users.filter((u) => !excluded.has(u.id));
  }, [dialog, users]);

  const parentSelectOptions = useMemo(() => {
    const optionTree = buildTree(parentOptions);
    const flat: { value: string; label: string; depth: number; isRoot: boolean }[] = [];
    const walk = (nodes: ReturnType<typeof buildTree<User>>, depth: number) => {
      for (const n of nodes) {
        flat.push({
          value: String(n.item.id),
          label: n.item.nickname,
          depth,
          isRoot: n.item.parent_id === null,
        });
        walk(n.children, depth + 1);
      }
    };
    walk(optionTree, 0);
    return flat;
  }, [parentOptions]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ users }, rolesRes] = await Promise.all([
        api.getUserTree(),
        api.listRoles().catch(() => ({ roles: [] as Role[] })),
      ]);
      setUsers(users);
      setRoles(rolesRes.roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && can("app.administration")) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when user session ready
  }, [user]);

  useEffect(() => {
    if (tab === "people" && user && can("app.administration")) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh role list after editing roles
  }, [tab]);

  const closeDialog = () => {
    setDialog(null);
    setNickname("");
    setPassword("");
    setRoleId("");
    setMoveParentId("");
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog || dialog.type !== "add") return;
    setSaving(true);
    setError("");
    try {
      await api.createUser({
        nickname,
        password,
        parent_id: dialog.parentId,
        role_id: roleId === "" ? null : Number(roleId),
      });
      closeDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog || dialog.type !== "move") return;
    setSaving(true);
    setError("");
    try {
      await api.moveUser(
        dialog.user.id,
        moveParentId === "" ? null : Number(moveParentId)
      );
      closeDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const handleRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog || dialog.type !== "role") return;
    setSaving(true);
    setError("");
    try {
      await api.updateUserRole(
        dialog.user.id,
        roleId === "" ? null : Number(roleId)
      );
      closeDialog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: User) => {
    const ok = await confirm({
      title: `Удалить пользователя «${u.nickname}»?`,
      description: "Это действие нельзя отменить.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">Загрузка...</div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.administration")) return <Navigate to="/" replace />;

  const canManageRoles = can("roles.manage");

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-10 pt-6">
      <header className="mb-4">
        <div className="mb-2">
          <HubBackButton />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <Shield className="h-7 w-7 shrink-0 text-orange-500" />
              Администрирование
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {tab === "roles" ? "Создание ролей и настройка прав" : "Дерево сотрудников"}
            </p>
          </div>
          {tab === "people" && (
            <button
              type="button"
              onClick={() => {
                const defaultRole = roles.find((r) => r.name === "Сотрудник");
                setRoleId(defaultRole?.id ?? "");
                setDialog({ type: "add", parentId: user.id });
              }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-accent text-white shadow"
              aria-label="Добавить сотрудника"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      {canManageRoles && (
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setTab("people")}
            className={`rounded-xl py-2.5 text-sm font-medium transition ${
              tab === "people" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500"
            }`}
          >
            Сотрудники
          </button>
          <button
            type="button"
            onClick={() => setTab("roles")}
            className={`rounded-xl py-2.5 text-sm font-medium transition ${
              tab === "roles" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500"
            }`}
          >
            Роли
          </button>
        </div>
      )}

      {error && tab === "people" && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {tab === "roles" && canManageRoles ? (
        <RolesPanel />
      ) : loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : (
        <UserTree
          nodes={tree}
          currentUserId={user.id}
          onAddChild={(parentId) => {
            const defaultRole = roles.find((r) => r.name === "Сотрудник");
            setRoleId(defaultRole?.id ?? "");
            setDialog({ type: "add", parentId });
          }}
          onMove={(u) => {
            setMoveParentId(u.parent_id ?? "");
            setDialog({ type: "move", user: u });
          }}
          onChangeRole={(u) => {
            setRoleId(u.role_id ?? "");
            setDialog({ type: "role", user: u });
          }}
          onDelete={handleDelete}
        />
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[min(92dvh,36rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {dialog.type === "add"
                  ? "Новый пользователь"
                  : dialog.type === "move"
                    ? "Переместить"
                    : "Роль сотрудника"}
              </h2>
              <button type="button" onClick={closeDialog} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {dialog.type === "add" ? (
              <form onSubmit={(e) => void handleAdd(e)} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Никнейм</label>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Пароль</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Роль</label>
                  <Select
                    value={roleId === "" ? "" : String(roleId)}
                    onChange={(v) => setRoleId(v === "" ? "" : Number(v))}
                    options={roleOptions}
                    placeholder="Выберите роль"
                    dropdownPlacement="auto"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Будет добавлен под:{" "}
                  {users.find((u) => u.id === dialog.parentId)?.nickname ?? "корень"}
                </p>
                <button
                  type="submit"
                  disabled={saving || roleId === ""}
                  className="w-full rounded-xl py-3 font-medium text-white gradient-accent disabled:opacity-50"
                >
                  {saving ? "Создание..." : "Создать"}
                </button>
              </form>
            ) : dialog.type === "move" ? (
              <form onSubmit={(e) => void handleMove(e)} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Переместить <strong>{dialog.user.nickname}</strong> к:
                </p>
                <Select
                  value={moveParentId === "" ? "" : String(moveParentId)}
                  onChange={(v) => setMoveParentId(v === "" ? "" : Number(v))}
                  options={parentSelectOptions}
                  placeholder="Выберите руководителя"
                  dropdownPlacement="auto"
                />
                <button
                  type="submit"
                  disabled={saving || moveParentId === ""}
                  className="w-full rounded-xl py-3 font-medium text-white gradient-accent disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Переместить"}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleRole(e)} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Роль для <strong>{dialog.user.nickname}</strong>
                </p>
                <Select
                  value={roleId === "" ? "" : String(roleId)}
                  onChange={(v) => setRoleId(v === "" ? "" : Number(v))}
                  options={roleOptions}
                  placeholder="Выберите роль"
                  dropdownPlacement="auto"
                />
                <button
                  type="submit"
                  disabled={saving || roleId === ""}
                  className="w-full rounded-xl py-3 font-medium text-white gradient-accent disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
