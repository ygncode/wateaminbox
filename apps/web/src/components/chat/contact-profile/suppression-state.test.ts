import { describe, expect, test } from "bun:test";
import type { ContactSuppressionStatus } from "@/hooks/contact/useContactSuppression";
import { resolveSuppressionView } from "./suppression-state";

function status(
  overrides: Partial<ContactSuppressionStatus> = {},
): ContactSuppressionStatus {
  return {
    contactId: "c1",
    enforced: true,
    blocked: false,
    muted: null,
    channels: [],
    ...overrides,
  };
}

describe("resolveSuppressionView", () => {
  test("a WhatsApp-blocked contact shows blocked while status loads", () => {
    expect(resolveSuppressionView(undefined, true)).toEqual({
      kind: "blocked",
      showNotEnforced: false,
    });
  });

  test("a block outranks a mute", () => {
    expect(
      resolveSuppressionView(
        status({ blocked: true, muted: { id: "m", expiresAt: null } }),
        false,
      ).kind,
    ).toBe("blocked");
  });

  test("a mute carries its expiry", () => {
    expect(
      resolveSuppressionView(
        status({ muted: { id: "m", expiresAt: "2026-11-21T10:00:00Z" } }),
        false,
      ),
    ).toEqual({
      kind: "muted",
      expiresAt: "2026-11-21T10:00:00Z",
      showNotEnforced: false,
    });
  });

  test("warns that a saved block is not enforced yet", () => {
    expect(
      resolveSuppressionView(status({ blocked: true, enforced: false }), false),
    ).toEqual({ kind: "blocked", showNotEnforced: true });
  });

  test("nothing suppressed is active", () => {
    expect(resolveSuppressionView(status(), false)).toEqual({ kind: "active" });
  });
});
