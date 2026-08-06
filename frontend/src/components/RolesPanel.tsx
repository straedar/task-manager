import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { useDialog } from "../context/DialogContext";
import type { PermissionCode, PermissionGroup, Role } from "../types";
import { ThemeSwitch } from "./ThemeSwitch";

type Props = {
  /** Modal sheet with close button; omit for inline page content */
  onClose?: () => void;
};

export function RolesPanel({ onClose }: Props) {
  const { confirm } = useDialog();
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<PermissionCode>>(new Set());
  const [saving, setSaving] = useState(false);

  const embedded = !onClose;

  const load = async () => {
    setLoading(true);
    try {
      const [rolesRes, catalogRes] = await Promise.all([
        api.listRoles(),
        api.getPermissionCatalog(),
      ]);
      setRoles(rolesRes.roles);
      setGroups(catalogRes.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setName("");
    setDescription("");
    setSelected(new Set());
    setError("");
  };

  const openEdit = (role: Role) => {
    setCreating(false);
    setEditing(role);
    setName(role.name);
    setDescription(role.description);
    setSelected(new Set(role.permissions));
    setError("");
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const toggle = (code: PermissionCode) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const permissions = [...selected];
      if (editing) {
        await api.updateRole(editing.id, { name, description, permissions });
      } else {
        await api.createRole({ name, description, permissions });
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: Role) => {
    const ok = await confirm({
      title: `Удалить роль «${role.name}»?`,
      description: "Пользователи с этой ролью потеряют её права.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.deleteRole(role.id);
      if (editing?.id === role.id) closeForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  const body = (
    <>
      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="py-8 text-center text-gray-400">Загрузка...</p>
      ) : creating || editing ? (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Название</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
              required
              minLength={2}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Описание</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Права</p>
            {groups.map((group) => (
              <div key={group.id}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {group.label}
                </p>
                <div className="space-y-0.5 rounded-2xl bg-gray-50 p-2">
                  {group.permissions.map((perm) => (
                    <ThemeSwitch
                      key={perm.code}
                      id={`perm-${perm.code}`}
                      label={perm.label}
                      checked={selected.has(perm.code)}
                      onChange={() => toggle(perm.code)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600"
            >
              Назад
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl py-3 text-sm font-medium text-white gradient-accent disabled:opacity-50"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={openCreate}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white gradient-accent"
          >
            <Plus className="h-4 w-4" />
            Новая роль
          </button>
          {roles.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Ролей пока нет — создайте первую</p>
          ) : (
            <ul className="space-y-2">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="flex items-start justify-between gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-soft"
                >
                  <button
                    type="button"
                    onClick={() => openEdit(role)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium text-gray-900">{role.name}</p>
                    {role.description && (
                      <p className="mt-0.5 text-xs text-gray-400">{role.description}</p>
                    )}
                    <p className="mt-1 text-xs text-orange-500">
                      {role.permissions.length} прав · нажмите, чтобы изменить
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(role)}
                    className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="Удалить роль"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div>{body}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-soft sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Роли и права</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>
      </div>
    </div>
  );
}
