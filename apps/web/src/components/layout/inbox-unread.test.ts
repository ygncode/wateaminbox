import { describe, expect, test } from "bun:test";
import {
  formatInboxUnreadCount,
  getInboxNavigationLabel,
} from "./inbox-unread";

describe("Inbox unread navigation state", () => {
  test("caps the visible badge while preserving the accessible total", () => {
    expect(formatInboxUnreadCount(120)).toBe("99+");
    expect(getInboxNavigationLabel("Inbox", 120)).toBe(
      "Inbox, 120 unread messages",
    );
  });

  test("uses a singular accessible label for one unread message", () => {
    expect(getInboxNavigationLabel("Inbox", 1)).toBe("Inbox, 1 unread message");
  });
});
