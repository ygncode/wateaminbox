import { describe, expect, test } from "bun:test";
import {
  formatMessageForConversation,
  type MessageDbRow,
} from "./message-formatters.js";
import type { ThreadProvenance } from "../services/message-provenance.service.js";

const row = (overrides: Partial<MessageDbRow> = {}): MessageDbRow =>
  ({
    id: "message-1",
    message_id: "external-1",
    contact_id: "contact-1",
    conversation_id: "conversation-1",
    whatsapp_connection_id: null,
    from_me: false,
    sender_jid: null,
    sender_name: null,
    sender_avatar_url: null,
    sent_by_user_id: null,
    message_type: "text",
    content: "hello",
    media_url: null,
    timestamp: new Date("2026-09-08T12:00:00.000Z"),
    created_at: new Date("2026-09-08T12:00:01.000Z"),
    ...overrides,
  }) as MessageDbRow;

const threads = new Map<string, ThreadProvenance>([
  [
    "conversation-1",
    { threadId: "contact-1", channel: "telegram", provider: "telegram_bot" },
  ],
]);

const format = (message: MessageDbRow) =>
  formatMessageForConversation(
    message,
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    threads,
  );

/**
 * A merged customer's timeline shows messages from several threads side by
 * side, so each row has to say which one it came from. Nothing in the response
 * carried that before: `conversationId` holds the contact id, and channel and
 * provider were absent entirely.
 */
describe("message provenance", () => {
  test("names the thread and the channel a message arrived on", () => {
    const formatted = format(row());
    expect(formatted.threadId).toBe("contact-1");
    expect(formatted.channel).toBe("telegram");
    expect(formatted.provider).toBe("telegram_bot");
  });

  test("answers for a legacy row that never reached the spine", () => {
    // No conversation to look up: the contact is the thread, and WhatsApp is
    // the only channel that could have produced the row.
    const formatted = format(row({ conversation_id: null }));
    expect(formatted.threadId).toBe("contact-1");
    expect(formatted.channel).toBe("whatsapp");
    expect(formatted.provider).toBe("whatsapp_linked_device");
  });

  test("leaves provenance null rather than guessing an unknown thread", () => {
    const formatted = format(row({ conversation_id: "conversation-missing" }));
    expect(formatted.threadId).toBeNull();
    expect(formatted.channel).toBeNull();
  });

  test("leaves the historical conversationId field alone", () => {
    // It holds the contact id and always has. Correcting it is a separate
    // change; `threadId` is what names the thread.
    expect(format(row()).conversationId).toBe("contact-1");
  });
});
