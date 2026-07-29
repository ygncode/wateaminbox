import { describe, expect, test } from "bun:test";
import {
  formatInboxUnreadCount,
  getInboxNavigationLabel,
  getInboxUnreadCount,
} from "./inbox-unread";

describe("Inbox unread navigation state", () => {
  test("sums unread messages across conversations", () => {
    expect(
      getInboxUnreadCount([
        { unreadCount: 2 },
        { unreadCount: 0 },
        { unreadCount: 4 },
      ]),
    ).toBe(6);
  });

  test("does not allow invalid negative counts to reduce the badge", () => {
    expect(getInboxUnreadCount([{ unreadCount: 3 }, { unreadCount: -2 }])).toBe(
      3,
    );
  });

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
