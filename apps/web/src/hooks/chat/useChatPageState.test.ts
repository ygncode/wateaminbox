import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./useChatPageState.ts", import.meta.url),
  "utf8",
);

/**
 * Slice the source between two unique markers so assertions stay scoped to
 * the handler that owns the bug. A bare `toContain` over the whole file would
 * pass on the text surface alone and hide a regression confined to the
 * attachment surface, which is exactly the defect this guard exists to catch.
 */
function extractBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`End marker not found: ${endMarker}`);
  return source.slice(start, end);
}

describe("useChatPageState: reply context threads through every send surface", () => {
  describe("handleAttachFile (immediate attachment)", () => {
    const body = () =>
      extractBetween(
        "const handleAttachFile = React.useCallback(",
        "const handleDeleteMessage = React.useCallback(",
      );

    it("threads replyToMessageId into each sendMessage mutation payload", () => {
      expect(body()).toContain("replyToMessageId: replyToMessage?.id");
    });

    it("keeps the attachment media and album fields alongside the reply", () => {
      const handler = body();
      expect(handler).toContain("mediaUrl: item.uploadResponse.mediaUrl");
      expect(handler).toContain("mediaAlbum:");
      expect(handler).toContain("replyToMessageId: replyToMessage?.id");
    });

    it("lists replyToMessage in the useCallback dependency array", () => {
      // The dep array must include replyToMessage so the handler always reads
      // the current reply draft rather than a stale closure capture.
      expect(body()).toMatch(/replyToMessage,\s*\]/);
    });
  });

  describe("handleSendMessage (immediate text) — regression guard", () => {
    const body = () =>
      extractBetween(
        "const handleSendMessage = React.useCallback(",
        "const handleAttachFile = React.useCallback(",
      );

    it("still threads replyToMessageId", () => {
      expect(body()).toContain("sendMessage.mutate(");
      expect(body()).toContain("replyToMessageId,");
    });
  });
});
