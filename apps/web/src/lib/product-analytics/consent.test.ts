import { describe, expect, it } from "bun:test";
import {
  CONSENT_STORAGE_KEY,
  readStoredConsent,
  writeStoredConsent,
} from "./consent";
import type { ConsentStorage } from "./types";

function memoryStorage(initial: Record<string, string> = {}): ConsentStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const throwingStorage: ConsentStorage = {
  getItem: () => {
    throw new Error("storage unavailable");
  },
  setItem: () => {
    throw new Error("storage unavailable");
  },
  removeItem: () => {
    throw new Error("storage unavailable");
  },
};

describe("stored consent", () => {
  it("reads granted and denied decisions", () => {
    expect(
      readStoredConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "granted" })),
    ).toBe("granted");
    expect(
      readStoredConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "denied" })),
    ).toBe("denied");
  });

  it("treats missing, malformed, and unavailable storage as unknown", () => {
    expect(readStoredConsent(memoryStorage())).toBe("unknown");
    expect(
      readStoredConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "yes" })),
    ).toBe("unknown");
    expect(
      readStoredConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "GRANTED" })),
    ).toBe("unknown");
    expect(readStoredConsent(null)).toBe("unknown");
    expect(readStoredConsent(throwingStorage)).toBe("unknown");
  });

  it("persists decisions and reports write failures without throwing", () => {
    const storage = memoryStorage();
    expect(writeStoredConsent(storage, "denied")).toBe(true);
    expect(readStoredConsent(storage)).toBe("denied");
    expect(writeStoredConsent(null, "granted")).toBe(false);
    expect(writeStoredConsent(throwingStorage, "granted")).toBe(false);
  });
});
