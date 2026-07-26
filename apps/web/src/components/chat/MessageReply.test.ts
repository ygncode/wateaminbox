import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { shouldShowReplyPreview } from "./MessageBubble";

describe("incoming reply previews", () => {
  test("shows a reply marker when only the quoted message ID is available", () => {
    expect(
      shouldShowReplyPreview({
        replyToMessageId: "quoted-wa-message-id",
        isDeleted: false,
      }),
    ).toBe(true);
  });

  test("does not show reply UI for regular or deleted messages", () => {
    expect(shouldShowReplyPreview({ isDeleted: false })).toBe(false);
    expect(
      shouldShowReplyPreview({
        replyToMessageId: "quoted-wa-message-id",
        isDeleted: true,
      }),
    ).toBe(false);
  });

  test("renders an unavailable marker when the original message is absent", () => {
    const source = readFileSync(
      new URL("./MessageBubble.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('t("chat.quotedMessageUnavailable")');
  });
});
