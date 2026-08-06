import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { PermissionCode, User } from "../types";
import { can as userCan } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (code: PermissionCode) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const login = async (nickname: string, password: string) => {
    const { user } = await api.login(nickname, password);
    setUser(user);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  const can = (code: PermissionCode) => userCan(user, code);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
