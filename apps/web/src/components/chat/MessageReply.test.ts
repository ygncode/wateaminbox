import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { shouldShowReplyPreview } from "./MessageBubble";
import { shouldDismissReplyHighlight } from "./MessageThread";

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
    expect(source).toContain("getReplyNavigationTarget(");
  });

  test("makes an available reply preview navigate to its original message", () => {
    const source = readFileSync(
      new URL("./MessageBubble.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onNavigateToMessage?.(navigationTarget)");
    expect(source).toContain('type: "button" as const');
  });

  test("dismisses a reply highlight only when clicking outside its original", () => {
    expect(shouldDismissReplyHighlight("original-id", "original-id")).toBe(
      false,
    );
    expect(shouldDismissReplyHighlight("another-id", "original-id")).toBe(true);
    expect(shouldDismissReplyHighlight(null, "original-id")).toBe(true);
    expect(shouldDismissReplyHighlight(null, null)).toBe(false);
  });
});
