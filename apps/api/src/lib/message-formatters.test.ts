import { describe, expect, test } from "bun:test";
import {
  buildQuotedMessageData,
  formatMessageForConversation,
  type MessageDbRow,
} from "./message-formatters";

const baseMessage = (overrides: Partial<MessageDbRow>): MessageDbRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  message_id: "wa-message-id",
  contact_id: "00000000-0000-4000-8000-000000000002",
  whatsapp_connection_id: "00000000-0000-4000-8000-000000000003",
  from_me: false,
  sender_jid: "15551234567@s.whatsapp.net",
  sender_name: "Customer",
  sender_avatar_url: null,
  sent_by_user_id: null,
  message_type: "text",
  content: "Incoming reply",
  media_url: null,
  media_mime_type: null,
  media_size: null,
  media_direct_path: null,
  media_download_status: null,
  quoted_message_id: null,
  is_forwarded: false,
  is_starred: false,
  deleted_by_sender: false,
  deleted_at: null,
  status: "delivered",
  timestamp: new Date("2026-01-01T00:01:00Z"),
  created_at: new Date("2026-01-01T00:01:00Z"),
  ...overrides,
});

describe("incoming reply formatting", () => {
  test("uses the original WhatsApp timestamp instead of the history import time", () => {
    const whatsappTimestamp = new Date("2026-01-15T09:01:17Z");
    const importedAt = new Date("2026-07-30T03:23:03Z");
    const imported = baseMessage({
      timestamp: whatsappTimestamp,
      created_at: importedAt,
    });

    const formatted = formatMessageForConversation(
      imported,
      new Map(),
      new Map(),
    );

    expect(formatted.createdAt).toEqual(whatsappTimestamp);
    expect(formatted.updatedAt).toEqual(importedAt);
  });

  test("hydrates the quoted message preview from its WhatsApp message ID", () => {
    const quoted = baseMessage({
      id: "00000000-0000-4000-8000-000000000010",
      message_id: "quoted-wa-id",
      from_me: true,
      sender_jid: null,
      sender_name: null,
      content: "Original outgoing message",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      created_at: new Date("2026-01-01T00:00:00Z"),
    });
    const incoming = baseMessage({ quoted_message_id: "quoted-wa-id" });

    const formatted = formatMessageForConversation(
      incoming,
      new Map([["quoted-wa-id", buildQuotedMessageData(quoted)]]),
      new Map(),
    );

    expect(formatted.replyToMessageId).toBe("quoted-wa-id");
    expect(formatted.replyToMessage).toMatchObject({
      id: quoted.id,
      senderType: "user",
      content: "Original outgoing message",
    });
  });

  test("includes the team member identity for outbound messages", () => {
    const userId = "00000000-0000-4000-8000-000000000099";
    const outgoing = baseMessage({
      from_me: true,
      sent_by_user_id: userId,
      sender_jid: null,
    });

    const formatted = formatMessageForConversation(
      outgoing,
      new Map(),
      new Map(),
      new Map([[userId, "Aye Aye"]]),
      new Map([
        [
          userId,
          {
            avatarUrl: "https://example.com/aye-aye.jpg",
            gravatarUrl: "https://example.com/aye-aye-gravatar.jpg",
          },
        ],
      ]),
    );

    expect(formatted.sentByUserId).toBe(userId);
    expect(formatted.sentByUserName).toBe("Aye Aye");
    expect(formatted.sentByUserAvatarUrl).toBe(
      "https://example.com/aye-aye.jpg",
    );
    expect(formatted.sentByUserGravatarUrl).toBe(
      "https://example.com/aye-aye-gravatar.jpg",
    );
  });
});
