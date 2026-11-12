import {
  dayjs,
  formatChatListTime,
  formatDateSeparator,
  formatLastSeen,
  formatStatusTime,
} from "@wateaminbox/shared";
import { beforeAll, describe, expect, it } from "bun:test";
import ar from "../locales/ar.json";
import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import id from "../locales/id.json";
import ms from "../locales/ms.json";
import ptBR from "../locales/pt-BR.json";
import zhCN from "../locales/zh-CN.json";
import i18n, { isRtlLanguage, languages, loadLanguage } from "./i18n";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

beforeAll(async () => {
  for (const language of languages) await loadLanguage(language.code);
});

const enKeys = flatten(en as Tree);
const zhKeys = flatten(zhCN as Tree);

const BUNDLES: Record<string, Tree> = {
  "zh-CN": zhCN as Tree,
  "pt-BR": ptBR as Tree,
  es: es as Tree,
  fr: fr as Tree,
  de: de as Tree,
  id: id as Tree,
  ms: ms as Tree,
  ar: ar as Tree,
};

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Plural categories each language needs (CLDR, as used by Intl.PluralRules). */
const pluralCategories = (language: string) =>
  new Intl.PluralRules(language).resolvedOptions().pluralCategories;

const placeholders = (value: string) =>
  [...value.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
const tags = (value: string) =>
  [...value.matchAll(/<\/?([a-zA-Z0-9]+)\s*\/?>/g)]
    .map((m) => m[0])
    .sort()
    .join(",");

describe("locale bundles", () => {
  for (const [language, bundle] of Object.entries(BUNDLES)) {
    const keys = flatten(bundle);

    it(`${language}: translates every non-plural key`, () => {
      const missing = [...enKeys.keys()]
        .filter((key) => !PLURAL.test(key))
        .filter((key) => !keys.has(key));
      expect(missing).toEqual([]);
    });

    it(`${language}: provides every plural category the language needs`, () => {
      const bases = new Set(
        [...enKeys.keys()]
          .filter((key) => PLURAL.test(key))
          .map((key) => key.replace(PLURAL, "")),
      );
      const missing: string[] = [];
      for (const base of bases) {
        for (const category of pluralCategories(language)) {
          if (!keys.has(`${base}_${category}`))
            missing.push(`${base}_${category}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${language}: has no keys without an English source string`, () => {
      const orphaned = [...keys.keys()].filter(
        (key) => !enKeys.has(key) && !enKeys.has(key.replace(PLURAL, "_other")),
      );
      expect(orphaned).toEqual([]);
    });

    it(`${language}: keeps placeholders and inline tags identical`, () => {
      const mismatched: string[] = [];
      for (const [key, translated] of keys) {
        const english =
          enKeys.get(key) ?? enKeys.get(key.replace(PLURAL, "_other"));
        if (english === undefined) continue;
        const sameTags = tags(english) === tags(translated);
        const a = placeholders(english);
        const b = placeholders(translated);
        // A singular form may name the number in words ("one message").
        const countDropped =
          PLURAL.test(key) &&
          !key.endsWith("_other") &&
          b ===
            a
              .split(",")
              .filter((p) => p !== "count")
              .join(",");
        if (!sameTags || (a !== b && !countDropped)) mismatched.push(key);
      }
      expect(mismatched).toEqual([]);
    });
  }

  it("marks only Arabic as right-to-left", () => {
    expect(
      languages.filter((l) => isRtlLanguage(l.code)).map((l) => l.code),
    ).toEqual(["ar"]);
  });

  it("loads every configured language on demand", async () => {
    for (const language of languages) {
      await loadLanguage(language.code);
      expect(i18n.hasResourceBundle(language.code, "translation")).toBe(true);
    }
  });
});

describe("plural resolution", () => {
  it("selects singular and plural English forms by count", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("chat.unreadMessages", { count: 1 })).toBe(
      "1 unread message",
    );
    expect(i18n.t("chat.unreadMessages", { count: 5 })).toBe(
      "5 unread messages",
    );
  });

  it("uses the single Chinese plural form for any count", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("chat.unreadMessages", { count: 1 })).toBe("1 条未读消息");
    expect(i18n.t("chat.unreadMessages", { count: 5 })).toBe("5 条未读消息");
    await i18n.changeLanguage("en");
  });

  it("resolves a plural form for every count-bearing key", async () => {
    await i18n.changeLanguage("en");
    const pluralBases = new Set(
      [...enKeys.keys()]
        .filter((key) => key.endsWith("_one") || key.endsWith("_other"))
        .map((key) => key.replace(/_(one|other)$/, "")),
    );

    for (const base of pluralBases) {
      for (const count of [0, 1, 2]) {
        const resolved = i18n.t(base, { count });
        expect(resolved).not.toBe(base);
        expect(resolved).not.toContain("{{count}}");
      }
    }
  });
});

describe("translation lookup", () => {
  it("returns Chinese copy once the language is switched", async () => {
    const chinese = zhKeys.get("common.cancel");
    const english = enKeys.get("common.cancel");
    expect(chinese).toBeDefined();
    expect(english).toBeDefined();

    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("common.cancel")).toBe(chinese as string);
    await i18n.changeLanguage("en");
    expect(i18n.t("common.cancel")).toBe(english as string);
  });

  it("falls back to English for an unknown language", async () => {
    const english = enKeys.get("common.cancel");
    expect(english).toBeDefined();
    await i18n.changeLanguage("ja");
    expect(i18n.t("common.cancel")).toBe(english as string);
    await i18n.changeLanguage("en");
  });
});

describe("document direction", () => {
  it("switches <html dir> to rtl for Arabic and back", async () => {
    if (typeof document === "undefined") return;
    await i18n.changeLanguage("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    await i18n.changeLanguage("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("date formatters", () => {
  const translate = i18n.t.bind(i18n);

  it("keeps the English wording when no translator is passed", () => {
    // The shared package has no i18n instance of its own, so the bare call
    // must stay usable (and unchanged) for non-React callers.
    expect(formatStatusTime(dayjs().subtract(30, "second"))).toBe("Just now");
    expect(formatChatListTime(dayjs().subtract(1, "day"))).toBe("Yesterday");
    expect(formatDateSeparator(dayjs())).toBe("Today");
    expect(formatLastSeen(null, true)).toBe("online");
  });

  it("translates relative timestamps into the active language", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(formatStatusTime(dayjs().subtract(30, "second"), translate)).toBe(
      "刚刚",
    );
    expect(formatStatusTime(dayjs().subtract(5, "minute"), translate)).toBe(
      "5 分钟前",
    );
    expect(formatChatListTime(dayjs().subtract(1, "day"), translate)).toBe(
      "昨天",
    );
    expect(formatDateSeparator(dayjs(), translate)).toBe("今天");
    expect(formatLastSeen(null, true, translate)).toBe("在线");
    await i18n.changeLanguage("en");
  });

  it("switches the dayjs locale so day names follow the language", async () => {
    await i18n.changeLanguage("en");
    expect(dayjs("2026-01-05T12:00:00Z").format("dddd")).toBe("Monday");
    await i18n.changeLanguage("zh-CN");
    expect(dayjs("2026-01-05T12:00:00Z").format("dddd")).toBe("星期一");
    await i18n.changeLanguage("en");
  });
});
