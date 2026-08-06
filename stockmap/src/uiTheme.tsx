import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type UiTheme = "classic" | "dark";

/** Legacy stockmap key — hub theme (`tm-theme`) is the source of truth. */
export const UI_THEME_KEY = "stockmap-ui-theme";
const HUB_THEME_KEY = "tm-theme";

type HubThemeId = "light" | "dark" | "cosmos" | "aurora" | "oak";

function readHubTheme(): HubThemeId {
  try {
    const raw = localStorage.getItem(HUB_THEME_KEY);
    if (
      raw === "light" ||
      raw === "dark" ||
      raw === "cosmos" ||
      raw === "aurora" ||
      raw === "oak"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "light";
}

function hubToUiTheme(hub: HubThemeId): UiTheme {
  return hub === "light" ? "classic" : "dark";
}

function accentForHub(hub: HubThemeId): { accent: string; deep: string } {
  switch (hub) {
    case "cosmos":
      return { accent: "#9b4dff", deep: "#c084fc" };
    case "aurora":
      return { accent: "#30d5c8", deep: "#5eead4" };
    case "oak":
      return { accent: "#3dce20", deep: "#6ee04a" };
    case "light":
      return { accent: "#ff6b35", deep: "#ff8a5c" };
    case "dark":
    default:
      return { accent: "#f08a2e", deep: "#ff9b42" };
  }
}

function dialogTokensForHub(hub: HubThemeId): Record<string, string> {
  const { accent, deep } = accentForHub(hub);
  if (hub === "light") {
    return {
      "--tm-surface": "#ffffff",
      "--tm-surface-muted": "#f9fafb",
      "--tm-text": "#111827",
      "--tm-text-muted": "#6b7280",
      "--tm-text-secondary": "#4b5563",
      "--tm-border": "#e5e7eb",
      "--tm-scrim": "rgba(0, 0, 0, 0.4)",
      "--tm-accent-from": accent,
      "--tm-accent-to": deep,
    };
  }
  if (hub === "cosmos") {
    return {
      "--tm-surface": "#160e22",
      "--tm-surface-muted": "#1e1430",
      "--tm-text": "#f5f0ff",
      "--tm-text-muted": "#a894c4",
      "--tm-text-secondary": "#d4c8e8",
      "--tm-border": "#3d2a55",
      "--tm-scrim": "rgba(8, 0, 16, 0.7)",
      "--tm-accent-from": accent,
      "--tm-accent-to": deep,
    };
  }
  if (hub === "aurora") {
    return {
      "--tm-surface": "#0e1f1d",
      "--tm-surface-muted": "#142826",
      "--tm-text": "#eefbf9",
      "--tm-text-muted": "#8bb8b0",
      "--tm-text-secondary": "#c5e8e2",
      "--tm-border": "#2a4a45",
      "--tm-scrim": "rgba(0, 16, 14, 0.7)",
      "--tm-accent-from": accent,
      "--tm-accent-to": deep,
    };
  }
  if (hub === "oak") {
    return {
      "--tm-surface": "#101a10",
      "--tm-surface-muted": "#162216",
      "--tm-text": "#f0faf0",
      "--tm-text-muted": "#8aab8a",
      "--tm-text-secondary": "#c8e0c8",
      "--tm-border": "#2a3d2a",
      "--tm-scrim": "rgba(0, 16, 0, 0.7)",
      "--tm-accent-from": accent,
      "--tm-accent-to": deep,
    };
  }
  return {
    "--tm-surface": "#1a1a1f",
    "--tm-surface-muted": "#222228",
    "--tm-text": "#f4f4f5",
    "--tm-text-muted": "#a1a1aa",
    "--tm-text-secondary": "#d4d4d8",
    "--tm-border": "#3f3f46",
    "--tm-scrim": "rgba(0, 0, 0, 0.65)",
    "--tm-accent-from": accent,
    "--tm-accent-to": deep,
  };
}

export function readUiTheme(): UiTheme {
  return hubToUiTheme(readHubTheme());
}

export function applyUiTheme(theme: UiTheme) {
  const hub = readHubTheme();
  const resolved = theme === "classic" && hub === "light" ? "classic" : hubToUiTheme(hub);
  const { accent, deep } = accentForHub(hub);
  document.documentElement.setAttribute("data-ui-theme", resolved);
  document.documentElement.setAttribute("data-hub-theme", hub);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-deep", deep);
  for (const [key, value] of Object.entries(dialogTokensForHub(hub))) {
    document.documentElement.style.setProperty(key, value);
  }
  try {
    localStorage.setItem(UI_THEME_KEY, resolved);
  } catch {
    /* ignore */
  }
}

/** Current hub accent for Konva / canvas. */
export function readAccentColor(): string {
  if (typeof document === "undefined") return "#f08a2e";
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return fromCss || accentForHub(readHubTheme()).accent;
}

type UiThemeContextValue = {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
  toggleTheme: () => void;
};

const UiThemeContext = createContext<UiThemeContextValue | null>(null);

export function UiThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UiTheme>(() => readUiTheme());

  useEffect(() => {
    applyUiTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncFromHub = () => {
      const next = readUiTheme();
      setThemeState(next);
      applyUiTheme(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === HUB_THEME_KEY || e.key === UI_THEME_KEY) syncFromHub();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncFromHub);
    syncFromHub();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncFromHub);
    };
  }, []);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "classic" : "dark"));
  }, []);

  return (
    <UiThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </UiThemeContext.Provider>
  );
}

export function useUiTheme() {
  const ctx = useContext(UiThemeContext);
  if (!ctx) {
    throw new Error("useUiTheme must be used within UiThemeProvider");
  }
  return ctx;
}

/** Kept for LoginScreen only — map chrome no longer toggles theme. */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useUiTheme();
  const goingClassic = theme === "dark";

  return (
    <button
      type="button"
      className={`btn theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      title={
        goingClassic
          ? "Вернуть классический светлый вид"
          : "Тёмный интерфейс в стиле задач"
      }
      aria-label={goingClassic ? "Светлая тема" : "Тёмная тема"}
    >
      <span className="theme-toggle-icon" aria-hidden>
        {goingClassic ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M5.6 18.4l1.5-1.5M16.9 7.1l1.5-1.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M12.2 3.4a7.8 7.8 0 1 0 8.4 8.3 6.2 6.2 0 0 1-8.4-8.3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="theme-toggle-label">
        {goingClassic ? "Светлая" : "Тёмная"}
      </span>
    </button>
  );
}
