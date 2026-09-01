import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import en from "../../locales/en.json";
import zh from "../../locales/zh-CN.json";

/**
 * A connected app's `client_id` is the URL of its metadata document. The list
 * shows the host alongside any name the client supplies, because the name is
 * self-declared and the host is not: an impostor can call itself "ChatGPT" but
 * cannot serve its document from chatgpt.com.
 *
 * Mirrors the helper in ConnectedAppsSection.
 */
function clientHost(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

describe("connected app identity", () => {
  test("shows the host of a client metadata URL", () => {
    expect(clientHost("https://chatgpt.com/oauth/client.json")).toBe(
      "chatgpt.com",
    );
    expect(
      clientHost("https://claude.ai/oauth/claude-code-client-metadata"),
    ).toBe("claude.ai");
  });

  test("a lookalike name cannot borrow another host", () => {
    // The rendered host comes from the URL the document was fetched from, so a
    // client claiming to be ChatGPT still displays its own origin.
    expect(clientHost("https://evil.example/chatgpt/client.json")).toBe(
      "evil.example",
    );
  });

  test("falls back to the raw value when it is not a URL", () => {
    expect(clientHost("not-a-url")).toBe("not-a-url");
  });
});

describe("connected apps translations", () => {
  const required = [
    "title",
    "description",
    "empty",
    "scopeWrite",
    "scopeRead",
    "lastUsed",
    "neverUsed",
    "connected",
    "disconnect",
    "disconnecting",
    "disconnectApp",
    "disconnected",
    "disconnectFailed",
    "confirmTitle",
    "confirmBody",
    "loadFailed",
    "authorizedBy",
    "confirmOwner",
  ] as const;

  test("English carries every key the component asks for", () => {
    for (const key of required) {
      expect(en.connectedApps[key]).toBeTruthy();
    }
  });

  test("Chinese covers the same keys", () => {
    // A missing key silently falls back to English, which reads as a bug
    // rather than as a language choice.
    for (const key of required) {
      expect(zh.connectedApps[key]).toBeTruthy();
    }
  });

  test("interpolated placeholders match across locales", () => {
    const placeholders = (value: string) =>
      (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();
    for (const key of required) {
      // A translation that drops {{name}} renders a sentence with a hole in it.
      expect(placeholders(zh.connectedApps[key])).toEqual(
        placeholders(en.connectedApps[key]),
      );
    }
  });
});

describe("duplicate grants stay distinguishable", () => {
  /**
   * Two members can authorize the same client. Their rows then agree on
   * everything the list shows except the owner, so the owner is the only field
   * that makes the disconnect decision safe - it must not be truncated away,
   * and it must appear on the confirmation.
   */
  const source = readFileSync(
    new URL("./ConnectedAppsSection.tsx", import.meta.url),
    "utf8",
  );

  test("owner is not rendered inside a truncating element", () => {
    const ownerLine = source.slice(
      source.indexOf("connectedApps.authorizedBy") - 400,
      source.indexOf("connectedApps.authorizedBy"),
    );
    // The metadata line truncates; the owner must not share it.
    expect(ownerLine).toContain("break-words");
    expect(ownerLine).not.toContain("truncate");
  });

  test("the confirmation names the owner", () => {
    expect(source).toContain("connectedApps.confirmOwner");
    // Guarded on the grant belonging to someone else, so a user disconnecting
    // their own app is not told who they are.
    const dialog = source.slice(source.indexOf("confirmOwner") - 300);
    expect(dialog).toContain("ownerUserId !== user?.id");
  });
});
