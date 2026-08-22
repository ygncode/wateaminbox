import { describe, expect, test } from "bun:test";
import type { Message } from "@wateaminbox/shared";
import { isReplyDraftStillValid, resolveActiveReplyDraft } from "./reply-draft";

const DRAFT = { id: "message-1", content: "quote me" } as unknown as Message;

describe("reply draft validity while blocked", () => {
  test("a draft survives while the contact is not blocked", () => {
    expect(isReplyDraftStillValid({ isContactBlocked: false })).toBe(true);
    expect(
      resolveActiveReplyDraft({
        replyToMessage: DRAFT,
        isContactBlocked: false,
      }),
    ).toBe(DRAFT);
  });

  test("a draft is dropped the moment the contact flips to blocked, so an unblock can't silently restore it", () => {
    expect(isReplyDraftStillValid({ isContactBlocked: true })).toBe(false);
    expect(
      resolveActiveReplyDraft({
        replyToMessage: DRAFT,
        isContactBlocked: true,
      }),
    ).toBeNull();
  });

  test("no draft stays no draft in either state", () => {
    expect(
      resolveActiveReplyDraft({
        replyToMessage: null,
        isContactBlocked: false,
      }),
    ).toBeNull();
    expect(
      resolveActiveReplyDraft({ replyToMessage: null, isContactBlocked: true }),
    ).toBeNull();
  });
});
