import { describe, expect, test } from "bun:test";
import { isSendPendingForContact } from "./send-scope";

describe("isSendPendingForContact", () => {
  test("false when nothing is pending", () => {
    expect(
      isSendPendingForContact({
        isPending: false,
        pendingContactId: undefined,
        selectedChatId: "contact-a",
      }),
    ).toBe(false);
  });

  test("true when the pending send's contact matches the selected chat", () => {
    expect(
      isSendPendingForContact({
        isPending: true,
        pendingContactId: "contact-a",
        selectedChatId: "contact-a",
      }),
    ).toBe(true);
  });

  test("false when a send is pending for a DIFFERENT contact than the one selected - switching chats must not disable an unrelated chat's Resolve/composer", () => {
    expect(
      isSendPendingForContact({
        isPending: true,
        pendingContactId: "contact-a",
        selectedChatId: "contact-b",
      }),
    ).toBe(false);
  });

  test("false when no chat is selected at all", () => {
    expect(
      isSendPendingForContact({
        isPending: true,
        pendingContactId: "contact-a",
        selectedChatId: undefined,
      }),
    ).toBe(false);
  });
});
