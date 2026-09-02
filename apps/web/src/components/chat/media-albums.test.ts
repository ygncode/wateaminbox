import { describe, expect, test } from "bun:test";
import type { Message } from "@wateaminbox/shared";
import { groupMediaAlbumMessages } from "./media-albums";

function media(
  id: string,
  createdAt: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId: "conversation",
    senderId: "contact",
    senderType: "contact",
    senderJid: "15551234567@s.whatsapp.net",
    content: "",
    messageType: "image",
    status: "delivered",
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...overrides,
  };
}

describe("media album grouping", () => {
  test("uses WhatsApp's album parent and tile order", () => {
    const grouped = groupMediaAlbumMessages([
      media("second", "2026-09-02T10:00:02Z", {
        metadata: {
          mediaAlbumId: "parent",
          mediaAlbumIndex: 1,
          mediaAlbumCount: 9,
        },
      }),
      media("first", "2026-09-02T10:00:01Z", {
        content: "Weekend photos",
        metadata: {
          mediaAlbumId: "parent",
          mediaAlbumIndex: 0,
          mediaAlbumCount: 9,
        },
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].messages.map((message) => message.id)).toEqual([
      "first",
      "second",
    ]);
    expect(grouped[0].primary.id).toBe("first");
    expect(grouped[0].expectedCount).toBe(9);
  });

  test("infers legacy albums only for adjacent media from the same author", () => {
    const grouped = groupMediaAlbumMessages([
      media("one", "2026-09-02T10:00:00.000Z"),
      media("two", "2026-09-02T10:00:01.000Z", { messageType: "video" }),
      media("other", "2026-09-02T10:00:01.200Z", {
        senderJid: "15557654321@s.whatsapp.net",
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].messages.map((message) => message.id)).toEqual([
      "one",
      "two",
    ]);
    expect(grouped[1].messages).toHaveLength(1);
  });

  test("does not merge separate media sends outside the narrow fallback window", () => {
    const grouped = groupMediaAlbumMessages([
      media("one", "2026-09-02T10:00:00Z"),
      media("two", "2026-09-02T10:00:03Z"),
    ]);

    expect(grouped).toHaveLength(2);
  });
});
