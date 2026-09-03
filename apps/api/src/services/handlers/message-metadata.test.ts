import { describe, expect, test } from "bun:test";
import type { MessageEvent } from "../../lib/nats/index.js";
import { buildIncomingMessageMetadata } from "./message-metadata.js";

function payload(
  overrides: Partial<MessageEvent["payload"]>,
): MessageEvent["payload"] {
  return {
    messageId: "child-1",
    from: "15551234567@s.whatsapp.net",
    to: "15557654321@s.whatsapp.net",
    fromMe: false,
    messageType: "image",
    content: "",
    timestamp: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildIncomingMessageMetadata", () => {
  test("preserves a valid media album association including index zero", () => {
    expect(
      buildIncomingMessageMetadata(
        payload({
          mediaAlbumId: "album-parent",
          mediaAlbumIndex: 0,
          mediaAlbumCount: 13,
        }),
      ),
    ).toEqual({
      mediaAlbumId: "album-parent",
      mediaAlbumIndex: 0,
      mediaAlbumCount: 13,
    });
  });

  test("does not retain malformed album numbers or orphaned album fields", () => {
    expect(
      buildIncomingMessageMetadata(
        payload({ mediaAlbumIndex: 2, mediaAlbumCount: 4 }),
      ),
    ).toBeNull();
    expect(
      buildIncomingMessageMetadata(
        payload({
          mediaAlbumId: "album-parent",
          mediaAlbumIndex: -1,
          mediaAlbumCount: 1,
        }),
      ),
    ).toEqual({ mediaAlbumId: "album-parent" });
  });
});
