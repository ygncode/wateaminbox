import { describe, expect, test } from "bun:test";
import {
  createQuickReplySchema,
  updateAutoReplySettingsSchema,
  updateQuickReplySchema,
} from "./quick-replies.js";

describe("quick reply validation", () => {
  test("normalizes shortcut casing and surrounding whitespace", () => {
    expect(
      createQuickReplySchema.parse({
        shortcut: "  Greeting  ",
        title: "  Welcome message  ",
        content: "  Hello! How can I help?  ",
      }),
    ).toEqual({
      shortcut: "greeting",
      title: "Welcome message",
      content: "Hello! How can I help?",
    });
  });

  test("rejects values that become empty after trimming", () => {
    expect(
      createQuickReplySchema.safeParse({
        shortcut: "   ",
        title: "Title",
        content: "Message",
      }).success,
    ).toBe(false);
    expect(updateQuickReplySchema.safeParse({ content: "   " }).success).toBe(
      false,
    );
  });

  test("requires a template for an enabled first-contact reply", () => {
    expect(
      updateAutoReplySettingsSchema.safeParse({
        enabled: true,
        quickReplyId: null,
        delayMinutes: 5,
        sendMode: "always",
      }).success,
    ).toBe(false);
    expect(
      updateAutoReplySettingsSchema.safeParse({
        enabled: true,
        quickReplyId: "00000000-0000-4000-8000-000000000001",
        delayMinutes: 5,
        sendMode: "outside_business_hours",
      }).success,
    ).toBe(true);
  });
});
