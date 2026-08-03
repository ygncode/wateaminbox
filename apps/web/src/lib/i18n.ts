import i18n from "i18next";
import { initReactI18next } from "react-i18next";

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

export default i18n;
