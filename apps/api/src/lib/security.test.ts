import { describe, expect, test } from "bun:test";
import { escapeHtml, hashToken } from "./security.js";

describe("security utilities", () => {
  test("hashToken is deterministic and does not retain the raw token", () => {
    const token = "a".repeat(64);
    const hash = hashToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
  });

  test("escapeHtml neutralizes markup in untrusted feedback", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;",
    );
  });
});
