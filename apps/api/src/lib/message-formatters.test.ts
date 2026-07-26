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
});
