import { dayjs } from "@wateaminbox/shared";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import "dayjs/locale/zh-cn";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

const LANGUAGE_STORAGE_KEY = "whatsapp-web-language";

// Get saved language from localStorage or default to English
const getSavedLanguage = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en";
  }
  return "en";
};

// Save language preference to localStorage
export const saveLanguage = (language: string): void => {
  if (typeof window !== "undefined") {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }
};

// Available languages
export const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

// Keep <html lang> in sync so screen readers and browser translation
// prompts follow the selected language rather than the static "en".
const syncDocumentLanguage = (language: string): void => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
};

/** i18next language code -> dayjs locale id. */
const DAYJS_LOCALES: Record<string, string> = {
  en: "en",
  "zh-CN": "zh-cn",
};

// Day and month names come from dayjs (format("ddd"), "dddd", "MMM D"), so its
// locale has to follow the selected language or those stay English.
const syncDateLocale = (language: string): void => {
  dayjs.locale(DAYJS_LOCALES[language] ?? "en");
};

i18n.use(initReactI18next).init({
  showSupportNotice: false,
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: getSavedLanguage(),
  fallbackLng: "en",
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

export default i18n;
