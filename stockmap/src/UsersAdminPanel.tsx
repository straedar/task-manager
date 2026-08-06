import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createUser,
  deleteUser,
  listUsers,
  type ManagedUser,
  type Role,
} from "./api";
import { useDialog } from "./DialogContext";

export function UsersAdminPanel({ onClose }: { onClose: () => void }) {
  const { confirm } = useDialog();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const list = await listUsers();
    setUsers(list);
  }, []);

  useEffect(() => {
    void reload().catch((err) => {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    });
  }, [reload]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createUser({
        login: loginName.trim(),
        password,
        role,
      });
      setLoginName("");
      setPassword("");
      setRole("user");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: number) => {
    const ok = await confirm({
      title: "Удалить этого пользователя?",
      description: "Доступ к карте склада будет закрыт.",
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteUser(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  };

  return (
    <div className="users-backdrop" onClick={onClose}>
      <div
        className="users-panel"
        role="dialog"
        aria-label="Пользователи"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="users-panel-head">
          <h2>Пользователи</h2>
          <button type="button" className="btn ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <form className="users-create" onSubmit={(e) => void onCreate(e)}>
          <p className="users-create-title">Создать аккаунт</p>
          <label className="field">
            <span>Логин</span>
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              required
              minLength={2}
            />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label className="field">
            <span>Роль</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="user">Пользователь</option>
              <option value="admin">Админ</option>
            </select>
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Создание…" : "Создать"}
          </button>
        </form>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <ul className="users-list">
          {users.map((u) => (
            <li key={u.id}>
              <div>
                <strong>{u.login}</strong>
                <span className="users-role">
                  {u.role === "admin" ? "админ" : "пользователь"}
                </span>
              </div>
              <button
                type="button"
                className="btn danger"
                onClick={() => void onDelete(u.id)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
