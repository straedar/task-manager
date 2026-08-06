import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeId = "light" | "dark" | "cosmos" | "aurora" | "oak";

export const THEMES: {
  id: ThemeId;
  label: string;
  swatch: string;
}[] = [
  { id: "light", label: "Светлая", swatch: "#ff6b35" },
  { id: "dark", label: "Тёмная", swatch: "#ff6b35" },
  { id: "cosmos", label: "Космос", swatch: "#660099" },
  { id: "aurora", label: "Аврора", swatch: "#30d5c8" },
  { id: "oak", label: "Дуб", swatch: "#16bb00" },
];

const STORAGE_KEY = "tm-theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

function readStoredTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "light";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (isThemeId(attr)) return attr;
    }
    return readStoredTheme();
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
