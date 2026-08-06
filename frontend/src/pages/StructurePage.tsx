import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ChevronRight, Network, Search } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { HubBackButton } from "../components/HubBackButton";
import type { User } from "../types";
import { displayName, initialsOf } from "../types";

export function StructurePage() {
  const { user, loading: authLoading, can } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .listStructureUsers()
      .then(({ users: next }) => setUsers(next))
      .catch((err: Error) => setError(err.message || "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user || !can("app.structure")) return;
    load();
  }, [user, can, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = displayName(u).toLowerCase();
      const nick = u.nickname.toLowerCase();
      const role = (u.role_name ?? "").toLowerCase();
      return name.includes(q) || nick.includes(q) || role.includes(q);
    });
  }, [users, query]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.structure")) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-10 pt-4">
      <header className="mb-5">
        <div className="mb-3">
          <HubBackButton />
        </div>
        <div className="flex items-center gap-2.5">
          <Network className="h-7 w-7 shrink-0 text-[var(--accent-from)]" />
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Структура
          </h1>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Все сотрудники суперприложения
        </p>
      </header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени, нику или роли"
          className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-from)]"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-[var(--text-muted)]">
          {query.trim() ? "Никого не найдено" : "Пока нет сотрудников"}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-3xl bg-[var(--surface)] shadow-soft">
          {filtered.map((u, i) => {
            const href =
              u.id === user.id ? "/profile" : `/profile/${u.id}`;
            return (
              <li key={u.id}>
                <Link
                  to={href}
                  className={`flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)] ${
                    i > 0 ? "border-t border-[var(--border)]" : ""
                  }`}
                >
                  <div
                    className={`h-11 w-11 shrink-0 overflow-hidden rounded-2xl text-white ${
                      u.avatar_url
                        ? "bg-[var(--surface-muted)]"
                        : "bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)]"
                    }`}
                  >
                    {u.avatar_url ? (
                      <img
                        src={u.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-sm font-semibold">
                        {initialsOf(u)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--text-primary)]">
                      {displayName(u)}
                      {u.id === user.id && (
                        <span className="ml-1.5 text-xs font-normal text-[var(--text-faint)]">
                          вы
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-[var(--text-muted)]">
                      {u.role_name?.trim() || "Без роли"} · @{u.nickname}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
