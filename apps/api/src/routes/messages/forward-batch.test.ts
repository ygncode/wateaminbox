import { describe, expect, test } from "bun:test";
import {
  createForwardAlbumId,
  IncompleteForwardAlbumError,
  planForwardBatch,
} from "./forward-batch.js";

function message(
  id: string,
  index: number,
  overrides: Partial<{
    count: number;
    fromMe: boolean;
    senderJid: string | null;
    messageType: string;
    albumId: string;
  }> = {},
) {
  return {
    id,
    contact_id: "contact-1",
    from_me: overrides.fromMe ?? false,
    sender_jid: overrides.senderJid ?? "15550001111@s.whatsapp.net",
    message_type: overrides.messageType ?? "image",
    metadata: {
      mediaAlbumId: overrides.albumId ?? "source-album",
      mediaAlbumIndex: index,
      mediaAlbumCount: overrides.count ?? 3,
    },
    deleted_by_sender: false,
    deleted_at: null,
    timestamp: new Date(`2026-09-05T00:00:0${index}Z`),
  };
}

describe("media collection forwarding", () => {
  test("orders every child and assigns a fresh destination album", () => {
    const original = message("captioned", 2, { messageType: "video" });
    const result = planForwardBatch(
      original,
      [original, message("first", 0), message("second", 1)],
      () => "3EB0000102030405060708",
    );

    expect(result.map(({ source }) => source.id)).toEqual([
      "first",
      "second",
      "captioned",
    ]);
    expect(result.map(({ mediaAlbum }) => mediaAlbum)).toEqual([
      {
        id: "3EB0000102030405060708",
        index: 0,
        count: 3,
        imageCount: 2,
        videoCount: 1,
      },
      {
        id: "3EB0000102030405060708",
        index: 1,
        count: 3,
        imageCount: 2,
        videoCount: 1,
      },
      {
        id: "3EB0000102030405060708",
        index: 2,
        count: 3,
        imageCount: 2,
        videoCount: 1,
      },
    ]);
  });

  test("does not mix an album with another author", () => {
    const original = message("first", 0, { count: 0 });
    const otherAuthor = message("other", 1, {
      count: 0,
      senderJid: "15550002222@s.whatsapp.net",
    });

    expect(planForwardBatch(original, [original, otherAuthor])).toEqual([
      { source: original },
    ]);
  });

  test("refuses to silently forward a partial collection", () => {
    const original = message("first", 0);
    expect(() =>
      planForwardBatch(original, [original, message("second", 1)]),
    ).toThrow(IncompleteForwardAlbumError);

    expect(() => planForwardBatch(original, [original])).toThrow(
      IncompleteForwardAlbumError,
    );
  });

  test("creates a WhatsApp-compatible parent ID", () => {
    expect(createForwardAlbumId(new Uint8Array(9).fill(0xab))).toBe(
      "3EB0ABABABABABABABABAB",
    );
  });
});
