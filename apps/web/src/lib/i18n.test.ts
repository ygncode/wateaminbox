import {
  dayjs,
  formatChatListTime,
  formatDateSeparator,
  formatLastSeen,
  formatStatusTime,
} from "@wateaminbox/shared";
import { describe, expect, it } from "bun:test";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import i18n, { languages } from "./i18n";

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

const enKeys = flatten(en as Tree);
const zhKeys = flatten(zhCN as Tree);

/**
 * Chinese has a single plural category, so it only carries `_other`. Every
 * other key must exist in both bundles or the UI silently falls back to
 * English for that string.
 */
const ENGLISH_ONLY_PLURAL_SUFFIX = "_one";

describe("locale bundles", () => {
  it("translates every key into every supported language", () => {
    const missing = [...enKeys.keys()]
      .filter((key) => !key.endsWith(ENGLISH_ONLY_PLURAL_SUFFIX))
      .filter((key) => !zhKeys.has(key));
    expect(missing).toEqual([]);
  });

  it("has no Chinese keys without an English source string", () => {
    const orphaned = [...zhKeys.keys()].filter((key) => !enKeys.has(key));
    expect(orphaned).toEqual([]);
  });

  it("keeps interpolation placeholders identical across languages", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

    const mismatched: string[] = [];
    for (const [key, english] of enKeys) {
      const chinese = zhKeys.get(key);
      if (chinese === undefined) continue;
      const a = placeholders(english);
      const b = placeholders(chinese);
      if (a.join(",") !== b.join(",")) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });

  it("exposes every configured language as a bundled resource", () => {
    for (const language of languages) {
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
    await i18n.changeLanguage("fr");
    expect(i18n.t("common.cancel")).toBe(english as string);
    await i18n.changeLanguage("en");
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
