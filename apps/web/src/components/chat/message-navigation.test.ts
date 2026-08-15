import { describe, expect, test } from "bun:test";
import type { Message } from "@wateaminbox/shared";
import {
  getReplyNavigationTarget,
  matchesMessageNavigationTarget,
  resolveMessageNavigationTarget,
} from "./message-navigation";

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "database-id",
  whatsappMessageId: "whatsapp-stanza-id",
  conversationId: "conversation-id",
  senderId: "sender-id",
  senderType: "contact",
  content: "Original message",
  messageType: "text",
  status: "delivered",
  createdAt: new Date("2026-08-15T08:00:00Z"),
  updatedAt: new Date("2026-08-15T08:00:00Z"),
  ...overrides,
});

describe("reply message navigation", () => {
  test("uses the local ID when the quoted message is already resolved", () => {
    expect(getReplyNavigationTarget(message(), "whatsapp-stanza-id")).toEqual({
      kind: "database",
      messageId: "database-id",
    });
  });

  test("keeps an unavailable WhatsApp quote actionable", () => {
    expect(getReplyNavigationTarget(undefined, "whatsapp-stanza-id")).toEqual({
      kind: "reference",
      messageId: "whatsapp-stanza-id",
    });
  });

  test("reference targets match either persisted or optimistic identities", () => {
    const target = {
      kind: "reference",
      messageId: "whatsapp-stanza-id",
    } as const;
    expect(matchesMessageNavigationTarget(message(), target)).toBe(true);
    expect(
      matchesMessageNavigationTarget(message(), {
        kind: "reference",
        messageId: "database-id",
      }),
    ).toBe(true);
    expect(resolveMessageNavigationTarget([message()], target)?.id).toBe(
      "database-id",
    );
  });

  test("does not navigate to a deleted quoted message", () => {
    expect(
      getReplyNavigationTarget(
        message({ isDeleted: true }),
        "whatsapp-stanza-id",
      ),
    ).toBeNull();
  });
});
