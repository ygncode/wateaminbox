import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
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
import { useAuth } from "./auth-context";

/** What the user picked: a theme id or `system`. */
export type Theme = ThemePreference;
/** Light or dark - for code that only cares about brightness. */
export type ResolvedTheme = Appearance;

export interface ThemeContextValue {
  /** The preference (a theme id or `system`). Account-backed when signed in. */
  theme: Theme;
  /** The theme actually applied after resolving `system`. */
  activeTheme: ThemeId;
  /** Light or dark appearance of the active theme. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/*
 * Source of truth is the signed-in user's account (`themePreference`), so the
 * theme follows them across browsers and devices. localStorage is only a
 * paint cache: index.html reads it before React loads so a reload does not
 * flash the wrong theme. Signed out, the app follows the device.
 */

function readCache(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null; // storage unavailable (privacy mode)
  }
}

function writeCache(theme: Theme): void {
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

function announce(next: Theme, active: ThemeId) {
  const announcement = document.getElementById("theme-announcement");
  if (!announcement) return;
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

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_PREFERENCE,
}: ThemeProviderProps) {
  const { user, isAuthenticated, updateProfile } = useAuth();
  const accountTheme = isThemePreference(user?.themePreference)
    ? user.themePreference
    : null;

  const [theme, setThemeState] = useState<Theme>(
    () => readCache() ?? defaultTheme,
  );
  const [activeTheme, setActiveTheme] = useState<ThemeId>(() => resolve(theme));

  const adopt = useCallback((next: Theme) => {
    setThemeState(next);
    writeCache(next);
    const active = resolve(next);
    setActiveTheme(active);
    applyTheme(active);
    return active;
  }, []);

  // The account wins: apply its theme whenever it loads or changes (sign-in,
  // refresh, a change made on another device).
  // Only react when the *account value* changes, never to local state: a
  // local pick is applied first and saved after, and must not be reverted
  // by the not-yet-updated account value in between.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    // No saved choice: everyone gets the product default.
    const next = accountTheme ?? defaultTheme;
    if (next !== themeRef.current) adopt(next);
  }, [isAuthenticated, userId, accountTheme, adopt, defaultTheme]);

  // Signed out: back to the product default, not the previous user's choice.
  const wasAuthenticated = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated) adopt(defaultTheme);
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated, adopt, defaultTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      const active = adopt(next);
      announce(next, active);
      if (!user || accountTheme === next) return;
      updateProfile({ themePreference: next }).catch(() => {
        // Applied here already; only saving to the account failed.
        toast.error(i18n.t("settings.themeSaveFailed"));
      });
    },
    [adopt, user, accountTheme, updateProfile],
  );

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
