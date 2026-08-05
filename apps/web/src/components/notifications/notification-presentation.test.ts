import { describe, expect, test } from "bun:test";
import type { InAppNotification, NotificationType } from "@/lib/api/types";
import {
  describeNotificationView,
  formatNotificationTime,
  formatNotificationTimestamp,
  getNotificationEmptyState,
  getNotificationPageRange,
  getNotificationVisual,
  groupNotificationsByDay,
  parseNotificationFilter,
  summarizeNotificationTypes,
} from "./notification-presentation";

/** Local-time notification, so day grouping is asserted in the user's zone. */
function makeNotification(
  createdAt: string,
  overrides: Partial<InAppNotification> = {},
): InAppNotification {
  return {
    id: createdAt + (overrides.id ?? ""),
    userId: "user",
    notificationType: "system",
    title: "Notification",
    message: null,
    actionUrl: null,
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt,
    ...overrides,
  };
}

const reference = "2026-08-05T12:00:00";

describe("notification day grouping", () => {
  test("labels the recent days relative to the reference day", () => {
    const groups = groupNotificationsByDay(
      [
        makeNotification("2026-08-05T09:30:00"),
        makeNotification("2026-08-04T18:00:00"),
        makeNotification("2026-08-02T08:00:00"),
        makeNotification("2026-07-20T08:00:00"),
      ],
      reference,
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Sunday",
      "20 July",
    ]);
  });

  test("keeps same-day notifications together in server order", () => {
    const first = makeNotification("2026-08-05T11:00:00", { id: "a" });
    const second = makeNotification("2026-08-05T09:00:00", { id: "b" });
    const older = makeNotification("2026-08-04T23:00:00", { id: "c" });

    const groups = groupNotificationsByDay([first, second, older], reference);

    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("2026-08-05");
    expect(groups[0].items.map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(groups[1].items).toEqual([older]);
  });

  test("spells out the year for notifications from an earlier year", () => {
    const [group] = groupNotificationsByDay(
      [makeNotification("2025-12-31T10:00:00")],
      reference,
    );
    expect(group.label).toBe("31 December 2025");
  });

  test("never drops a row with an unusable timestamp", () => {
    const broken = makeNotification("not-a-date");
    const groups = groupNotificationsByDay([broken], reference);
    expect(groups.flatMap((group) => group.items)).toEqual([broken]);
  });

  test("returns nothing for an empty list", () => {
    expect(groupNotificationsByDay([], reference)).toEqual([]);
  });
});

describe("notification timestamps", () => {
  test("shows clock time in rows and a full timestamp for assistive text", () => {
    expect(formatNotificationTime("2026-08-05T09:05:00")).toBe("09:05");
    expect(formatNotificationTimestamp("2026-08-05T09:05:00")).toBe(
      "5 August 2026 at 09:05",
    );
  });

  test("degrades to empty text rather than rendering Invalid Date", () => {
    expect(formatNotificationTime("nonsense")).toBe("");
    expect(formatNotificationTimestamp("nonsense")).toBe("");
  });
});

describe("notification view description", () => {
  test("an empty unread view reads as caught up, not as an empty inbox", () => {
    expect(
      describeNotificationView({ filter: "unread", total: 0, unreadCount: 0 }),
    ).toBe("No unread notifications in this workspace.");
    expect(getNotificationEmptyState("unread").description).toContain(
      "already read",
    );
  });

  test("the unfiltered view reports the total alongside the unread count", () => {
    expect(
      describeNotificationView({ filter: "all", total: 12, unreadCount: 3 }),
    ).toBe("12 notifications · 3 unread.");
    expect(
      describeNotificationView({ filter: "all", total: 1, unreadCount: 0 }),
    ).toBe("1 notification · 0 unread.");
  });

  test("a later page that emptied out does not read as an empty inbox", () => {
    const state = getNotificationEmptyState("all", { beyondFirstPage: true });
    expect(state.title).toBe("Nothing on this page");
    expect(state.description).toContain("past the end");
    // The reason wins over the filter: an unread page 3 says the same thing.
    expect(
      getNotificationEmptyState("unread", { beyondFirstPage: true }),
    ).toEqual(state);
  });

  test("distinguishes a genuinely empty inbox from a filtered one", () => {
    expect(
      describeNotificationView({ filter: "all", total: 0, unreadCount: 0 }),
    ).toBe("No notifications in this workspace yet.");
    expect(getNotificationEmptyState("all").title).toBe("No notifications yet");
  });

  test("does not claim an empty inbox while the first page is loading", () => {
    expect(
      describeNotificationView({
        filter: "all",
        total: 0,
        unreadCount: 0,
        isLoading: true,
      }),
    ).toBe("Loading your workspace activity…");
  });
});

describe("notification filter parsing", () => {
  test("only 'unread' turns the filter on", () => {
    expect(parseNotificationFilter("unread")).toBe("unread");
    expect(parseNotificationFilter("all")).toBe("all");
  });

  test("unknown, missing and falsy-looking values fall back to all", () => {
    // Guards the regression this page shipped with: read notifications hidden
    // by default because a filter defaulted to on.
    expect(parseNotificationFilter(null)).toBe("all");
    expect(parseNotificationFilter(undefined)).toBe("all");
    expect(parseNotificationFilter("")).toBe("all");
    expect(parseNotificationFilter("false")).toBe("all");
    expect(parseNotificationFilter("read")).toBe("all");
  });
});

describe("notification type presentation", () => {
  test("every type has distinct tile and accent styling", () => {
    const types: NotificationType[] = [
      "message",
      "mention",
      "assignment",
      "team",
      "system",
    ];
    const tiles = types.map((type) => getNotificationVisual(type).tile);
    expect(new Set(tiles).size).toBe(types.length);
    for (const type of types) {
      const visual = getNotificationVisual(type);
      expect(visual.label.length).toBeGreaterThan(0);
      expect(visual.accent).toContain("border-l-");
      expect(visual.tile).toContain("dark:");
    }
  });

  test("an unknown type from a newer server still renders", () => {
    const visual = getNotificationVisual("promotion" as NotificationType);
    expect(visual.label).toBe("Update");
    expect(visual.tile).toContain("bg-");
  });

  test("counts types largest first with a stable tie-break", () => {
    expect(
      summarizeNotificationTypes([
        makeNotification("2026-08-05T10:00:00", { notificationType: "team" }),
        makeNotification("2026-08-05T09:00:00", {
          notificationType: "message",
        }),
        makeNotification("2026-08-05T08:00:00", {
          notificationType: "message",
        }),
        makeNotification("2026-08-05T07:00:00", {
          notificationType: "mention",
        }),
      ]),
    ).toEqual([
      { type: "message", label: "Message", count: 2 },
      { type: "mention", label: "Mention", count: 1 },
      { type: "team", label: "Team", count: 1 },
    ]);
    expect(summarizeNotificationTypes([])).toEqual([]);
  });
});

describe("notification page range", () => {
  test("reports a one-based range for the visible page", () => {
    expect(getNotificationPageRange(0, 25, 60)).toEqual({ start: 1, end: 25 });
    expect(getNotificationPageRange(50, 10, 60)).toEqual({
      start: 51,
      end: 60,
    });
  });

  test("clamps a short final page and zeroes an empty one", () => {
    expect(getNotificationPageRange(25, 25, 30)).toEqual({
      start: 26,
      end: 30,
    });
    expect(getNotificationPageRange(0, 0, 0)).toEqual({ start: 0, end: 0 });
    expect(getNotificationPageRange(25, 0, 25)).toEqual({ start: 0, end: 0 });
  });
});
