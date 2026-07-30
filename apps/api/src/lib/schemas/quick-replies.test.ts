import { describe, expect, test } from "bun:test";
import {
  createQuickReplySchema,
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
});
