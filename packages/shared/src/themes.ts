/**
 * Interface themes the web app ships (see apps/web/DESIGN.md).
 *
 * Shared so the API can validate a stored preference against exactly the list
 * the clients can render. `system` follows the device between light and dark.
 */
export const THEME_PREFERENCES = [
  "system",
  "light",
  "dark",
  "whatsapp",
] as const;

export type ThemePreferenceId = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreferenceId {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}
