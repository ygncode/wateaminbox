import { describe, expect, test } from "bun:test";
import {
  openConversationSchema,
  resolveConversationSchema,
} from "./conversation.js";

describe("resolveConversationSchema", () => {
  test("accepts a valid outcome without notes", () => {
    const result = resolveConversationSchema.safeParse({ outcome: "handled" });
    expect(result.success).toBe(true);
  });

  test("rejects a missing outcome", () => {
    const result = resolveConversationSchema.safeParse({ notes: "hi" });
    expect(result.success).toBe(false);
  });

  test("rejects 'other' without notes", () => {
    const result = resolveConversationSchema.safeParse({ outcome: "other" });
    expect(result.success).toBe(false);
  });

  test("rejects 'other' with only whitespace notes", () => {
    const result = resolveConversationSchema.safeParse({
      outcome: "other",
      notes: "   ",
    });
    expect(result.success).toBe(false);
  });

  test("accepts 'other' with real notes", () => {
    const result = resolveConversationSchema.safeParse({
      outcome: "other",
      notes: "Escalated to billing team",
    });
    expect(result.success).toBe(true);
  });

  test("accepts every documented outcome", () => {
    for (const outcome of [
      "handled",
      "no_reply_needed",
      "spam",
      "duplicate",
    ]) {
      expect(
        resolveConversationSchema.safeParse({ outcome }).success,
      ).toBe(true);
    }
  });

  test("rejects an undocumented outcome", () => {
    const result = resolveConversationSchema.safeParse({
      outcome: "ignored",
    });
    expect(result.success).toBe(false);
  });
});

describe("openConversationSchema", () => {
  // A first-ever manual Open needs no justification, so `reason` is
  // optional at the SCHEMA level - whether it's actually required is a
  // service-level decision that depends on case history (a genuine Reopen
  // requires one; a first-ever Open does not). See
  // conversation-case.service.integration.test.ts for that behavior.
  test("reason is optional", () => {
    expect(openConversationSchema.safeParse({}).success).toBe(true);
  });

  test("accepts a reason", () => {
    expect(
      openConversationSchema.safeParse({ reason: "Customer called back" })
        .success,
    ).toBe(true);
  });

  test("rejects a reason over the length cap", () => {
    expect(
      openConversationSchema.safeParse({ reason: "x".repeat(501) }).success,
    ).toBe(false);
  });
});
