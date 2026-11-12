/**
 * Interface languages the web app ships translations for.
 *
 * Shared so the API can validate a stored preference against exactly the list
 * the client can render. Codes are BCP-47 tags as used by i18next.
 */
export const SUPPORTED_LANGUAGES = [
  "en",
  "zh-CN",
  "pt-BR",
  "es",
  "fr",
  "de",
  "id",
  "ms",
  "ar",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/** Languages written right to left. */
export const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(["ar"]);

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Map a browser/OS language tag (e.g. "pt-PT", "zh-Hans-CN", "es-419") to the
 * closest supported language, or null when none fits.
 */
export function matchSupportedLanguage(
  tag: string | null | undefined,
): SupportedLanguage | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((code) => code.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split(/[-_]/)[0];
  if (base === "zh") {
    // Only Simplified Chinese ships; Traditional-script tags fall back.
    return /hant|-tw|-hk|-mo/.test(lower) ? null : "zh-CN";
  }
  if (base === "pt") return "pt-BR";
  return SUPPORTED_LANGUAGES.find((code) => code === base) ?? null;
}
