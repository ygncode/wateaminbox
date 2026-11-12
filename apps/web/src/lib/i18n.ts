import {
  DEFAULT_LANGUAGE,
  dayjs,
  isSupportedLanguage,
  matchSupportedLanguage,
  RTL_LANGUAGES,
  type SupportedLanguage,
} from "@wateaminbox/shared";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import "dayjs/locale/ar";
import "dayjs/locale/de";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/id";
import "dayjs/locale/ms";
import "dayjs/locale/pt-br";
import "dayjs/locale/zh-cn";
import en from "../locales/en.json";

/**
 * English ships in the main bundle (it is also the fallback). Every other
 * language is a separate chunk fetched only when someone selects it, so adding
 * languages does not slow the cold load for everyone.
 */
const LOCALE_LOADERS: Record<
  Exclude<SupportedLanguage, "en">,
  () => Promise<{ default: Record<string, unknown> }>
> = {
  "zh-CN": () => import("../locales/zh-CN.json"),
  "pt-BR": () => import("../locales/pt-BR.json"),
  es: () => import("../locales/es.json"),
  fr: () => import("../locales/fr.json"),
  de: () => import("../locales/de.json"),
  id: () => import("../locales/id.json"),
  ms: () => import("../locales/ms.json"),
  ar: () => import("../locales/ar.json"),
};

const LANGUAGE_STORAGE_KEY = "whatsapp-web-language";

/**
 * Initial language before the signed-in user's saved preference is known:
 * this browser's last choice, else the closest browser language, else English.
 * The account preference (loaded with the profile) then takes over.
 */
const getInitialLanguage = (): SupportedLanguage => {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isSupportedLanguage(saved)) return saved;
  const browser =
    typeof navigator === "undefined"
      ? []
      : (navigator.languages ?? [navigator.language]);
  for (const tag of browser) {
    const match = matchSupportedLanguage(tag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
};

// Remember the choice in this browser, so the login screen and the first paint
// after a reload already use it before the profile has loaded.
export const saveLanguage = (language: string): void => {
  if (typeof window !== "undefined") {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }
};

// Available languages, in switcher order. Codes must match SUPPORTED_LANGUAGES
// in @wateaminbox/shared, which the API uses to validate a saved preference.
export const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "pt-BR", name: "Portuguese (Brazil)", nativeName: "Português (BR)" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
] as const satisfies readonly {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
}[];

export type LanguageCode = (typeof languages)[number]["code"];

export const isRtlLanguage = (language: string): boolean =>
  isSupportedLanguage(language) && RTL_LANGUAGES.has(language);

// Keep <html lang> and <html dir> in sync so screen readers, browser
// translation prompts and right-to-left layout follow the selected language.
const syncDocumentLanguage = (language: string): void => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtlLanguage(language) ? "rtl" : "ltr";
  }
};

/** i18next language code -> dayjs locale id. */
const DAYJS_LOCALES: Record<SupportedLanguage, string> = {
  en: "en",
  "zh-CN": "zh-cn",
  "pt-BR": "pt-br",
  es: "es",
  fr: "fr",
  de: "de",
  id: "id",
  ms: "ms",
  ar: "ar",
};

// Day and month names come from dayjs (format("ddd"), "dddd", "MMM D"), so its
// locale has to follow the selected language or those stay English.
const syncDateLocale = (language: string): void => {
  dayjs.locale(isSupportedLanguage(language) ? DAYJS_LOCALES[language] : "en");
};

// i18next v26 removed the startup support notice along with the
// `showSupportNotice` option that used to silence it, so passing it now fails
// the InitOptions overload.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  // Start in English; the browser's or account's language is applied as soon
  // as its bundle has loaded (see setLanguage below).
  lng: DEFAULT_LANGUAGE,
  partialBundledLanguages: true,
  fallbackLng: "en",
  supportedLngs: [...languages.map((language) => language.code)],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false,
  },
});

syncDocumentLanguage(i18n.language);
syncDateLocale(i18n.language);
i18n.on("languageChanged", (language) => {
  syncDocumentLanguage(language);
  syncDateLocale(language);
});

/** Fetch a language's bundle once and register it with i18next. */
export const loadLanguage = async (
  language: SupportedLanguage,
): Promise<void> => {
  if (language === "en" || i18n.hasResourceBundle(language, "translation"))
    return;
  const bundle = await LOCALE_LOADERS[language]();
  i18n.addResourceBundle(language, "translation", bundle.default, true, true);
};

/**
 * Switch the interface language, loading its bundle first so the UI never
 * flashes untranslated keys. Unknown codes fall back to English.
 */
export const setLanguage = async (language: string): Promise<void> => {
  const target = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
  try {
    await loadLanguage(target);
  } catch {
    // A failed chunk download (offline, stale deploy) keeps the current language.
    return;
  }
  if (i18n.language !== target) await i18n.changeLanguage(target);
};

/**
 * Apply the language saved on the user's account. Called when the profile
 * loads; an account with no saved choice keeps the browser's language.
 */
export const applyAccountLanguage = (
  preferredLanguage: string | null | undefined,
): void => {
  if (!isSupportedLanguage(preferredLanguage)) return;
  saveLanguage(preferredLanguage);
  void setLanguage(preferredLanguage);
};

// Apply this browser's last choice (or its closest browser language) once its
// bundle is available.
const initialLanguage = getInitialLanguage();
if (initialLanguage !== DEFAULT_LANGUAGE) void setLanguage(initialLanguage);

export default i18n;
