import { describe, expect, it } from "bun:test";
import { bucketRecipientCount, sanitizeEvent } from "./events";

describe("event allowlist", () => {
  it("passes every allowed event with its allowlisted parameters", () => {
    const allowed: Array<[string, Record<string, string>]> = [
      ["login", { method: "email" }],
      ["sign_up", { method: "email" }],
      ["workspace_created", {}],
      ["whatsapp_connection_setup_started", {}],
      ["whatsapp_connection_connected", { connectionMode: "new" }],
      ["whatsapp_connection_connected", { connectionMode: "reconnect" }],
      ["message_sent", { messageType: "text" }],
      ["conversation_resolved", {}],
      ["teammate_invited", { role: "admin" }],
      [
        "broadcast_created",
        { delivery: "scheduled", recipientBucket: "11-50" },
      ],
      ["report_exported", { report: "dashboard", format: "csv" }],
    ];
    for (const [name, params] of allowed) {
      const sanitized: { name: string; params: Record<string, string> } | null =
        sanitizeEvent(name, params);
      expect(sanitized).toEqual({ name, params });
    }
  });

  it("rejects unknown event names", () => {
    expect(sanitizeEvent("purchase", {})).toBeNull();
    expect(sanitizeEvent("", {})).toBeNull();
    expect(sanitizeEvent("Login", { method: "email" })).toBeNull();
    expect(sanitizeEvent("toString", {})).toBeNull();
    expect(sanitizeEvent("constructor", {})).toBeNull();
  });

  it("drops parameters outside the allowlist", () => {
    const sanitized = sanitizeEvent("login", {
      method: "email",
      email: "person@example.com",
      userId: "user-1",
      page_referrer: "https://leak.example.com/?token=x",
    });
    expect(sanitized).toEqual({ name: "login", params: { method: "email" } });
  });

  it("rejects values outside the predefined enums and unbounded strings", () => {
    expect(sanitizeEvent("login", { method: "google" })).toBeNull();
    expect(sanitizeEvent("teammate_invited", { role: "owner" })).toBeNull();
    expect(
      sanitizeEvent("message_sent", { messageType: "x".repeat(500) }),
    ).toBeNull();
    expect(
      sanitizeEvent("broadcast_created", {
        delivery: "immediate",
        recipientBucket: "137",
      }),
    ).toBeNull();
    expect(sanitizeEvent("login", { method: 42 })).toBeNull();
  });

  it("drops events missing a declared parameter instead of guessing", () => {
    expect(sanitizeEvent("login", {})).toBeNull();
    expect(
      sanitizeEvent("broadcast_created", { delivery: "immediate" }),
    ).toBeNull();
    expect(sanitizeEvent("login", undefined)).toBeNull();
  });
});

describe("recipient buckets", () => {
  it("maps counts to the documented buckets at every boundary", () => {
    expect(bucketRecipientCount(1)).toBe("1-10");
    expect(bucketRecipientCount(10)).toBe("1-10");
    expect(bucketRecipientCount(11)).toBe("11-50");
    expect(bucketRecipientCount(50)).toBe("11-50");
    expect(bucketRecipientCount(51)).toBe("51-100");
    expect(bucketRecipientCount(100)).toBe("51-100");
    expect(bucketRecipientCount(101)).toBe("100+");
    expect(bucketRecipientCount(100_000)).toBe("100+");
  });

  it("never exposes a raw count for degenerate inputs", () => {
    expect(bucketRecipientCount(0)).toBe("1-10");
    expect(bucketRecipientCount(-5)).toBe("1-10");
    expect(bucketRecipientCount(Number.NaN)).toBe("1-10");
  });
});
