import { useState } from "react";
import { Navigate } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { user, login, restorePassword, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"login" | "restore">("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(nickname, password);
      } else {
        await restorePassword(nickname, code, newPassword);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size={48} />
          <div>
            <h1 className="text-2xl font-bold gradient-text">TaskMaster</h1>
            <p className="text-sm text-gray-500">
              {mode === "login"
                ? "Войдите по никнейму и паролю"
                : "Восстановление пароля по коду"}
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Никнейм</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
              autoComplete="username"
              required
            />
          </div>

          {mode === "login" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                autoComplete="current-password"
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Код восстановления
                </label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 font-mono tracking-wider outline-none focus:border-orange-400"
                  autoComplete="one-time-code"
                  required
                  minLength={4}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Новый пароль
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-orange-400"
                  autoComplete="new-password"
                  required
                  minLength={4}
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-3 font-medium text-white gradient-accent disabled:opacity-50"
          >
            {loading
              ? mode === "login"
                ? "Вход..."
                : "Сохранение..."
              : mode === "login"
                ? "Войти"
                : "Сменить пароль и войти"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "restore" : "login");
            setError("");
            setPassword("");
            setCode("");
            setNewPassword("");
          }}
          className="mt-4 w-full text-center text-sm text-orange-600 hover:text-orange-700"
        >
          {mode === "login" ? "Есть код восстановления?" : "Назад ко входу"}
        </button>
      </div>
    </div>
  );
}
