/**
 * Theme registry. The single place that lists the themes the UI can apply.
 *
 * Colour values live in src/styles/themes.css under `[data-theme="<id>"]`.
 * A theme here without a CSS block (or the reverse) fails theme-tokens.test.ts.
 * index.html duplicates the ids and appearances for its pre-paint script;
 * the same test keeps that copy in sync.
 */

export const THEMES = {
  light: {
    appearance: "light",
    /** Browser chrome colour (meta theme-color); matches --canvas. */
    metaColor: "#efefea",
  },
  dark: {
    appearance: "dark",
    metaColor: "#08090b",
  },
  whatsapp: {
    appearance: "dark",
    metaColor: "#111b21",
  },
} as const satisfies Record<
  string,
  { appearance: "light" | "dark"; metaColor: string }
>;

export type ThemeId = keyof typeof THEMES;
export type Appearance = (typeof THEMES)[ThemeId]["appearance"];

/** What the user picks. `system` follows the OS between light and dark. */
export type ThemePreference = ThemeId | "system";

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const THEME_PREFERENCES: ThemePreference[] = ["system", ...THEME_IDS];

export const THEME_STORAGE_KEY = "wateaminbox-theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" && (THEME_PREFERENCES as string[]).includes(value)
  );
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeId {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Apply a theme to the document. Mirrors the inline script in index.html. */
export function applyTheme(theme: ThemeId, root = document.documentElement) {
  const { appearance, metaColor } = THEMES[theme];
  root.dataset.theme = theme;
  root.classList.toggle("dark", appearance === "dark");
  root.style.colorScheme = appearance;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", metaColor);
}
