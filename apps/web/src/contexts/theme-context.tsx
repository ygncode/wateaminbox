import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import i18n from "../lib/i18n";
import {
  type Appearance,
  applyTheme,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
  type ThemePreference,
} from "../lib/theme/themes";

/** What the user picked: a theme id or `system`. */
export type Theme = ThemePreference;
/** Light or dark - for code that only cares about brightness. */
export type ResolvedTheme = Appearance;

export interface ThemeContextValue {
  /** The stored preference (a theme id or `system`). */
  theme: Theme;
  /** The theme actually applied after resolving `system`. */
  activeTheme: ThemeId;
  /** Light or dark appearance of the active theme. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null; // storage unavailable (privacy mode)
  }
}

function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage unavailable
  }
}

const darkQuery = () =>
  typeof window === "undefined"
    ? null
    : window.matchMedia("(prefers-color-scheme: dark)");

function resolve(theme: Theme): ThemeId {
  return resolveThemePreference(theme, Boolean(darkQuery()?.matches));
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_PREFERENCE,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => getStoredTheme() ?? defaultTheme,
  );
  const [activeTheme, setActiveTheme] = useState<ThemeId>(() => resolve(theme));

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    storeTheme(next);
    const active = resolve(next);
    setActiveTheme(active);
    applyTheme(active);

    const announcement = document.getElementById("theme-announcement");
    if (announcement) {
      const label =
        next === "system"
          ? i18n.t("settings.themePanel.system", {
              resolved: i18n.t(`settings.themePanel.${active}`),
            })
          : i18n.t(`settings.themePanel.${next}`);
      announcement.textContent = i18n.t("settings.themePanel.changed", {
        theme: label,
      });
    }
  }, []);

  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    const query = darkQuery();
    if (!query || theme !== "system") return;
    const onChange = () => setActiveTheme(resolve("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      activeTheme,
      resolvedTheme: THEMES[activeTheme].appearance,
      setTheme,
    }),
    [theme, activeTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <div
        id="theme-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
