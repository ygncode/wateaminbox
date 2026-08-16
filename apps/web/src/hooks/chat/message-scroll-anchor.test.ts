import { describe, expect, test } from "bun:test";
import { resolveNewestMessageAnchor } from "./message-scroll-anchor";

const base = {
  conversationId: "group-a",
  anchoredConversationId: null as string | null,
  itemCount: 40,
  hasHighlightTarget: false,
};

describe("resolveNewestMessageAnchor", () => {
  test("anchors to the newest message once a conversation has rows", () => {
    expect(resolveNewestMessageAnchor(base)).toBe("newest-message");
  });

  test("waits while no conversation is selected", () => {
    expect(
      resolveNewestMessageAnchor({ ...base, conversationId: undefined }),
    ).toBe("wait");
  });

  test("waits until the conversation's messages are available", () => {
    expect(resolveNewestMessageAnchor({ ...base, itemCount: 0 })).toBe("wait");
  });

  test("anchors when switching to a conversation whose messages are ALREADY cached - the previous conversation's anchor must not suppress it", () => {
    expect(
      resolveNewestMessageAnchor({
        ...base,
        conversationId: "group-b",
        anchoredConversationId: "group-a",
      }),
    ).toBe("newest-message");
  });

  test("does not repeat the anchor for the conversation it already ran for - user scroll position is preserved", () => {
    expect(
      resolveNewestMessageAnchor({
        ...base,
        anchoredConversationId: "group-a",
        itemCount: 90,
      }),
    ).toBe("already-anchored");
  });

  test("anchors again when returning to a previously anchored conversation", () => {
    expect(
      resolveNewestMessageAnchor({
        ...base,
        conversationId: "group-a",
        anchoredConversationId: "group-b",
      }),
    ).toBe("newest-message");
  });

  test("leaves the viewport to highlighted-message navigation but still claims the anchor", () => {
    expect(
      resolveNewestMessageAnchor({ ...base, hasHighlightTarget: true }),
    ).toBe("highlighted-message");
  });

  test("a highlight target arriving later never re-anchors an anchored conversation", () => {
    expect(
      resolveNewestMessageAnchor({
        ...base,
        anchoredConversationId: "group-a",
        hasHighlightTarget: true,
      }),
    ).toBe("already-anchored");
  });
});
