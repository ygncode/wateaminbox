import { describe, expect, it } from "bun:test";
import {
  isSupportedLanguage,
  matchSupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "./languages";

describe("supported languages", () => {
  it("accepts only listed codes", () => {
    for (const code of SUPPORTED_LANGUAGES) expect(isSupportedLanguage(code)).toBe(true);
    expect(isSupportedLanguage("xx")).toBe(false);
    expect(isSupportedLanguage("zh-cn")).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
  });

  it("maps browser tags to the closest supported language", () => {
    expect(matchSupportedLanguage("pt-PT")).toBe("pt-BR");
    expect(matchSupportedLanguage("es-419")).toBe("es");
    expect(matchSupportedLanguage("zh-Hans-CN")).toBe("zh-CN");
    expect(matchSupportedLanguage("zh-CN")).toBe("zh-CN");
    expect(matchSupportedLanguage("zh-TW")).toBeNull();
    expect(matchSupportedLanguage("ar-EG")).toBe("ar");
    expect(matchSupportedLanguage("de-AT")).toBe("de");
    expect(matchSupportedLanguage("ja")).toBeNull();
    expect(matchSupportedLanguage(undefined)).toBeNull();
  });
});
